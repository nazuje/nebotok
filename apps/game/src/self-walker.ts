import { DIRECTIONS, IDLE, createWalker, planWalk, stepFrom, stepWalker, withIntent, type Direction, type Intent, type Point, type Walker, type WorldMap } from '@nebotok/core';

/** What the player asked their courier to do, in the shape of the three walk messages. */
export type Command = { readonly kind: 'to'; readonly target: Point } | { readonly kind: 'hold'; readonly direction: Direction } | { readonly kind: 'stop' };

/** What the server's state says about your own courier. */
export type ServerSelf = { readonly x: number; readonly y: number; readonly facing: Direction; readonly moving: boolean };

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
};

/** Further than this from the server, in tiles, the prediction jumps to it instead of walking. */
export const SNAP_TILES = 2;
/** How long both must stand still apart before the prediction walks over to the server. */
export const SETTLE_MS = 250;
/** A frame longer than this (a hidden tab, a debugger) is cut short rather than replayed. */
const LONGEST_FRAME_MS = 1_000;

const OPPOSITE: Readonly<Record<Direction, Direction>> = { up: 'down', down: 'up', left: 'right', right: 'left' };

const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function startPrediction(server: ServerSelf): Prediction {
  return { walker: createWalker(server, server.facing), carryMs: 0, mismatchSince: null };
}

/** Applies a command the way the server will. Null when a walk target cannot be reached. */
export function applyCommand(prediction: Prediction, map: WorldMap, command: Command): Prediction | null {
  let intent: Intent | null = IDLE;
  if (command.kind === 'to') intent = planWalk(map, prediction.walker, command.target);
  else if (command.kind === 'hold') intent = { kind: 'hold', direction: command.direction };
  if (intent === null) return null;
  return { ...prediction, walker: withIntent(prediction.walker, intent), mismatchSince: null };
}

export function canReach(prediction: Prediction, map: WorldMap, target: Point): boolean {
  return planWalk(map, prediction.walker, target) !== null;
}

export function advance(prediction: Prediction, map: WorldMap, dtMs: number, stepMs: number): Prediction {
  const total = prediction.carryMs + Math.min(Math.max(0, dtMs), LONGEST_FRAME_MS);
  const whole = Math.floor(total);
  return { ...prediction, walker: stepWalker(map, prediction.walker, whole, stepMs), carryMs: total - whole };
}

/** The same intent, carried on from the server's tile: a walk is planned again from there. */
function resumeAt(map: WorldMap, server: ServerSelf, intent: Intent): Walker {
  const walker = createWalker(server, server.facing);
  if (intent.kind !== 'path') return withIntent(walker, intent);
  const target = intent.steps.at(-1);
  return withIntent(walker, (target && planWalk(map, walker, target)) || IDLE);
}

const settled = (walker: Walker) => !walker.moving && walker.intent.kind === 'idle';

/**
 * Quietly lines the prediction up with the server. Far apart, it jumps. When both have stood
 * still apart for SETTLE_MS, it walks the last tile over, or just turns to the server's facing.
 * While either is still moving, the two are expected to differ by the time a message takes.
 */
export function reconcile(prediction: Prediction, map: WorldMap, server: ServerSelf, now: number): Prediction {
  const { walker } = prediction;
  const apart = distance(walker, server);
  if (apart > SNAP_TILES) return { ...prediction, walker: resumeAt(map, server, walker.intent), mismatchSince: null };
  const differ = apart > 0 || walker.facing !== server.facing;
  if (!differ || !settled(walker) || server.moving) return prediction.mismatchSince === null ? prediction : { ...prediction, mismatchSince: null };
  if (prediction.mismatchSince === null) return { ...prediction, mismatchSince: now };
  if (now - prediction.mismatchSince < SETTLE_MS) return prediction;
  if (apart === 0) return { ...prediction, walker: { ...walker, facing: server.facing }, mismatchSince: null };
  const back = apart === 1 ? planWalk(map, walker, server) : null;
  return { ...prediction, walker: back ? withIntent(walker, back) : resumeAt(map, server, IDLE), mismatchSince: null };
}

/** Where to draw the predicted courier, in tiles: part way from the tile behind while stepping. */
export function drawnAt(prediction: Prediction, stepMs: number): Point {
  const { walker } = prediction;
  if (!walker.moving) return { x: walker.x, y: walker.y };
  const from = stepFrom(walker, OPPOSITE[walker.facing]);
  const progress = Math.min(1, walker.elapsedMs / stepMs);
  return { x: from.x + (walker.x - from.x) * progress, y: from.y + (walker.y - from.y) * progress };
}

export const isDirection = (value: string): value is Direction => DIRECTIONS.some((direction) => direction === value);
