/**
 * The tiny game of one attempt, judged by the server. `planAttempt` rolls the game's parameters
 * with an RNG the server passes in; the browser plays them and reports its taps, timed from the
 * moment it drew the game; `judgeAttempt` compares those taps with the plan and with the server's
 * own clock. docs/protocol.md, "Skills and the job board", explains the timing rules.
 */
import type { Rng } from './rng.ts';
import type { Difficulty, GameKind, GamesRules } from './skill-content.ts';

/** A finish sooner than this after `skill.attempt` was sent is a miss, however the taps look. */
export const MIN_ATTEMPT_MS = 1_000;
/** A tap may claim to be this much later than the server's elapsed time, for clocks that tick a little apart. */
export const CLOCK_SLACK_MS = 50;
/**
 * A dipped float and a sparkle fade out over this long once their time is up, and a tap while they
 * fade still counts: the grace for frame timing and touch delay is drawn, so what counts is what shows.
 */
export const FADE_MS = 100;
/** The server waits the game's own length plus this for `skill.finish`; after that the attempt ends `late`. */
export const LATE_MS = 5_000;
/** The first sparkle shows this long after the game is drawn. */
export const SPARKLE_FIRST_MS = 300;
/** Places a sparkle can show at, numbered 0 up. */
export const SPARKLE_PLACES = 4;
/** The most taps one attempt reports. */
export const MAX_TAPS = 8;
/** The latest a tap may be, in ms after the game was drawn. */
export const MAX_TAP_MS = 20_000;
/** The marker sweeps a track this long, from 0 to here and back. */
export const MARKER_TRACK = 1_000;
/** The marker's zone keeps this far from either end of the track, where the marker turns. */
export const MARKER_MARGIN = 150;
/**
 * Half the width of the marker's needle, in track units: the needle is drawn this far either side
 * of its position, and a stop counts for a band whenever any part of the needle touches it.
 */
export const MARKER_HALF_WIDTH = 20;
/** A tap of the player's: `at` ms after the game was drawn, at sparkle `place` (0 for dip and marker). */
export type Tap = { readonly at: number; readonly place: number };

export type DipParams = { readonly dipAtMs: number; readonly windowMs: number; readonly perfectMs: number };
export type Sparkle = { readonly place: number; readonly atMs: number; readonly showMs: number };
export type SparkleParams = { readonly sparkles: readonly Sparkle[]; readonly need: number };
export type MarkerParams = { readonly sweepMs: number; readonly zoneFrom: number; readonly zoneTo: number; readonly perfectFrom: number; readonly perfectTo: number; readonly timeoutMs: number };

/** One planned game: its parameters, as `skill.attempt` sends them, and `endsByMs`, when the game is over on its own. */
export type AttemptPlan =
  | { readonly game: 'dip'; readonly params: DipParams; readonly endsByMs: number }
  | { readonly game: 'sparkle'; readonly params: SparkleParams; readonly endsByMs: number }
  | { readonly game: 'marker'; readonly params: MarkerParams; readonly endsByMs: number };

export type AttemptOutcome = 'perfect' | 'success' | 'miss';

const pickBy = <T>(list: readonly [T, T, T], difficulty: Difficulty): T => list[difficulty - 1] as T;

function planSparkles(rules: GamesRules['sparkle'], difficulty: Difficulty, rng: Rng): AttemptPlan {
  const showMs = pickBy(rules.showMs, difficulty);
  const sparkles: Sparkle[] = [];
  let atMs = SPARKLE_FIRST_MS;
  for (let at = 0; at < rules.count; at += 1) {
    if (at > 0) atMs += rng.int(rules.gapMs[0], rules.gapMs[1]);
    // A sparkle at the place of one that still shows or fades would look like that one staying.
    const held = new Set(sparkles.filter((other) => other.atMs + other.showMs + FADE_MS >= atMs).map((other) => other.place));
    const free = Array.from({ length: SPARKLE_PLACES }, (_, place) => place).filter((place) => !held.has(place));
    sparkles.push({ place: rng.pick(free), atMs, showMs });
  }
  return { game: 'sparkle', params: { sparkles, need: rules.need }, endsByMs: atMs + showMs + FADE_MS };
}

/** The seeded parameters of one game at `difficulty` (1 to 3), from the numbers in skills.json. */
export function planAttempt(game: GameKind, difficulty: Difficulty, rng: Rng, rules: GamesRules): AttemptPlan {
  if (game === 'dip') {
    const dipAtMs = rng.int(rules.dip.waitMs[0], rules.dip.waitMs[1]);
    const windowMs = pickBy(rules.dip.windowMs, difficulty);
    return { game, params: { dipAtMs, windowMs, perfectMs: pickBy(rules.dip.perfectMs, difficulty) }, endsByMs: dipAtMs + windowMs + FADE_MS };
  }
  if (game === 'sparkle') return planSparkles(rules.sparkle, difficulty, rng);
  const zone = pickBy(rules.marker.zone, difficulty);
  const perfect = pickBy(rules.marker.perfect, difficulty);
  const zoneFrom = rng.int(MARKER_MARGIN, MARKER_TRACK - MARKER_MARGIN - zone);
  const perfectFrom = zoneFrom + Math.floor((zone - perfect) / 2);
  const params = { sweepMs: pickBy(rules.marker.sweepMs, difficulty), zoneFrom, zoneTo: zoneFrom + zone, perfectFrom, perfectTo: perfectFrom + perfect, timeoutMs: rules.marker.timeoutMs };
  return { game, params, endsByMs: rules.marker.timeoutMs };
}

