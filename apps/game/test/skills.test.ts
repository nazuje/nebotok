import {
  CLIENT_MESSAGES,
  GRACE_MS,
  MARKER_TRACK,
  createRng,
  emptyProgress,
  judgeAttempt,
  mapFromRows,
  markerAt,
  perfectTaps,
  planAttempt,
  type AttemptPlan,
  type Difficulty,
  type GameKind,
  type Goal,
  type Progress,
  type QuestStep,
  type SkillResultMessage,
  type Tap,
  type WorldMap,
} from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { itemName } from '../src/battle-content.ts';
import { recipePage, recipeStars } from '../src/recipe-book.ts';
import { EARLIEST_FINISH_MS, attemptItem, resultLine } from '../src/skill-game.ts';
import { dipBob, dipEndsMs, dipPhase } from '../src/skill-games/dip.ts';
import { MARKER_STEP, markerEndsMs, markerShown } from '../src/skill-games/marker.ts';
import { shownSparkle, sparkleEndsMs, sparkleHit } from '../src/skill-games/sparkle.ts';
import { SKILL_REQUESTS, refusalLines, resultNews } from '../src/skills-link.ts';
import { nextUnlock, skillRows } from '../src/skills-panel.ts';
import { STORY } from '../src/story-content.ts';
import { goalTile, spotUsable } from '../src/story-link.ts';
import { format } from '../src/strings.ts';

const SKILLS = STORY.skills!;
const DIFFICULTIES: readonly Difficulty[] = [1, 2, 3];
const SEEDS = 40;

/** Plans of `game` at every difficulty over many seeds. */
function plans<G extends GameKind>(game: G): Extract<AttemptPlan, { game: G }>[] {
  return DIFFICULTIES.flatMap((difficulty) => Array.from({ length: SEEDS }, (_, seed) => planAttempt(game, difficulty, createRng(`${game}-${difficulty}-${seed}`), SKILLS.games) as Extract<AttemptPlan, { game: G }>));
}

/** Every `step` ms from 0 to `to`. */
const ticks = (to: number, step: number): number[] => Array.from({ length: Math.floor(to / step) + 1 }, (_, at) => at * step);

/** How the server judges taps the card reports: the card never finishes before EARLIEST_FINISH_MS. */
const judged = (plan: AttemptPlan, taps: readonly Tap[]) => judgeAttempt(plan, taps, Math.max(EARLIEST_FINISH_MS, taps.at(-1)?.at ?? 0));

describe('fishing (dip)', () => {
  it('counts every tap while the float shows dipped, and none well before', () => {
    for (const plan of plans('dip')) {
      const wrong = ticks(dipEndsMs(plan.params) + 300, 10).filter((ms) => {
        const missed = judged(plan, [{ at: ms, place: 0 }]) === 'miss';
        const tooEarly = ms < plan.params.dipAtMs - GRACE_MS || ms > dipEndsMs(plan.params);
        return (dipPhase(plan.params, ms) === 'dip' && missed) || (tooEarly && !missed);
      });
      expect(wrong).toEqual([]);
      expect(judged(plan, perfectTaps(plan))).toBe('perfect');
      expect(dipEndsMs(plan.params)).toBe(plan.endsByMs + GRACE_MS);
    }
  });

  it('bobs the waiting float gently, and not at all with reduced motion', () => {
    const bobs = Array.from({ length: 100 }, (_, at) => at * 37);
    expect(bobs.every((ms) => dipBob(ms, true) === 0)).toBe(true);
    expect(bobs.some((ms) => dipBob(ms, false) !== 0)).toBe(true);
    expect(bobs.every((ms) => Math.abs(dipBob(ms, false)) <= 4)).toBe(true);
  });
});

