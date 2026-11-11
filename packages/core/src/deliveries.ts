/**
 * Delivery jobs as dialogue and the marks over characters see them: whether a delivery to a
 * character is on the player's board, and whether they carry all of it.
 */
import { itemCount, type Progress } from './creatures.ts';
import type { BoardJob } from './save.ts';

/** The first delivery job to `npc` on the board that the player carries all of (`ready`), or does not. */
export function deliveryTo(progress: Progress, npc: string, ready: boolean): BoardJob | null {
  return progress.jobs?.board.find((job) => job.to === npc && itemCount(progress, job.item) >= job.count === ready) ?? null;
}

/** Whether a delivery job to `npc` is on the board and the player carries all of it (dialogue's `jobReady`). */
export function jobReady(progress: Progress, npc: string): boolean {
  return deliveryTo(progress, npc, true) !== null;
}

/** Whether a delivery job to `npc` is on the board that the player does not carry all of yet (dialogue's `jobWaiting`). */
export function jobWaiting(progress: Progress, npc: string): boolean {
  return deliveryTo(progress, npc, false) !== null;
}
