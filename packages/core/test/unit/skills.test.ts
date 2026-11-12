import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_SLACK_MS,
  GRACE_MS,
  MIN_ATTEMPT_MS,
  attemptDeadlineMs,
  checkContentFile,
  cookRefusal,
  cookResult,
  createRng,
  deliverJob,
  drawJob,
  emptyProgress,
  gainSkillXp,
  gatherRefusal,
  gatherResult,
  jobEvent,
  jobsView,
  judgeAttempt,
  markerAt,
  newCreature,
  nextGoal,
  npcMarks,
  openBoard,
  perfectTaps,
  planAttempt,
  playStory,
  pruneJobs,
  questEvent,
  recipeBook,
  skillEvent,
  skillLevel,
  skillsView,
  type AttemptPlan,
  type Progress,
} from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';
import { liveStory, storyContent } from '../support/story-content.ts';

const skills = storyContent.skills!;
const live = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../../../content/${file}`, import.meta.url), 'utf8'));
const courier = (inventory: Progress['inventory'] = [], extra: Partial<Progress> = {}): Progress => ({ ...emptyProgress(), team: [newCreature('glowbun', 5, battleContent)], inventory, ...extra });
const at = (progress: Progress, levels: Record<string, number>): Progress => ({ ...progress, skills: Object.entries(levels).map(([skill, level]) => ({ skill, level, xp: 0 })) });
const OPEN = { busy: false, inReach: true, rests: [], now: 0 };

describe('skill content schemas', () => {
  const good = ['skills.json', 'spots.json', 'recipes.json', 'stations.json', 'jobs.json', 'items.json', 'inventory.json', 'story.json', 'quests.json'];

  it.each(good)('accepts the live %s', (file) => {
    expect(checkContentFile(file, live(file))).toEqual({ ok: true });
  });

  it('refuses a curve that does not rise, a repeated spot, a repeated ingredient, an unknown station kind and a backwards count', () => {
    const file = live('skills.json') as { levelCosts: number[] };
    expect(checkContentFile('skills.json', { ...file, levelCosts: [...file.levelCosts.slice(0, -1), 1] })).toMatchObject({ ok: false, problems: ['levelCosts: each level costs more than the one before'] });
    const spots = live('spots.json') as { spots: object[] };
    expect(checkContentFile('spots.json', { spots: [spots.spots[0], spots.spots[0]] })).toMatchObject({ ok: false });
    const berry = { id: 'odd-bun', makes: 'berry-bun', level: 1, xp: 5, difficulty: 1, ingredients: [{ item: 'cloudberry', count: 1 }, { item: 'cloudberry', count: 1 }] };
    expect(checkContentFile('recipes.json', { recipes: [berry] })).toMatchObject({ ok: false, problems: ['recipes.0: each ingredient appears once'] });
    expect(checkContentFile('stations.json', { stations: [{ id: 'oven', kind: 'oven', look: 'pot', name: { en: 'Oven', sl: 'Pečica' } }] })).toMatchObject({ ok: false });
    const jobs = live('jobs.json') as { slots: number; templates: { count: number[] }[] };
    expect(checkContentFile('jobs.json', { ...jobs, templates: [{ ...jobs.templates[0], count: [5, 2] }] })).toMatchObject({ ok: false });
  });

  it('refuses a treat stronger than the most a treat adds, a side chapter before a main one, and a gather of none', () => {
    const items = live('items.json') as { items: { id: string; kind: string; strength?: number }[] };
    const pudding = items.items.findIndex((item) => item.id === 'frost-pudding');
    const strong = items.items.with(pudding, { ...items.items[pudding]!, strength: 31 });
    expect(checkContentFile('items.json', { items: strong })).toMatchObject({ ok: false });
    const story = live('story.json') as { chapters: { side?: boolean }[]; flags: unknown[] };
    expect(checkContentFile('story.json', { ...story, chapters: story.chapters.toReversed() })).toMatchObject({ ok: false });
    expect(checkContentFile('story.json', { ...story, chapters: story.chapters.filter((chapter) => chapter.side) })).toMatchObject({ ok: false });
    const quests = live('quests.json') as { quests: { id: string; steps: { kind: string; count?: number }[] }[] };
    const index = quests.quests.findIndex((quest) => quest.id === 'treats-from-scratch');
    const quest = quests.quests[index]!;
    const gather = quest.steps.findIndex((step) => step.kind === 'gather');
    const none = quests.quests.with(index, { ...quest, steps: quest.steps.with(gather, { ...quest.steps[gather]!, count: 0 }) });
    expect(checkContentFile('quests.json', { quests: none })).toMatchObject({ ok: false });
  });
});

describe('skill levels', () => {
  it('levels up through the curve, carries the rest of the XP, and stops at the top level', () => {
    const first = gainSkillXp(courier(), 'foraging', skills.levelCosts[0]! + skills.levelCosts[1]! + 3, skills);
    expect(first.gain).toEqual({ skill: 'foraging', xp: skills.levelCosts[0]! + skills.levelCosts[1]! + 3, level: 3, levelUp: true });
    expect(skillLevel(first.progress, 'foraging')).toEqual({ skill: 'foraging', level: 3, xp: 3 });
    const top = gainSkillXp(courier(), 'cooking', 1_000_000, skills);
    expect(skillLevel(top.progress, 'cooking')).toEqual({ skill: 'cooking', level: skills.maxLevel, xp: 0 });
    expect(gainSkillXp(courier(), 'juggling', 50, skills).progress).toEqual(courier());
    expect(skillLevel(courier(), 'fishing')).toEqual({ skill: 'fishing', level: 1, xp: 0 });
  });

  it('shows every skill in content order, and only the rests still running, by spot', () => {
    const view = skillsView(at(courier(), { cooking: 3 }), [{ spot: 'pebble-cove', until: 5_000 }, { spot: 'cloudberry-bush-a', until: 1_000 }, { spot: 'cloudberry-bush-b', until: 9_000 }], 2_000, skills);
    expect(view.skills.map((entry) => [entry.skill, entry.level])).toEqual([['foraging', 1], ['fishing', 1], ['cooking', 3]]);
    expect(view.resting).toEqual([{ spot: 'cloudberry-bush-b', ms: 7_000 }, { spot: 'pebble-cove', ms: 3_000 }]);
  });
});

describe('gathering and cooking', () => {
  it('refuses a start in order: unknown, busy, too far, too low a level, resting, a full stack', () => {
    const full = courier([{ item: 'cloudberry', count: 99 }]);
    expect(gatherRefusal(courier(), 'moon-bush', { ...OPEN, busy: true }, storyContent)).toBe('invalid');
    expect(gatherRefusal(courier(), 'skymint-patch-a', { ...OPEN, busy: true, inReach: false }, storyContent)).toBe('notNow');
    expect(gatherRefusal(courier(), 'skymint-patch-a', { ...OPEN, inReach: false }, storyContent)).toBe('tooFar');
    expect(gatherRefusal(courier(), 'skymint-patch-a', OPEN, storyContent)).toBe('needsLevel');
    expect(gatherRefusal(full, 'cloudberry-bush-a', { ...OPEN, rests: [{ spot: 'cloudberry-bush-a', until: 10 }] }, storyContent)).toBe('resting');
    expect(gatherRefusal(full, 'cloudberry-bush-a', { ...OPEN, rests: [{ spot: 'cloudberry-bush-a', until: 0 }] }, storyContent)).toBe('bagFull');
    expect(gatherRefusal(courier(), 'cloudberry-bush-a', OPEN, storyContent)).toBeNull();
  });

  it('gives one item on a success, two on a perfect within the stack, XP and a rest; a miss gives and rests nothing', () => {
    const success = gatherResult(courier(), 'cloudberry-bush-a', 'success', 1_000, storyContent);
    expect(success).toMatchObject({ items: [{ item: 'cloudberry', count: 1 }], xp: 8, level: 1, rest: { spot: 'cloudberry-bush-a', until: 41_000 } });
    const nearlyFull = gatherResult(courier([{ item: 'cloudberry', count: 98 }]), 'cloudberry-bush-a', 'perfect', 0, storyContent);
    expect(nearlyFull).toMatchObject({ items: [{ item: 'cloudberry', count: 1 }], extra: [{ item: 'cloudberry', count: 1 }] });
    const miss = gatherResult(courier(), 'cloudberry-bush-a', 'miss', 0, storyContent);
    expect(miss).toMatchObject({ progress: courier(), items: [], xp: 0, rest: null });
  });

  it('cooks only at a pot with the ingredients, and takes them only on a success', () => {
    const berries = courier([{ item: 'cloudberry', count: 3 }]);
    expect(cookRefusal(berries, 'berry-bun', 'post-board', { busy: false, inReach: true }, storyContent)).toBe('invalid');
    expect(cookRefusal(courier(), 'berry-bun', 'post-pot', { busy: false, inReach: true }, storyContent)).toBe('noItem');
    expect(cookRefusal(berries, 'fish-biscuit', 'post-pot', { busy: false, inReach: true }, storyContent)).toBe('needsLevel');
    expect(cookRefusal(berries, 'berry-bun', 'post-pot', { busy: false, inReach: true }, storyContent)).toBeNull();
    expect(cookResult(berries, 'berry-bun', 'miss', storyContent).progress).toEqual(berries);
    const baked = cookResult(berries, 'berry-bun', 'perfect', storyContent);
    expect(baked).toMatchObject({ items: [{ item: 'berry-bun', count: 2 }], used: [{ item: 'cloudberry', count: 2 }], skill: 'cooking', xp: 14 });
    expect(baked.progress.inventory).toEqual([{ item: 'cloudberry', count: 1 }, { item: 'berry-bun', count: 2 }]);
  });

  it('opens the recipe book by cooking level, with the next locked recipe', () => {
    expect(recipeBook(courier(), storyContent)).toEqual({ unlocked: ['berry-bun'], next: { recipe: 'fish-biscuit', level: 3 } });
    expect(recipeBook(at(courier(), { cooking: 20 }), storyContent)).toMatchObject({ next: null });
  });
});

const rng = () => createRng('attempt-test');

describe('the tiny games', () => {
  const plans: AttemptPlan[] = (['dip', 'sparkle', 'marker'] as const).flatMap((game) => ([1, 2, 3] as const).map((difficulty) => planAttempt(game, difficulty, rng(), skills.games)));

  it('plans the same game from the same seed', () => {
    expect(planAttempt('sparkle', 2, rng(), skills.games)).toEqual(planAttempt('sparkle', 2, rng(), skills.games));
    expect(plans.every((plan) => attemptDeadlineMs(plan) > plan.endsByMs)).toBe(true);
  });

  it('judges perfect taps perfect, no taps a miss, and a finish too soon a miss', () => {
    for (const plan of plans) {
      const elapsed = Math.max(plan.endsByMs, MIN_ATTEMPT_MS);
      expect(judgeAttempt(plan, perfectTaps(plan), elapsed)).toBe('perfect');
      expect(judgeAttempt(plan, [], elapsed)).toBe('miss');
      expect(judgeAttempt(plan, perfectTaps(plan), MIN_ATTEMPT_MS - 1)).toBe('miss');
    }
  });

  it('refuses a tap from the future, taps out of order, and a dip tapped too soon', () => {
    const dip = planAttempt('dip', 1, rng(), skills.games);
    if (dip.game !== 'dip') throw new Error('not a dip');
    const tap = { at: dip.params.dipAtMs + 10, place: 0 };
    expect(judgeAttempt(dip, [tap], tap.at + CLOCK_SLACK_MS)).not.toBe('miss');
    expect(judgeAttempt(dip, [tap], tap.at - CLOCK_SLACK_MS - 1)).toBe('miss');
    expect(judgeAttempt(dip, [tap, { at: 0, place: 0 }], 9_000)).toBe('miss');
    expect(judgeAttempt(dip, [{ at: dip.params.dipAtMs - GRACE_MS - 1, place: 0 }], 9_000)).toBe('miss');
    expect(judgeAttempt(dip, [{ at: dip.params.dipAtMs + dip.params.windowMs, place: 0 }], 9_000)).toBe('success');
  });

  it('sweeps the marker to the end of its track and back', () => {
    expect([0, 800, 1_600, 2_400, 3_200].map((ms) => markerAt(1_600, ms))).toEqual([0, 500, 1_000, 500, 0]);
  });
});

describe('the job board', () => {
  const opened = openBoard(courier(), 42, storyContent);

  it('draws the same board from the same seed, never a template twice, and only what the player can do', () => {
    expect(openBoard(courier(), 42, storyContent)).toEqual(opened);
    const board = opened.jobs!.board;
    expect(board).toHaveLength(skills.slots);
    expect(new Set(board.map((job) => job.template)).size).toBe(board.length);
    expect(board.every((job) => skills.templates.get(job.template)!.needs.level === 1)).toBe(true);
    expect(drawJob(opened, skills)).toEqual(drawJob(opened, skills));
    expect(opened.jobs).toMatchObject({ seed: 42, drawn: skills.slots, done: 0 });
    expect(openBoard(opened, 7, storyContent)).toEqual(opened);
  });

  it('counts gathers for a gather job and finishes it with its rewards, drawing the next', () => {
    const board = { seed: 1, drawn: 1, done: 0, board: [{ job: 1, template: 'berries-please', item: 'cloudberry', count: 2, to: null, progress: 0 }] };
    const once = jobEvent(courier([], { jobs: board }), { kind: 'gathered', item: 'cloudberry', count: 1 }, storyContent);
    expect(once.changes).toEqual([{ job: 1, change: 'progress', progress: 1, rewards: null, next: null }]);
    const twice = skillEvent(once.progress, { kind: 'gathered', item: 'cloudberry', count: 2 }, storyContent);
    expect(twice.jobs[0]).toMatchObject({ job: 1, change: 'done', progress: 2, rewards: { items: [{ item: 'plain-treat', count: 1 }], skills: [{ skill: 'foraging', xp: 12 }] } });
    expect(twice.jobs[0]?.next?.job).toBe(2);
    expect(twice.progress.jobs).toMatchObject({ done: 1, drawn: skills.slots + 1 });
    expect(twice.progress.inventory).toEqual([{ item: 'plain-treat', count: 1 }]);
  });

  it('hands a delivery to its character only with all its items, and marks them for it', () => {
    const job = { job: 1, template: 'berries-for-the-post', item: 'cloudberry', count: 3, to: 'bavko', progress: 0 };
    const waiting = courier([{ item: 'cloudberry', count: 2 }], { jobs: { seed: 1, drawn: 1, done: 0, board: [job] } });
    expect(deliverJob(waiting, 'bavko', storyContent)).toBeNull();
    const ready = { ...waiting, inventory: [{ item: 'cloudberry', count: 3 }] };
    expect(npcMarks(ready, storyContent)).toContainEqual({ npc: 'bavko', mark: 'turnIn' });
    expect(deliverJob(ready, 'tobolko', storyContent)).toBeNull();
    const delivered = deliverJob(ready, 'bavko', storyContent)!;
    expect(delivered.jobs[0]).toMatchObject({ job: 1, change: 'done', progress: 3, rewards: { items: [{ item: 'berry-bun', count: 1 }] } });
    expect(delivered.progress.inventory).toEqual([{ item: 'berry-bun', count: 1 }]);
    expect(jobsView(delivered.progress, storyContent).board.every((view) => view.job > 1)).toBe(true);
  });

  it('drops jobs whose template, item or character is gone, and the next open refills the board', () => {
    const board = opened.jobs!.board;
    const broken = { ...opened.jobs!, board: [{ ...board[0]!, template: 'gone-job' }, { ...board[1]!, item: 'gone-item' }, board[2]!] };
    const pruned = pruneJobs(broken, storyContent);
    expect(pruned.dropped).toEqual(['gone-job', board[1]!.template]);
    expect(pruned.jobs?.board).toEqual([board[2]]);
    expect(openBoard({ ...opened, jobs: pruned.jobs }, 0, storyContent).jobs?.board).toHaveLength(skills.slots);
    expect(pruneJobs(null, storyContent)).toEqual({ jobs: null, dropped: [] });
  });
});

describe('the side chapter', () => {
  const mainQuests = storyContent.chapters.filter((chapter) => !chapter.side).flatMap((chapter) => chapter.quests);

  it('waits until the main story has nothing to do, then offers Treats from Scratch', () => {
    const midway = courier([], { story: { active: [], done: ['first-round', 'restless-grass', 'a-new-friend'], flags: [] } });
    expect(nextGoal(midway, storyContent)).not.toMatchObject({ quest: 'treats-from-scratch' });
    const finished = courier([], { story: { active: [], done: mainQuests, flags: storyContent.chapters.flatMap((chapter) => chapter.endsWith ?? []) } });
    expect(nextGoal(finished, storyContent)).toMatchObject({ kind: 'newQuest', quest: 'treats-from-scratch', npc: 'tobolko' });
  });

  it('is played to its end by the story bot, after every main chapter', () => {
    const played = playStory(emptyProgress(), liveStory, 400);
    expect(played.stuck).toBe(false);
    const side = storyContent.chapters.filter((chapter) => chapter.side).flatMap((chapter) => chapter.quests);
    expect(side).toContain('treats-from-scratch');
    expect(side.filter((quest) => !played.progress.story.done.includes(quest))).toEqual([]);
  });

  it('counts gathered berries, cooked buns and finished jobs for its steps', () => {
    const picking = courier([], { story: { active: [{ quest: 'treats-from-scratch', step: 0, count: 0 }], done: [], flags: [] } });
    const picked = questEvent(picking, { kind: 'gathered', item: 'cloudberry', count: 2 }, storyContent);
    expect(picked.progress.story.active).toEqual([{ quest: 'treats-from-scratch', step: 0, count: 2 }]);
    const three = questEvent(picked.progress, { kind: 'gathered', item: 'cloudberry', count: 2 }, storyContent);
    expect(three.progress.story.active).toEqual([{ quest: 'treats-from-scratch', step: 1, count: 0 }]);
    const baked = questEvent(three.progress, { kind: 'cooked', item: 'berry-bun', count: 1 }, storyContent);
    expect(baked.progress.story.active[0]?.step).toBe(2);
  });
});
