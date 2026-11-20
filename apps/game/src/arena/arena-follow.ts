import { TICKS_PER_SECOND } from '@nebotok/core';
import type { Point } from './arena-predict.ts';

/**
 * The other creature, drawn `OTHER_DELAY_MS` in the past between the room's snapshots (docs/protocol.md,
 * "Prediction"), the way the world draws other couriers `OTHERS_DELAY_MS` behind. Snapshots are
 * placed on the fight's own clock, its tick, so a late or bunched patch does not jerk the creature:
 * the page's clock is tied to the fight's by the earliest any tick arrived, drifting slowly
 * later when patches keep arriving later.
 */

export const OTHER_DELAY_MS = 100;
const TICK_MS = 1_000 / TICKS_PER_SECOND;
/** How quickly the tie between the clocks follows patches that arrive later than before. */
const DRIFT = 0.02;
const KEEP = 16;

type Snapshot = { readonly tick: number; readonly x: number; readonly y: number };

export type Follower = {
  /** The other creature as the state shows it at `tick`, in arena units. A new `id` is a new creature, drawn where it is. */
  heard(id: string, tick: number, at: Point, now: number): void;
  /** Where to draw it, or null before the first snapshot. */
  at(now: number): Point | null;
};

export function createFollower(delayMs = OTHER_DELAY_MS): Follower {
  let id: string | null = null;
  let snapshots: Snapshot[] = [];
  /** The page's time minus the fight's, in ms. */
  let offset = 0;
  return {
    heard: (heardId, tick, at, now) => {
      if (heardId !== id) {
        id = heardId;
        snapshots = [];
      }
      const last = snapshots.at(-1);
      if (last && tick <= last.tick) return;
      const seen = now - tick * TICK_MS;
      offset = !last || seen < offset ? seen : offset + (seen - offset) * DRIFT;
      snapshots = [...snapshots.slice(1 - KEEP), { tick, x: at.x, y: at.y }];
    },
    at: (now) => {
      const first = snapshots[0];
      if (!first) return null;
      const tick = (now - delayMs - offset) / TICK_MS;
      const after = snapshots.findIndex((snapshot) => snapshot.tick > tick);
      if (after === 0) return { x: first.x, y: first.y };
      const from = snapshots[after - 1] ?? snapshots.at(-1) ?? first;
      const to = after < 0 ? from : (snapshots[after] ?? from);
      const t = to.tick === from.tick ? 0 : (tick - from.tick) / (to.tick - from.tick);
      return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
    },
  };
}
