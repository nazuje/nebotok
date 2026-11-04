import { z } from 'zod';

/** The four ways a walker can face and step. The order is fixed: path ties are broken in it. */
export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];
export const DirectionSchema = z.enum(DIRECTIONS);

export type Point = { readonly x: number; readonly y: number };

const OFFSETS: Readonly<Record<Direction, Point>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function stepFrom(from: Point, direction: Direction): Point {
  const offset = OFFSETS[direction];
  return { x: from.x + offset.x, y: from.y + offset.y };
}

/** The direction from one tile to a neighbouring tile, or null when they are not neighbours. */
export function directionBetween(from: Point, to: Point): Direction | null {
  return DIRECTIONS.find((direction) => {
    const next = stepFrom(from, direction);
    return next.x === to.x && next.y === to.y;
  }) ?? null;
}

export function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}
