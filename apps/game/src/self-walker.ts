import { DIRECTIONS, IDLE, createWalker, planCommand, planWalk, samePoint, stepFrom, stepWalker, upcomingSteps, withIntent, type Direction, type Intent, type Point, type WalkCommand, type Walker, type WorldMap } from '@nebotok/core';

/** What the player asked their courier to do, in the shape of the three walk messages. */
export type Command = WalkCommand;

/** What the server's state says about your own courier. */
export type ServerSelf = { readonly x: number; readonly y: number; readonly facing: Direction; readonly moving: boolean };

/** A correction being smoothed out: the courier is drawn `offset` tiles off its walker, closing over GLIDE_MS from `since`. */
type Glide = { readonly offset: Point; readonly since: number };

/**
 * Your own courier as this page predicts it: the same walker the server runs, stepped by the same
 * core rules from the moment you act, so it moves at once instead of a round trip later.
 */
export type Prediction = {
  readonly walker: Walker;
  /** Frame time left over below a whole millisecond, since the rules step in whole milliseconds. */
  readonly carryMs: number;
  /** When the settled prediction and the settled server first disagreed, if they do. */
  readonly mismatchSince: number | null;
  /** The tiles it claimed before this one, oldest first: a server on one of them is only lagging behind. */
  readonly trail: readonly Point[];
  readonly glide: Glide | null;
};

/** While walking, further than this from the server, in tiles, and not on its trail, the prediction moves over to it. */
export const DRIFT_TILES = 2;
/** How many tiles of trail are kept. */
const TRAIL_TILES = 4;
/** A correction further than this, in tiles, jumps instead of gliding: a take-over or a long outage. */
export const SNAP_TILES = 4;
/** How long a correction takes to glide. */
export const GLIDE_MS = 150;
/** How long both must stand still apart before the prediction walks over to the server. */
export const SETTLE_MS = 250;
/** With less than this left of a step, a new command is planned from the tile after it: see commandFrom. */
export const LEAD_MS = 60;
/** A frame longer than this (a hidden tab, a debugger) is cut short rather than replayed. */
const LONGEST_FRAME_MS = 1_000;

const OPPOSITE: Readonly<Record<Direction, Direction>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function startPrediction(server: ServerSelf): Prediction {
  return { walker: createWalker(server, server.facing), carryMs: 0, mismatchSince: null, trail: [], glide: null };
}

/**
 * The tile a command is planned from, which the server is told: the one the courier has claimed or,
 * with its step nearly over, the next one its intent takes. The server hears the command a little
 * later and may have started that next step by then; planning past it keeps both on one route.
 */
function commandFrom(map: WorldMap, walker: Walker, stepMs: number): Point {
  const next = walker.moving && stepMs - walker.elapsedMs < LEAD_MS ? upcomingSteps(map, walker, 1)[0] : undefined;
  return next ?? { x: walker.x, y: walker.y };
}

/** Applies a command the way the server will, and says which tile it was planned from. Null when a walk target cannot be reached. */
export function applyCommand(prediction: Prediction, map: WorldMap, command: Command, stepMs: number): { prediction: Prediction; from: Point } | null {
  const from = commandFrom(map, prediction.walker, stepMs);
  const intent = planCommand(map, prediction.walker, command, from);
  if (intent === null) return null;
  return { prediction: { ...prediction, walker: withIntent(prediction.walker, intent), mismatchSince: null }, from };
}

export function canReach(prediction: Prediction, map: WorldMap, target: Point): boolean {
  return planWalk(map, prediction.walker, target) !== null;
}

export function advance(prediction: Prediction, map: WorldMap, dtMs: number, stepMs: number): Prediction {
  const total = prediction.carryMs + Math.min(Math.max(0, dtMs), LONGEST_FRAME_MS);
  const whole = Math.floor(total);
  const before = prediction.walker;
  const walker = stepWalker(map, before, whole, stepMs);
  const trail = samePoint(walker, before) ? prediction.trail : [...prediction.trail, { x: before.x, y: before.y }].slice(-TRAIL_TILES);
  return { ...prediction, walker, carryMs: total - whole, trail };
}

/** The same intent, carried on from the server's tile: a walk is planned again from there. */
function resumeAt(map: WorldMap, server: ServerSelf, intent: Intent): Walker {
  const walker = createWalker(server, server.facing);
  if (intent.kind !== 'path') return withIntent(walker, intent);
  const target = intent.steps.at(-1);
  return withIntent(walker, (target && planWalk(map, walker, target)) || IDLE);
}

/** Puts the prediction on another walker, gliding the drawn courier over unless the gap is a true jump. */
function moveTo(prediction: Prediction, walker: Walker, stepMs: number, now: number): Prediction {
  const before = drawnAt(prediction, stepMs, now);
  const next: Prediction = { ...prediction, walker, mismatchSince: null, trail: [], glide: null };
  const after = drawnAt(next, stepMs, now);
  const offset = { x: before.x - after.x, y: before.y - after.y };
  if (distance(offset, { x: 0, y: 0 }) > SNAP_TILES) return next;
  return { ...next, glide: { offset, since: now } };
}

const settled = (walker: Walker) => !walker.moving && walker.intent.kind === 'idle';

/**
 * Quietly lines the prediction up with the server. Far apart, and not just behind on the same
 * route, it moves over, gliding. When both have stood still apart for SETTLE_MS, it walks the last
 * tile over, or just turns to the server's facing. While either is still moving, the two are
 * expected to differ by the time a message takes.
 */
export function reconcile(prediction: Prediction, map: WorldMap, server: ServerSelf, stepMs: number, now: number): Prediction {
  const { walker } = prediction;
  const apart = distance(walker, server);
  const lagging = prediction.trail.some((tile) => samePoint(tile, server));
  if (apart > DRIFT_TILES && !lagging) return moveTo(prediction, resumeAt(map, server, walker.intent), stepMs, now);
  const differ = apart > 0 || walker.facing !== server.facing;
  if (!differ || !settled(walker) || server.moving) return prediction.mismatchSince === null ? prediction : { ...prediction, mismatchSince: null };
  if (prediction.mismatchSince === null) return { ...prediction, mismatchSince: now };
  if (now - prediction.mismatchSince < SETTLE_MS) return prediction;
  if (apart === 0) return { ...prediction, walker: { ...walker, facing: server.facing }, mismatchSince: null };
  const back = apart === 1 ? planWalk(map, walker, server) : null;
  return back ? { ...prediction, walker: withIntent(walker, back), mismatchSince: null } : moveTo(prediction, resumeAt(map, server, IDLE), stepMs, now);
}

/** Where to draw the predicted courier, in tiles: part way from the tile behind while stepping. */
export function drawnAt(prediction: Prediction, stepMs: number, now: number): Point {
  const { walker, glide } = prediction;
  let at: Point = { x: walker.x, y: walker.y };
  if (walker.moving) {
    const from = stepFrom(walker, OPPOSITE[walker.facing]);
    const progress = Math.min(1, walker.elapsedMs / stepMs);
    at = { x: from.x + (walker.x - from.x) * progress, y: from.y + (walker.y - from.y) * progress };
  }
  const left = glide ? 1 - (now - glide.since) / GLIDE_MS : 0;
  if (!glide || left <= 0) return at;
  return { x: at.x + glide.offset.x * left, y: at.y + glide.offset.y * left };
}

export const isDirection = (value: string): value is Direction => DIRECTIONS.some((direction) => direction === value);
