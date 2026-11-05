import { z } from 'zod';
import { DirectionSchema, directionBetween, samePoint, stepFrom, type Direction, type Point } from './grid.ts';
import { isWalkable, type WorldMap } from './map.ts';
import { findPath, PATH_SEARCH_LIMIT } from './path.ts';

/** What a walker is trying to do. A new intent replaces the old one. A path with `thenHold` keeps walking that way after its last step. */
export type Intent =
  | { readonly kind: 'idle' }
  | { readonly kind: 'hold'; readonly direction: Direction }
  | { readonly kind: 'path'; readonly steps: readonly Point[]; readonly thenHold?: Direction };

export const IDLE: Intent = { kind: 'idle' };

/**
 * One character moving tile by tile. `x` and `y` are the tile it occupies: while `moving`, it has
 * already claimed that tile and is `elapsedMs` into the step that carries it there from the
 * tile behind it (opposite `facing`). Players never block each other, so walkers ignore one another.
 */
export type Walker = {
  readonly x: number;
  readonly y: number;
  readonly facing: Direction;
  readonly moving: boolean;
  readonly elapsedMs: number;
  readonly intent: Intent;
};

const Tile = z.number().int().min(0).max(1_023);
export const WalkerPosition = z.strictObject({ x: Tile, y: Tile, facing: DirectionSchema });
export type WalkerPosition = z.infer<typeof WalkerPosition>;

export function createWalker(at: Point, facing: Direction = 'down'): Walker {
  return { x: at.x, y: at.y, facing, moving: false, elapsedMs: 0, intent: IDLE };
}

/** How long one tile takes at a speed in tiles per second, in whole milliseconds. */
export function stepDurationMs(tilesPerSecond: number): number {
  if (!Number.isInteger(tilesPerSecond) || tilesPerSecond < 1 || tilesPerSecond > 60) {
    throw new RangeError(`walk speed must be a whole number of tiles per second from 1 to 60, got ${tilesPerSecond}`);
  }
  return Math.round(1_000 / tilesPerSecond);
}

export function withIntent(walker: Walker, intent: Intent): Walker {
  return { ...walker, intent };
}

/**
 * The intent that walks to `target` from the tile the walker has claimed, or null when the
 * target cannot be reached. Planning from the claimed tile means a step in progress always finishes.
 */
export function planWalk(map: WorldMap, walker: Walker, target: Point, limit: number = PATH_SEARCH_LIMIT): Intent | null {
  const steps = findPath(map, walker, target, limit);
  if (steps === null) return null;
  return steps.length === 0 ? IDLE : { kind: 'path', steps };
}

function pathThen(steps: readonly Point[], thenHold?: Direction): Intent {
  if (steps.length === 0) return thenHold ? { kind: 'hold', direction: thenHold } : IDLE;
  return thenHold ? { kind: 'path', steps, thenHold } : { kind: 'path', steps };
}

/** What a player can ask their character to do, in the shape of the three walk messages. */
export type WalkCommand = { readonly kind: 'to'; readonly target: Point } | { readonly kind: 'hold'; readonly direction: Direction } | { readonly kind: 'stop' };

/**
 * How many more steps of its current intent a walker may take to reach the tile a command was
 * planned from. A predicting client is ahead of the server by about the time a message takes, and
 * the server's fixed tick moves that by up to a tick either way, so the two can be a step or two apart.
 */
export const CATCH_UP_STEPS = 2;

/** The next tiles, at most `count`, that the walker's intent will step onto, in order. */
export function upcomingSteps(map: WorldMap, walker: Walker, count: number): Point[] {
  const tiles: Point[] = [];
  const { intent } = walker;
  if (intent.kind === 'path') tiles.push(...intent.steps.slice(0, count));
  const direction = intent.kind === 'hold' ? intent.direction : intent.kind === 'path' ? intent.thenHold : undefined;
  if (direction === undefined || (intent.kind === 'path' && intent.steps.length > count)) return tiles;
  let here: Point = tiles.at(-1) ?? walker;
  while (tiles.length < count) {
    const next = stepFrom(here, direction);
    if (!isWalkable(map, next)) break;
    tiles.push(next);
    here = next;
  }
  return tiles;
}