describe('foraging (sparkle)', () => {
  it('wins perfectly for a player who taps each sparkle a moment after it shows', () => {
    for (const plan of plans('sparkle')) {
      const hit = new Set<number>();
      const taps: Tap[] = [];
      let seen = -1;
      let seenAt = 0;
      for (let ms = 0; ms <= sparkleEndsMs(plan.params); ms += 10) {
        const shown = shownSparkle(plan.params, hit, ms);
        if (shown === null) continue;
        if (seen !== shown) {
          seen = shown;
          seenAt = ms;
        }
        if (ms - seenAt < 300) continue;
        const place = plan.params.sparkles[shown]!.place;
        const counted = sparkleHit(plan.params, hit, place, ms);
        expect(counted).toBe(shown);
        hit.add(shown);
        taps.push({ at: ms, place });
      }
      expect(hit.size).toBe(plan.params.sparkles.length);
      expect(judged(plan, taps)).toBe('perfect');
      expect(sparkleEndsMs(plan.params)).toBe(plan.endsByMs + GRACE_MS);
    }
  });

  it('counts the same sparkles as the server for any taps', () => {
    const rng = createRng('sparkle-taps');
    for (const plan of plans('sparkle')) {
      const hit = new Set<number>();
      const reported: Tap[] = [];
      const times = Array.from({ length: 12 }, () => rng.int(0, sparkleEndsMs(plan.params) + 200)).toSorted((a, b) => a - b);
      for (const at of times) {
        const place = rng.int(0, 3);
        const counted = sparkleHit(plan.params, hit, place, at);
        // The card reports only taps that hit a sparkle, so a stray tap never costs one.
        if (counted === null) continue;
        hit.add(counted);
        reported.push({ at, place });
      }
      const expected = hit.size === plan.params.sparkles.length ? 'perfect' : hit.size >= plan.params.need ? 'success' : 'miss';
      expect(judged(plan, reported)).toBe(expected);
    }
  });
});

describe('cooking (marker)', () => {
  it('draws the marker where the server judges it, and wins in the zone', () => {
    for (const plan of plans('marker')) {
      const { params } = plan;
      const wrong = ticks(params.timeoutMs, 7).filter((ms) => {
        const shown = markerShown(params, ms, false);
        const outcome = judged(plan, [{ at: ms, place: 0 }]);
        const inPerfect = shown >= params.perfectFrom && shown <= params.perfectTo;
        const inZone = shown >= params.zoneFrom && shown <= params.zoneTo;
        return shown !== markerAt(params.sweepMs, ms) || (inPerfect && outcome !== 'perfect') || (inZone && outcome === 'miss');
      });
      expect(wrong).toEqual([]);
      expect(judged(plan, [{ at: markerEndsMs(params) + 1, place: 0 }])).toBe('miss');
      expect(markerEndsMs(params)).toBe(plan.endsByMs + GRACE_MS);
    }
  });

  it('steps in tenths with reduced motion, close enough that a stop in the zone still counts', () => {
    for (const plan of plans('marker')) {
      const { params } = plan;
      const wrong = ticks(params.timeoutMs + 500, 11).filter((ms) => {
        const shown = markerShown(params, ms, true);
        const offTrack = shown % MARKER_STEP !== 0 || shown < 0 || shown > MARKER_TRACK;
        const tooFar = Math.abs(shown - markerAt(params.sweepMs, Math.min(ms, params.timeoutMs))) > MARKER_STEP / 2;
        const inZone = ms <= params.timeoutMs && shown >= params.zoneFrom && shown <= params.zoneTo;
        return offTrack || tooFar || (inZone && judged(plan, [{ at: ms, place: 0 }]) === 'miss');
      });
      expect(wrong).toEqual([]);
      expect(markerShown(params, params.timeoutMs + 400, true)).toBe(markerShown(params, params.timeoutMs, true));
    }
  });
});

const cookingLevel = (level: number, inventory: Progress['inventory']): Progress => ({ ...emptyProgress(), inventory, skills: [{ skill: 'cooking', level, xp: 0 }] });