/** Where the marker is `at` ms into the game: it starts at 0 and sweeps to MARKER_TRACK and back, each way in `sweepMs`. */
export function markerAt(sweepMs: number, at: number): number {
  const phase = at % (2 * sweepMs);
  const travelled = phase <= sweepMs ? phase : 2 * sweepMs - phase;
  return Math.floor((travelled * MARKER_TRACK) / sweepMs);
}

/** Where the float is `ms` after the game was drawn: bobbing, dipped (tap now!), fading back up, or up again. */
export type DipPhase = 'wait' | 'dip' | 'fading' | 'over';

export function dipPhase(params: DipParams, ms: number): DipPhase {
  if (ms < params.dipAtMs) return 'wait';
  const after = ms - params.dipAtMs;
  if (after < params.windowMs) return 'dip';
  return after < params.windowMs + FADE_MS ? 'fading' : 'over';
}

/**
 * The sparkle on show `ms` after the game was drawn, given the sparkles already `hit`: the earliest
 * one not yet tapped whose time has come and whose fade is not over, so only one shows at a time.
 * Null when none does. The browser draws this one, and only a tap at its place counts.
 */
export function shownSparkle(params: SparkleParams, hit: ReadonlySet<number>, ms: number): number | null {
  const at = params.sparkles.findIndex((sparkle, index) => !hit.has(index) && ms >= sparkle.atMs && ms < sparkle.atMs + sparkle.showMs + FADE_MS);
  return at >= 0 ? at : null;
}

/** Whether the sparkle on show at `ms` is fading: its time is up but its fade is not. */
export function sparkleFading(sparkle: Sparkle, ms: number): boolean {
  return ms >= sparkle.atMs + sparkle.showMs;
}

/** The sparkle a tap at `place`, `ms` after the game was drawn, picks: the one on show, if it is at that place. */
export function sparkleHit(params: SparkleParams, hit: ReadonlySet<number>, place: number, ms: number): number | null {
  const shown = shownSparkle(params, hit, ms);
  return shown !== null && params.sparkles[shown]?.place === place ? shown : null;
}

const within = (value: number, from: number, to: number) => value >= from && value <= to;

function judgeDip(params: DipParams, tap: Tap | undefined): AttemptOutcome {
  if (!tap) return 'miss';
  const phase = dipPhase(params, tap.at);
  if (phase === 'wait' || phase === 'over') return 'miss';
  return tap.at - params.dipAtMs < params.perfectMs ? 'perfect' : 'success';
}

function judgeSparkles(params: SparkleParams, taps: readonly Tap[]): AttemptOutcome {
  const hit = new Set<number>();
  for (const tap of taps) {
    const found = sparkleHit(params, hit, tap.place, tap.at);
    if (found !== null) hit.add(found);
  }
  if (hit.size === params.sparkles.length) return 'perfect';
  return hit.size >= params.need ? 'success' : 'miss';
}

/** Whether the needle at `position` touches the band `from` to `to`. */
const touches = (position: number, from: number, to: number) => within(position, from - MARKER_HALF_WIDTH, to + MARKER_HALF_WIDTH);

function judgeMarker(params: MarkerParams, tap: Tap | undefined): AttemptOutcome {
  if (!tap || tap.at > params.timeoutMs) return 'miss';
  const position = markerAt(params.sweepMs, tap.at);
  if (touches(position, params.perfectFrom, params.perfectTo)) return 'perfect';
  return touches(position, params.zoneFrom, params.zoneTo) ? 'success' : 'miss';
}

/**
 * How an attempt went, from the taps the browser reported and `elapsedMs`, the server's own time
 * since it sent `skill.attempt`. A finish before MIN_ATTEMPT_MS, taps out of order, or a tap later
 * than `elapsedMs` + CLOCK_SLACK_MS (it had not happened yet) is a miss. What counts is what the
 * browser draws: a dip tap while the float is dipped or fading, a sparkle tap at the sparkle on show
 * (`shownSparkle`), and a marker stop where its needle touches the zone. Dip and marker count the
 * first tap only.
 */
export function judgeAttempt(plan: AttemptPlan, taps: readonly Tap[], elapsedMs: number): AttemptOutcome {
  if (elapsedMs < MIN_ATTEMPT_MS) return 'miss';
  if (taps.some((tap, at) => tap.at > elapsedMs + CLOCK_SLACK_MS || (at > 0 && tap.at < (taps[at - 1]?.at ?? 0)))) return 'miss';
  if (plan.game === 'dip') return judgeDip(plan.params, taps[0]);
  if (plan.game === 'sparkle') return judgeSparkles(plan.params, taps);
  return judgeMarker(plan.params, taps[0]);
}

/** When the server stops waiting for `skill.finish`, in ms after it sent `skill.attempt`: the attempt is then `late`. */
export function attemptDeadlineMs(plan: AttemptPlan): number {
  return plan.endsByMs + LATE_MS;
}

/** The taps of a player who plays `plan` perfectly, for bots and tests. */
export function perfectTaps(plan: AttemptPlan): Tap[] {
  if (plan.game === 'dip') return [{ at: plan.params.dipAtMs + 1, place: 0 }];
  if (plan.game === 'sparkle') return plan.params.sparkles.map((sparkle) => ({ at: sparkle.atMs + 1, place: sparkle.place }));
  const { sweepMs, perfectFrom, perfectTo } = plan.params;
  const middle = Math.floor((perfectFrom + perfectTo) / 2);
  return [{ at: Math.floor((middle * sweepMs) / MARKER_TRACK) + 1, place: 0 }];
}
