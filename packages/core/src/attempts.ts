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
/** Every window counts this much wider on each side than it is drawn, for frame timing and touch delay. */
export const GRACE_MS = 150;
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
    // A place held by a sparkle whose tap window still overlaps this one's would make a tap count twice.
    const held = new Set(sparkles.filter((other) => other.atMs + other.showMs + 2 * GRACE_MS >= atMs).map((other) => other.place));
    const free = Array.from({ length: SPARKLE_PLACES }, (_, place) => place).filter((place) => !held.has(place));
    sparkles.push({ place: rng.pick(free), atMs, showMs });
  }
  return { game: 'sparkle', params: { sparkles, need: rules.need }, endsByMs: atMs + showMs };
}

/** The seeded parameters of one game at `difficulty` (1 to 3), from the numbers in skills.json. */
export function planAttempt(game: GameKind, difficulty: Difficulty, rng: Rng, rules: GamesRules): AttemptPlan {
  if (game === 'dip') {
    const dipAtMs = rng.int(rules.dip.waitMs[0], rules.dip.waitMs[1]);
    const windowMs = pickBy(rules.dip.windowMs, difficulty);
    return { game, params: { dipAtMs, windowMs, perfectMs: pickBy(rules.dip.perfectMs, difficulty) }, endsByMs: dipAtMs + windowMs };
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

const within = (value: number, from: number, to: number) => value >= from && value <= to;

function judgeDip(params: DipParams, tap: Tap | undefined): AttemptOutcome {
  if (!tap || tap.at < params.dipAtMs - GRACE_MS) return 'miss';
  if (tap.at <= params.dipAtMs + params.perfectMs + GRACE_MS) return 'perfect';
  return tap.at <= params.dipAtMs + params.windowMs + GRACE_MS ? 'success' : 'miss';
}

function judgeSparkles(params: SparkleParams, taps: readonly Tap[]): AttemptOutcome {
  const hit = new Set<number>();
  for (const tap of taps) {
    const found = params.sparkles.findIndex((sparkle, at) => !hit.has(at) && sparkle.place === tap.place && within(tap.at, sparkle.atMs - GRACE_MS, sparkle.atMs + sparkle.showMs + GRACE_MS));
    if (found >= 0) hit.add(found);
  }
  if (hit.size === params.sparkles.length) return 'perfect';
  return hit.size >= params.need ? 'success' : 'miss';
}

function judgeMarker(params: MarkerParams, tap: Tap | undefined): AttemptOutcome {
  if (!tap || tap.at > params.timeoutMs + GRACE_MS) return 'miss';
  const position = markerAt(params.sweepMs, tap.at);
  // The marker moves this far in GRACE_MS, so its bands widen by that much.
  const grace = Math.ceil((GRACE_MS * MARKER_TRACK) / params.sweepMs);
  if (within(position, params.perfectFrom - grace, params.perfectTo + grace)) return 'perfect';
  return within(position, params.zoneFrom - grace, params.zoneTo + grace) ? 'success' : 'miss';
}

/**
 * How an attempt went, from the taps the browser reported and `elapsedMs`, the server's own time
 * since it sent `skill.attempt`. A finish before MIN_ATTEMPT_MS, taps out of order, or a tap later
 * than `elapsedMs` + CLOCK_SLACK_MS (it had not happened yet) is a miss. Dip and marker count the
 * first tap; sparkle counts each tap on a sparkle at its place while it shows.
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