describe('the recipe book', () => {
  const bun = SKILLS.recipes.get('berry-bun')!;
  const berry = bun.ingredients[0]!;

  it('lists what the level unlocks, what the bag has, and the next locked recipe', () => {
    const page = recipePage(cookingLevel(1, [{ item: berry.item, count: berry.count }]), STORY);
    expect(page.rows.map((row) => row.recipe)).toEqual(['berry-bun']);
    expect(page.rows[0]).toMatchObject({ blocked: null, ingredients: [{ item: berry.item, have: berry.count, need: berry.count }] });
    expect(page.next).toEqual({ recipe: 'fish-biscuit', makes: SKILLS.recipes.get('fish-biscuit')!.makes, level: SKILLS.recipes.get('fish-biscuit')!.level });
  });

  it('says why Cook cannot work: too few ingredients, or no room for the dish', () => {
    expect(recipePage(cookingLevel(1, []), STORY).rows[0]?.blocked).toBe('noItem');
    const full = [
      { item: berry.item, count: berry.count },
      { item: bun.makes, count: 99 },
    ];
    expect(recipePage(cookingLevel(1, full), STORY).rows[0]?.blocked).toBe('bagFull');
  });

  it('shows strength as one to five stars', () => {
    expect([0, 5, 6, 10, 15, 20, 30].map(recipeStars)).toEqual([1, 1, 2, 2, 3, 4, 5]);
  });
});

describe('the Skills tab', () => {
  it('names the next level that unlocks something, and nothing past the last', () => {
    const fishing = [...SKILLS.spots.values()].filter((spot) => spot.skill === 'fishing').toSorted((a, b) => a.level - b.level);
    expect(nextUnlock('fishing', 1, STORY)).toEqual({ level: fishing[1]!.level, items: [fishing[1]!.item] });
    expect(nextUnlock('fishing', fishing.at(-1)!.level, STORY)).toBeNull();
    expect(nextUnlock('cooking', 1, STORY)?.items).toEqual([SKILLS.recipes.get('fish-biscuit')!.makes]);
  });

  it('fills the XP bar toward the next level, and leaves it empty at the top', () => {
    const rows = skillRows({ skills: [{ skill: 'foraging', level: 2, xp: 20, toNext: 35 }, { skill: 'fishing', level: 20, xp: 0, toNext: 0 }], resting: [] }, STORY);
    expect(rows.map(({ xp, of }) => [xp, of])).toEqual([
      [20, 55],
      [0, 0],
    ]);
  });
});

const result = (fields: Partial<SkillResultMessage>): SkillResultMessage => ({ attempt: 1, outcome: 'perfect', items: [], used: [], extra: [], skill: 'fishing', xp: 10, level: 2, levelUp: false, restMs: 30_000, ...fields });

