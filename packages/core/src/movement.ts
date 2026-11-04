import { z } from 'zod';
import { DirectionSchema, directionBetween, stepFrom, type Direction, type Point } from './grid.ts';
import { isWalkable, type WorldMap } from './map.ts';
import { findPath, PATH_SEARCH_LIMIT } from './path.ts';

/** What a walker is trying to do. A new intent replaces the old one. */
export type Intent =
  | { readonly kind: 'idle' }
  | { readonly kind: 'hold'; readonly direction: Direction }
  | { readonly kind: 'path'; readonly steps: readonly Point[] };

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
    return { ...walker, ...next, facing: direction, moving: true, elapsedMs: 0, intent: rest.length > 0 ? { kind: 'path', steps: rest } : IDLE };
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
