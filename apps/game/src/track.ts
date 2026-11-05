import { directionBetween, samePoint, type Direction, type Point } from '@nebotok/core';

/**
 * One change to a player as the client heard it: a step from one tile to the next, or a turn or a
 * jump (`from` equals `to`), starting at `start` on the page's clock in milliseconds.
 */
export type Segment = { readonly from: Point; readonly to: Point; readonly facing: Direction; readonly start: number };

/** A player's recent segments, oldest first, each starting no earlier than the one before. */
export type Track = readonly Segment[];

export type TrackSample = {
  /** Where to draw the player, in tiles; between two tiles while stepping. */
  readonly x: number;
  readonly y: number;
  readonly facing: Direction;
  readonly walking: boolean;
};

const KEEP = 8;

const moves = (segment: Segment) => !samePoint(segment.from, segment.to);

export function startTrack(at: Point, facing: Direction): Track {
  return [{ from: at, to: at, facing, start: Number.NEGATIVE_INFINITY }];
}

/**
 * Adds what the server now says: a step to a neighbouring tile walks there over `stepMs`; anything
 * else turns or jumps on the spot. Updates arrive in network-sized lumps, so a step that follows
 * a step almost on time starts exactly when that one ends, which keeps the walk even; one that is
 * far off is pulled to within half a step of now.
 */
export function extendTrack(track: Track, to: Point, facing: Direction, now: number, stepMs: number): Track {
  const last = track.at(-1);
  if (!last) return startTrack(to, facing);
  if (samePoint(last.to, to) && last.facing === facing) return track;
  const step = directionBetween(last.to, to) !== null;
  let start = Math.max(now, last.start);
  if (step && moves(last)) start = Math.min(Math.max(last.start + stepMs, now - stepMs / 2), now + stepMs / 2);
  const segment: Segment = { from: step ? last.to : to, to, facing, start };
  return [...track.slice(-(KEEP - 1)), segment];
}

export function sampleTrack(track: Track, at: number, stepMs: number): TrackSample {
  const first = track[0];
  if (!first) throw new RangeError('sampleTrack() needs a track with at least one segment');
  const current = track.findLast((segment) => segment.start <= at);
  if (!current) return { x: first.from.x, y: first.from.y, facing: first.facing, walking: false };
  const progress = Math.min(1, Math.max(0, (at - current.start) / stepMs));
  return {
    x: current.from.x + (current.to.x - current.from.x) * progress,
    y: current.from.y + (current.to.y - current.from.y) * progress,
    facing: current.facing,
    walking: moves(current) && progress < 1,
  };
}