describe('skill news', () => {
  const pebbleCove = SKILLS.spots.get('pebble-cove')!;

  it('says what a game gave on the card', () => {
    expect(resultLine(result({ items: [{ item: pebbleCove.item, count: 2 }] }), 'en')).toBe(`Perfect! +2 ${itemName(pebbleCove.item, 'en')}`);
    expect(resultLine(result({ outcome: 'success', items: [{ item: pebbleCove.item, count: 1 }] }), 'sl')).toBe(format('skill.success', 'sl', { count: 1, item: itemName(pebbleCove.item, 'sl') }));
    expect(resultLine(result({ outcome: 'miss' }), 'en')).toBe('So close! Try again.');
    expect(attemptItem({ spot: 'pebble-cove', recipe: null })).toBe(pebbleCove.item);
    expect(attemptItem({ spot: null, recipe: 'berry-bun' })).toBe(SKILLS.recipes.get('berry-bun')!.makes);
  });

  it('toasts items, what did not fit and level-ups with their unlocks, and nothing for a miss', () => {
    expect(resultNews(result({ outcome: 'miss' }), STORY)).toEqual([]);
    const news = resultNews(result({ items: [{ item: pebbleCove.item, count: 1 }], extra: [{ item: pebbleCove.item, count: 1 }], level: 6, levelUp: true }), STORY);
    expect(news.map(({ tone }) => tone)).toEqual(['good', 'good']);
    expect(news[0]!.lines('en')).toEqual([format('skill.gained', 'en', { item: itemName(pebbleCove.item, 'en'), count: 1 }), `No room for more: ${itemName(pebbleCove.item, 'en')}`]);
    const ledge = SKILLS.spots.get('breezy-ledge')!;
    expect(news[1]!.lines('en')).toEqual([`${SKILLS.skills.get('fishing')!.name.en} level 6!`, ledge.name.en]);
  });

  it('explains a start turned down: the rest left, the level needed, a full bag', () => {
    expect(refusalLines('resting', { spot: 'pebble-cove' }, 12_300, STORY)('en')[0]).toContain('13');
    expect(refusalLines('needsLevel', { spot: 'glimmer-drop' }, 0, STORY)('sl')).toEqual([format('skill.needsLevel', 'sl', { skill: SKILLS.skills.get('fishing')!.name.sl, level: 12 })]);
    expect(refusalLines('bagFull', { recipe: 'berry-bun', station: 'post-pot' }, 0, STORY)('en')).toEqual([`No room for more: ${itemName(SKILLS.recipes.get('berry-bun')!.makes, 'en')}`]);
    expect(SKILL_REQUESTS.has(CLIENT_MESSAGES.gatherStart)).toBe(true);
  });
});

describe('where next for skills', () => {
  const hint = { en: 'Go on.', sl: 'Kar naprej.' };
  const goal = (fields: Record<string, unknown>): Goal => ({ kind: 'step', quest: 'q', step: { id: 'a-step', hint, ...fields } as QuestStep, left: 1 });
  const berry = SKILLS.spots.get('cloudberry-bush-a')!.item;
  const mint = SKILLS.spots.get('skymint-patch-a')!.item;
  const map: WorldMap = {
    ...mapFromRows('test', ['.........', '.........', '.........', '.........']),
    spots: { 'cloudberry-bush-a': { x: 0, y: 3 }, 'cloudberry-bush-b': { x: 8, y: 0 }, 'skymint-patch-a': { x: 4, y: 2 } },
    stations: { 'post-pot': { x: 2, y: 2 }, 'post-board': { x: 6, y: 1 } },
  };

  it('goes to the nearest spot of the item, the pot or the board', () => {
    expect(goalTile(goal({ kind: 'gather', item: berry, count: 3 }), map, { from: { x: 7, y: 0 }, usable: () => true })).toEqual({ x: 8, y: 0 });
    expect(goalTile(goal({ kind: 'gather', item: berry, count: 3 }), map, { from: { x: 1, y: 3 }, usable: () => true })).toEqual({ x: 0, y: 3 });
    expect(goalTile(goal({ kind: 'cook', treat: SKILLS.recipes.get('berry-bun')!.makes, count: 1 }), map)).toEqual({ x: 2, y: 2 });
    expect(goalTile(goal({ kind: 'finishJobs', count: 1 }), map)).toEqual({ x: 6, y: 1 });
  });

  it('knows which spots a level is high enough for', () => {
    expect(spotUsable('cloudberry-bush-a', null)).toBe(true);
    expect(spotUsable('skymint-patch-a', null)).toBe(false);
    expect(spotUsable('skymint-patch-a', { skills: [{ skill: 'foraging', level: 5, xp: 0, toNext: 10 }], resting: [] })).toBe(true);
    expect(goalTile(goal({ kind: 'gather', item: mint, count: 1 }), map, { from: { x: 0, y: 0 }, usable: (spot) => spotUsable(spot, null) })).toEqual({ x: 4, y: 2 });
  });
});
