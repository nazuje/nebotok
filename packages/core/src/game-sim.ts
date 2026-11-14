/**
 * A child playing the tiny games, to tune their timings: `childTaps` plays a planned game the way
 * an attentive 8-year-old might, and `simulateGames` gives how often that child gets a perfect, a
 * success or a miss in each game at each difficulty. `node scripts/skill-sim.mjs` prints the table.
 */
import { FADE_MS, MARKER_TRACK, judgeAttempt, planAttempt, type AttemptOutcome, type AttemptPlan, type MarkerParams, type SparkleParams, type Tap } from './attempts.ts';
import { createRng, type Rng } from './rng.ts';
import { GAMES, type Difficulty, type GameKind, type GamesRules } from './skill-content.ts';

/**
 * How the child plays: each float dip or sparkle is tapped `reactMs` (a range) after it shows, and
 * the marker is stopped up to `markerErrorMs` early or late of the middle of its perfect band, on
 * its first pass after the child has watched it for `watchMs`.
 */
export type ChildModel = { readonly reactMs: readonly [number, number]; readonly markerErrorMs: number; readonly watchMs: number };

/** The child of the Slice C playtest: reactions of 330 to 650 ms, and stops about 110 ms off. */
export const CHILD_MODEL: ChildModel = { reactMs: [330, 650], markerErrorMs: 110, watchMs: 600 };

const react = (rng: Rng, model: ChildModel) => rng.int(model.reactMs[0], model.reactMs[1]);

/** Sparkles one at a time, as the browser shows them: each is tapped a reaction after it comes on show, if it still shows by then. */
function sparkleTaps(params: SparkleParams, rng: Rng, model: ChildModel): Tap[] {
  const taps: Tap[] = [];
  let free = 0;
  for (const sparkle of params.sparkles) {
    const gone = sparkle.atMs + sparkle.showMs + FADE_MS;
    const seen = Math.max(sparkle.atMs, free);
    const at = seen + react(rng, model);
    if (seen < gone && at < gone) {
      taps.push({ at, place: sparkle.place });
      free = at;
    } else {
      free = Math.max(free, gone);
    }
  }
  return taps;
}

/** The first time after `watchMs` that the marker passes the middle of its perfect band, either way. */
function markerAimMs(params: MarkerParams, watchMs: number): number {
  const middle = (params.perfectFrom + params.perfectTo) / 2;
  const there = Math.round((middle * params.sweepMs) / MARKER_TRACK);
  for (let sweep = 0; ; sweep += 1) {
    const out = 2 * sweep * params.sweepMs + there;
    if (out >= watchMs) return out;
    const back = 2 * (sweep + 1) * params.sweepMs - there;
    if (back >= watchMs) return back;
  }
}

/** The taps the child makes in `plan`. */
export function childTaps(plan: AttemptPlan, rng: Rng, model: ChildModel = CHILD_MODEL): Tap[] {
  if (plan.game === 'dip') return [{ at: plan.params.dipAtMs + react(rng, model), place: 0 }];
  if (plan.game === 'sparkle') return sparkleTaps(plan.params, rng, model);
  const at = markerAimMs(plan.params, model.watchMs) + rng.int(-model.markerErrorMs, model.markerErrorMs);
  return [{ at: Math.max(0, at), place: 0 }];
}

/** How the child's go at `plan` is judged, finishing once the game is over. */
export function childOutcome(plan: AttemptPlan, rng: Rng, model: ChildModel = CHILD_MODEL): AttemptOutcome {
  const taps = childTaps(plan, rng, model);
  return judgeAttempt(plan, taps, Math.max(plan.endsByMs, taps.at(-1)?.at ?? 0, 1_000));
}

const percent = (count: number, of: number) => Math.round((count * 100) / of);

/** Whole percents of perfects, successes and misses. */
export type GameRates = { readonly game: GameKind; readonly difficulty: Difficulty; readonly perfect: number; readonly success: number; readonly miss: number };

/** The child's rates in every game at every difficulty, over `runs` games each, seeded `game-sim:<game>:<difficulty>`. */
export function simulateGames(rules: GamesRules, runs: number, model: ChildModel = CHILD_MODEL): GameRates[] {
  return GAMES.flatMap((game) =>
    ([1, 2, 3] as const).map((difficulty) => {
      const rng = createRng(`game-sim:${game}:${difficulty}`);
      const tally: Record<AttemptOutcome, number> = { perfect: 0, success: 0, miss: 0 };
      for (let at = 0; at < runs; at += 1) tally[childOutcome(planAttempt(game, difficulty, rng, rules), rng, model)] += 1;
      return { game, difficulty, perfect: percent(tally.perfect, runs), success: percent(tally.success, runs), miss: percent(tally.miss, runs) };
    }),
  );
}
