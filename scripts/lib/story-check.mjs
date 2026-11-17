// The bag, the journal and a quest toast, played the way a player would against the real server.
// The player starts from a save the check prepares (scripts/lib/prepared-saves.mjs): the first quest
// in story order with a step done by resting at a shrine on the map is active, at the delivery just
// before that step (carrying it) or else at that step, with every quest it needs done, and the bag
// holds a few treats. The player opens the bag and reads about a treat, opens the journal and finds
// the quest's card, asks "Where next?" and taps the compass and sees the camera go to the goal,
// hands the delivery over and sees the banner of a step done, walks to the shrine and sees the
// banner of the quest done, and finds the quest moved on in the journal. While no quest has such a
// step, the first quest is active at its first step instead, with its delivery (if any) in the bag,
// and the banners are left out with a note.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadBattleContent, loadStoryContent, newCreature, PLAYER_SPAWN, stepPictures } from '../../packages/core/src/index.ts';
import { inTurn } from './in-turn.mjs';
import { CONTROL_PICTURES, hurryThrough, nextFrames, openTalk, pictureProblems, readState, tilesToScreen, until, walkByTaps } from './game-page.mjs';
import { ROOT } from './server-process.mjs';

const readContent = (path) => JSON.parse(readFileSync(join(ROOT, 'content', path), 'utf8'));
const CONTENT = loadBattleContent({
  weather: readContent('creatures/weather.json'),
  moves: readContent('creatures/moves.json'),
  species: readContent('creatures/species.json'),
  rules: readContent('creatures/battle-rules.json'),
  befriending: readContent('creatures/befriending.json'),
  items: readContent('items.json'),
});
const dialogue = Object.fromEntries(
  readdirSync(join(ROOT, 'content/dialogue'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => [file.slice(0, -'.json'.length), readContent(`dialogue/${file}`)]),
);
const STORY = loadStoryContent(
  {
    npcs: readContent('npcs.json'), dialogue, quests: readContent('quests.json'), story: readContent('story.json'), inventory: readContent('inventory.json'),
    skills: { skills: readContent('skills.json'), spots: readContent('spots.json'), recipes: readContent('recipes.json'), stations: readContent('stations.json'), jobs: readContent('jobs.json') },
  },
  CONTENT,
);
const STARTERS = readContent('starters.json');
const TREATS = [...CONTENT.items.values()].filter((item) => item.kind === 'treat').slice(0, 3);
const TREATS_EACH = 2;
const BAG_ORDER = readContent('inventory.json').order;
/** The camera's pan in apps/game/src/world-scene.ts, and a little more for the frame after. */
const PAN_MS = 900;

const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();
const fill = (line, values) => line.replaceAll(/\{([a-zA-Z]+)\}/g, (blank, name) => (name in values ? String(values[name]) : blank));

/** Every quest `id` needs done first, and the ones those need, in story order. */
function needed(id) {
  const found = new Set();
  const visit = (quest) => {
    for (const before of STORY.quests.get(quest)?.requires ?? []) {
      if (found.has(before)) continue;
      found.add(before);
      visit(before);
    }
  };
  visit(id);
  return STORY.chapters.flatMap((chapter) => chapter.quests).filter((quest) => found.has(quest));
}

/**
 * The first quest in story order with a step done by resting at a shrine of `map`. When a delivery
 * to a character on the map comes just before it, the quest starts there, carrying what to deliver,
 * so handing it over moves the quest on a step and resting finishes it; else the quest starts at the
 * resting step. With no such quest, the first quest at its first step, with no toast to play.
 */
function storyPlan(map) {
  const order = STORY.chapters.flatMap((chapter) => chapter.quests);
  for (const id of order) {
    const quest = STORY.quests.get(id);
    const rest = quest.steps.findIndex((step) => step.kind === 'visitShrine' && map.shrines[step.shrine]);
    if (rest < 0) continue;
    const shrine = map.shrines[quest.steps[rest].shrine];
    const before = quest.steps[rest - 1];
    if (before?.kind === 'deliver' && map.npcs[before.to]) {
      return { quest, at: rest - 1, chapter: quest.chapter, tile: map.npcs[before.to], handover: before.to, shrine, toast: true, carried: [{ item: before.item, count: before.count }] };
    }
    return { quest, at: rest, chapter: quest.chapter, tile: shrine, handover: null, shrine, toast: true, carried: [] };
  }
  const quest = STORY.quests.get(order[0]);
  const [step] = quest.steps;
  const carried = step.kind === 'deliver' ? [{ item: step.item, count: step.count }] : [];
  return { quest, at: 0, chapter: quest.chapter, tile: null, handover: null, shrine: null, toast: false, carried };
}
/** The save the story check starts from, and what it plays: see the top of this file. */
export function storySave(world, { name, language }) {
  const plan = storyPlan(world.map);
  const starter = STARTERS.species[0];
  const inventory = [...plan.carried, ...TREATS.map((item) => ({ item: item.id, count: TREATS_EACH }))];
  return {
    plan: { ...plan, done: needed(plan.quest.id), inventory },
    data: {
      name,
      language,
      createdAt: new Date().toISOString(),
      position: null,
      team: [newCreature(starter, STARTERS.level, CONTENT)],
      storage: [],
      inventory,
      lastShrine: null,
      seen: [starter],
      befriended: [starter],
      story: { active: [{ quest: plan.quest.id, step: plan.at, count: 0 }], done: needed(plan.quest.id), flags: [] },
      skills: [],
      jobs: null,
    },
  };
}

/** The pictures on the bag's Close, and on the journal's tabs, Close and, when `folded`, the fold of done quests. */
const SCREEN_PICTURES = {
  bag: () => ({ '#bag .bag-close': CONTROL_PICTURES.close }),
  journal: (folded) => ({
    '#journal .journal-tab[data-tab="quests"]': CONTROL_PICTURES.quests,
    '#journal .journal-tab[data-tab="skills"]': CONTROL_PICTURES.skills,
    '#journal .journal-close': CONTROL_PICTURES.close,
    ...(folded ? { '#journal .journal-fold': CONTROL_PICTURES.done } : {}),
  }),
};

/** The bag: a section per kind it holds, in inventory.json order, each treat named and counted, and a tap saying what one is. */
async function lookInBag(page, plan, { language, say, expect, check }) {
  await page.locator('.bag-button').tap();
  await until(page, (s) => s.screen === 'bag' && s.bag !== null, 'the bag');
  await nextFrames(page);
  const kinds = await page.locator('#bag .bag-section').evaluateAll((sections) => sections.map((section) => section.dataset.kind));
  const held = new Set(plan.inventory.map(({ item }) => CONTENT.items.get(item).kind));
  const sections = BAG_ORDER.filter((kind) => held.has(kind));
  expect(JSON.stringify(kinds) === JSON.stringify(sections), `the bag shows the sections ${JSON.stringify(kinds)}, not ${JSON.stringify(sections)}`);
  const treats = page.locator('#bag .bag-section[data-kind="treat"]');
  const names = await treats.locator('.bag-name').allTextContents();
  const wanted = TREATS.map((item) => item.name[language]);
  expect(JSON.stringify(names) === JSON.stringify(wanted), `the bag lists ${JSON.stringify(names)}, not ${JSON.stringify(wanted)}`);
  const counts = await treats.locator('.bag-count').allTextContents();
  expect(counts.every((count) => count === fill(say('bag.count'), { count: TREATS_EACH })), `the bag counts ${JSON.stringify(counts)}`);
  await treats.locator('.bag-item').first().tap();
  await until(page, (s) => s.bag?.selected === TREATS[0].id, 'the bag to say what the first treat is');
  await nextFrames(page);
  const about = TREATS[0].description?.[language] ?? say('bag.treatAbout');
  expect((await textOf(page, '#bag .bag-about p')) === about, `the bag says "${await textOf(page, '#bag .bag-about p')}" about ${TREATS[0].id}`);
  for (const problem of await pictureProblems(page, SCREEN_PICTURES.bag(false))) expect(false, `the bag: ${problem}`);
  await check('the bag', 's1-bag');
  await page.locator('#bag .bag-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the bag');
}

/**
 * A quest card in the journal or the banner of a quest change shows who gave it, what to do as the
 * pictures of `step` (none past the last step) and a dot per step with `done` filled.
 */
async function picturesProblems(card, quest, step, done, { giver = true } = {}) {
  const problems = [];
  const goal = quest.steps[step] ? stepPictures(quest.steps[step], STORY).join(' ') : '';
  const shownGoal = (await card.locator('[data-goal]').count()) > 0 ? await card.locator('[data-goal]').first().getAttribute('data-goal') : '';
  if (shownGoal !== goal) problems.push(`shows the goal pictures "${shownGoal}", not "${goal}"`);
  const pips = card.locator('.quest-pips');
  const counted = { done: await pips.getAttribute('data-done'), of: await pips.getAttribute('data-of'), dots: await pips.locator('.quest-pip').count() };
  if (counted.done !== String(done) || counted.of !== String(quest.steps.length) || counted.dots !== quest.steps.length) problems.push(`shows the steps as ${JSON.stringify(counted)}, not ${done} of ${quest.steps.length} done`);
  if (giver && !(await card.locator('.journal-giver, .quest-banner-giver').isVisible())) problems.push(`shows no portrait of ${quest.giver}, who gave it`);
  return problems;
}

/** The journal: the quest's chapter, the quest's card with its pictures and its step's hint, and the quests done before it folded away. */
async function readJournal(page, plan, { language, say, expect, check }) {
  await page.locator('.journal-button').tap();
  const state = await until(page, (s) => s.screen === 'journal' && s.journal !== null, 'the journal');
  await nextFrames(page);
  const chapter = page.locator(`#journal .journal-chapter[data-chapter="${plan.chapter}"]`);
  const chapterName = STORY.chapters.find((each) => each.id === plan.chapter).name[language];
  expect((await chapter.locator('.journal-chapter-title').textContent()) === chapterName, `the journal's chapter is "${await chapter.locator('.journal-chapter-title').textContent()}", not "${chapterName}"`);
  const quest = chapter.locator(`.journal-quest[data-quest="${plan.quest.id}"]`);
  expect((await quest.locator('.journal-name').textContent()) === plan.quest.name[language], `the journal does not show the quest ${plan.quest.id}`);
  expect((await quest.locator('.journal-hint').textContent()) === plan.quest.steps[plan.at].hint[language], 'the journal does not show the step’s hint');
  for (const problem of await picturesProblems(quest, plan.quest, plan.at, plan.at)) expect(false, `the journal's card ${problem}`);
  const doneHere = plan.done.filter((id) => STORY.quests.get(id).chapter === plan.chapter).length;
  if (doneHere > 0) expect((await chapter.locator('.journal-fold').textContent()) === fill(say('journal.done'), { count: doneHere }), 'the journal’s done quests are not folded under their count');
  expect((await chapter.locator('.journal-done-list').isVisible()) === false, 'the journal’s done quests are not folded');
  if (plan.tile) expect(state.journal.goal?.x === plan.tile.x && state.journal.goal?.y === plan.tile.y, `"Where next?" goes to ${JSON.stringify(state.journal.goal)}, not ${plan.tile.x},${plan.tile.y}`);
  else expect(state.journal.goal !== null, '"Where next?" has nowhere to go');
  for (const problem of await pictureProblems(page, SCREEN_PICTURES.journal(doneHere > 0))) expect(false, `the journal: ${problem}`);
  await check('the journal', 's2-journal');
}

/** After "Where next?" or the compass, the camera goes to `goal` and rings it, then comes back. */
async function cameraOnGoal(page, goal, what, step, { expect, check }) {
  await until(page, (s) => s.screen === 'world' && s.looking?.x === goal.x && s.looking.y === goal.y, `the camera to look at the goal after ${what}`, 5_000);
  await page.waitForTimeout(PAN_MS);
  const [spot] = await tilesToScreen(page, [goal]);
  const { width, height } = page.viewportSize();
  expect(spot && Math.abs(spot.x - width / 2) < width / 4 && Math.abs(spot.y - height / 2) < height / 4, `after ${what} the goal is at ${JSON.stringify(spot)}, not near the middle of the screen`);
  await check(what, step);
  await until(page, (s) => s.looking === null, `the camera to come back from the goal after ${what}`, 5_000);
}

/** "Where next?" in the journal closes it and shows the goal; so does the compass on the world, a big button with a label for screen readers. */
async function whereNext(page, { language, say, expect, check }) {
  const { journal } = await readState(page);
  const goal = journal.goal;
  await page.locator('#journal .journal-where').tap();
  await cameraOnGoal(page, goal, '"Where next?"', 's3-where-next', { expect, check });
  const compass = page.locator('.compass-button');
  const { compass: shown } = await until(page, (s) => s.compass !== null, 'the compass on the world');
  expect(shown.x === goal.x && shown.y === goal.y, `the compass shows ${JSON.stringify(shown)}, not the journal's goal ${JSON.stringify(goal)}`);
  const box = await compass.boundingBox();
  expect(box && box.width >= 48 && box.height >= 48, `the compass is ${JSON.stringify(box)}, smaller than 48px`);
  expect((await compass.getAttribute('aria-label')) === say('journal.whereNext'), `the compass is labelled "${await compass.getAttribute('aria-label')}" in ${language}`);
  await compass.tap();
  await cameraOnGoal(page, goal, 'the compass', 's4-compass', { expect, check });
}

/**
 * The banner of a quest change: the words for readers, and the pictures (core `stepPictures`) of
 * what to do now with a dot per step done. A done quest shows its stamp and what it gave instead.
 */
async function seeBanner(page, plan, change, { language, say, expect, check }) {
  const toasted = await until(page, (s) => s.questToast?.quest === plan.quest.id && s.questToast.change === change, `the quest banner of the quest ${change === 'done' ? 'done' : 'moving on'}`, 15_000);
  const step = change === 'done' ? plan.quest.steps.length : toasted.questToast.banner.done;
  const head = fill(say(change === 'done' ? 'quest.done' : 'quest.stepDone'), { quest: plan.quest.name[language] });
  expect((await textOf(page, '.quest-toast .quest-toast-head')) === head, `the quest banner says "${await textOf(page, '.quest-toast .quest-toast-head')}", not "${head}"`);
  const banner = page.locator('.quest-toast');
  for (const problem of await picturesProblems(banner, plan.quest, step, step)) expect(false, `the quest banner ${problem}`);
  if (change === 'done') {
    expect(await banner.locator('.quest-banner-seal').isVisible(), 'the banner of a quest done shows no stamp');
    const rewards = (toasted.questToast.banner.rewards ?? []).map(({ item }) => item);
    const shown = await banner.locator('.quest-banner-rewards:not(.quest-banner-extra) .quest-item').evaluateAll((items) => items.map((item) => item.dataset.item));
    expect(JSON.stringify(shown) === JSON.stringify(rewards), `the banner shows the rewards ${JSON.stringify(shown)}, not ${JSON.stringify(rewards)}`);
  } else expect(await banner.locator('.quest-banner-check').isVisible(), 'the banner of a step done shows no tick');
  expect(toasted.journalNews && (await page.locator('.journal-dot').isVisible()), 'the journal button shows no news after the quest changed');
  // The stamp lands and the dot pops in under a second; the banner stays 4.5 s.
  await page.waitForTimeout(800);
  await check(change === 'done' ? 'the banner of a quest done' : 'the banner of a step done', change === 'done' ? 's6-banner-done' : 's5-banner-step');
}

/**
 * Plays the story part from the world, signed in as the prepared player: the bag, the journal,
 * "Where next?" and the compass, the banner on handing the delivery over (when the plan has one)
 * and on resting at the shrine, and the journal after it.
 */
export async function playStory(page, world, plan, { language, strings, expect, check, notes }) {
  const say = (id) => strings[id][language];
  await until(page, (s) => s.screen === 'world' && s.progress !== null && s.story?.active.some((entry) => entry.quest === plan.quest.id), 'the world with the prepared quest');
  await lookInBag(page, plan, { language, say, expect, check });
  await readJournal(page, plan, { language, say, expect, check });
  await whereNext(page, { language, say, expect, check });
  if (!plan.toast) {
    notes.push('no quest has a step done by resting at a shrine on this map, so the quest banner was not played');
    return;
  }

  if (plan.handover) {
    await openTalk(page, world, plan.handover, { notes });
    await hurryThrough(page);
    await seeBanner(page, plan, 'step', { language, say, expect, check });
    // The way to the character can end on the shrine, and a rest counts only on stepping onto it.
    await walkByTaps(page, world, world.map.spawns[PLAYER_SPAWN], { notes });
  } else notes.push(`no delivery comes before resting at the shrine in ${plan.quest.id}, so the banner of a step done was not played`);
  const last = plan.at + (plan.handover ? 1 : 0) === plan.quest.steps.length - 1;
  await walkByTaps(page, world, plan.shrine, { notes });
  await seeBanner(page, plan, last ? 'done' : 'step', { language, say, expect, check });

  await page.locator('.journal-button').tap();
  await until(page, (s) => s.screen === 'journal' && !s.journalNews, 'the journal with the news read');
  if (last) {
    await page.locator(`#journal .journal-chapter[data-chapter="${plan.chapter}"] .journal-fold`).tap();
    await until(page, (s) => s.journal?.unfolded.includes(plan.chapter), 'the done quests unfolded');
    await nextFrames(page);
    expect(await page.locator(`#journal .journal-done[data-quest="${plan.quest.id}"]`).isVisible(), 'the journal does not list the quest as done');
  } else {
    const { story } = await readState(page);
    expect(story.active.some((entry) => entry.quest === plan.quest.id && entry.step > plan.at), 'the quest did not move on to its next step');
  }
  await check('the journal after the quest', 's7-journal-after');
  await page.locator('#journal .journal-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the journal');
}

/** What is wrong with the journal's card of each active quest. */
async function cardsProblems(page, active) {
  const each = await Promise.all(
    active.map(async ({ quest: id, step }) => {
      const card = page.locator(`#journal .journal-quest[data-quest="${id}"]`);
      return (await picturesProblems(card, STORY.quests.get(id), step, step)).map((problem) => `the journal's card of ${id} at 360px ${problem}`);
    }),
  );
  return each.flat();
}

/**
 * At 360px wide, both screens open from the world and fit without scrolling sideways. The journal
 * shows every active quest as a card with pictures.
 */
export async function storyScreensFit(page, { noSideways, check, expect }) {
  await inTurn(['bag', 'journal'], async (screen) => {
    await page.locator(`.${screen}-button`).tap();
    const state = await until(page, (s) => s.screen === screen, `the ${screen} at 360px`);
    await nextFrames(page);
    await noSideways(`the ${screen}`);
    if (screen === 'journal') for (const problem of await cardsProblems(page, state.story?.active ?? [])) expect(false, problem);
    const folded = (await page.locator('#journal .journal-fold').count()) > 0;
    for (const problem of await pictureProblems(page, SCREEN_PICTURES[screen](folded))) expect(false, `the ${screen} at 360px: ${problem}`);
    await check(`the ${screen} at 360px`, screen);
    await page.locator(`#${screen} .team-foot .primary`).tap();
    await until(page, (s) => s.screen === 'world', `the world after the ${screen}`);
  });
}

/** A learner's story at 360px: the first quest in story order whose first step no battle moves on, at that step, with its delivery carried. */
export function learnerStory() {
  const order = STORY.chapters.flatMap((chapter) => chapter.quests);
  const quest = order.map((id) => STORY.quests.get(id)).find((each) => each.requires.length === 0 && ['talk', 'deliver'].includes(each.steps[0].kind));
  if (!quest) return { story: null, carried: [] };
  const [step] = quest.steps;
  return { story: { active: [{ quest: quest.id, step: 0, count: 0 }], done: [], flags: [] }, carried: step.kind === 'deliver' ? [{ item: step.item, count: step.count }] : [] };
}