/** The steps that carry the walker on along its own intent to `from`: none when it is there, null when `from` is not that close ahead. */
function leadTo(map: WorldMap, walker: Walker, from: Point): Point[] | null {
  if (samePoint(walker, from)) return [];
  const next = upcomingSteps(map, walker, CATCH_UP_STEPS);
  const at = next.findIndex((tile) => samePoint(tile, from));
  return at === -1 ? null : next.slice(0, at + 1);
}

const apart = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The walk to `target` for a command planned from `from`; see planCommand. */
function walkFrom(map: WorldMap, walker: Walker, target: Point, from: Point, limit: number): Intent | null {
  const lead = leadTo(map, walker, from);
  if (lead) {
    const route = findPath(map, from, target, limit);
    return route && pathThen([...lead, ...route]);
  }
  // Already past `from`: join the route where the walker stands on it.
  if (apart(walker, from) <= CATCH_UP_STEPS) {
    const route = findPath(map, from, target, limit) ?? [];
    const at = route.findIndex((tile) => samePoint(tile, walker));
    if (at !== -1) return pathThen(route.slice(at + 1));
  }
  return planWalk(map, walker, target, limit);
}

/**
 * The intent for a walk command that a client planned from the tile `from`, or null when a walk
 * target cannot be reached. A predicting client acts on a command at once and the server a message
 * later, from a tile a step or so behind or ahead on the same route. On open ground many routes are
 * equally short, so each planning from its own tile would often walk a different one. Instead, when
 * `from` lies just ahead on the walker's own intent, the walker carries on to it and then does what
 * the command asks from there; when it has already passed `from` on the planned route, it joins
 * that route. Otherwise, or without `from`, the command starts from the walker's own tile. Every
 * step is the walker's own intent or a path the map allows, so `from` can never move it further.
 */
export function planCommand(map: WorldMap, walker: Walker, command: WalkCommand, from?: Point, limit: number = PATH_SEARCH_LIMIT): Intent | null {
  if (command.kind === 'to') return from ? walkFrom(map, walker, command.target, from, limit) : planWalk(map, walker, command.target, limit);
  const lead = from ? leadTo(map, walker, from) : null;
  return pathThen(lead ?? [], command.kind === 'hold' ? command.direction : undefined);
}

/** Starts the next step the intent asks for, or settles the walker when there is none. */
function startStep(map: WorldMap, walker: Walker): Walker {
  const { intent } = walker;
  if (intent.kind === 'hold') {
    const next = stepFrom(walker, intent.direction);
    if (!isWalkable(map, next)) return { ...walker, facing: intent.direction, moving: false, elapsedMs: 0 };
    return { ...walker, ...next, facing: intent.direction, moving: true, elapsedMs: 0 };
  }
  if (intent.kind === 'path') {
    const [next, ...rest] = intent.steps;
    const direction = next ? directionBetween(walker, next) : null;
    if (!next || !direction || !isWalkable(map, next)) return { ...walker, moving: false, elapsedMs: 0, intent: IDLE };
    return { ...walker, ...next, facing: direction, moving: true, elapsedMs: 0, intent: pathThen(rest, intent.thenHold) };
  }
  return { ...walker, moving: false, elapsedMs: 0 };
}

/**
 * Advances one walker by `dtMs` milliseconds. Pure and deterministic: the same walker, map, time
 * step and step length give the same walker back on every machine. It never moves onto a tile the
 * map blocks.
 */
export function stepWalker(map: WorldMap, walker: Walker, dtMs: number, stepMs: number): Walker {
  if (!Number.isInteger(dtMs) || dtMs < 0) throw new RangeError(`stepWalker() needs a whole, non-negative dtMs, got ${dtMs}`);
  if (!Number.isInteger(stepMs) || stepMs < 1) throw new RangeError(`stepWalker() needs a whole, positive stepMs, got ${stepMs}`);
  const current: { -readonly [Key in keyof Walker]: Walker[Key] } = { ...walker };
  let budget = dtMs;
  for (;;) {
    if (current.moving) {
      const left = stepMs - current.elapsedMs;
      if (budget < left) {
        current.elapsedMs += budget;
        return current;
      }
      budget -= left;
      current.moving = false;
      current.elapsedMs = 0;
    }
    Object.assign(current, startStep(map, current));
    if (!current.moving) return current;
  }
}

/** The tile, facing and motion others see. */
export function positionOf(walker: Walker): WalkerPosition {
  return { x: walker.x, y: walker.y, facing: walker.facing };
}
