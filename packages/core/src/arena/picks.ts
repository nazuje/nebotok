import { ROUNDS } from './rounds.ts';

/**
 * Picking three for a best of 3 (docs/arena.md, "Fight modes"): each side picks the standing
 * creatures it fights with, by team place, in round order. A side with fewer than three standing
 * picks them all. `standing` is always the standing creatures' team places in team order. The pick
 * screen and the arena room, which checks what it is sent, share these.
 */

/** How many creatures a side picks: three, or every standing one when fewer stand. */
export const pickCount = (standing: readonly number[]): number => Math.min(ROUNDS, standing.length);

/** The picks a side gets without choosing: its first three standing creatures, in team order. */
export const defaultPickOrder = (standing: readonly number[]): number[] => standing.slice(0, ROUNDS);

/**
 * The order after a tap on the creature at `place`: a picked one is taken out and the ones after
 * it move up a slot; another standing one goes into the first empty slot, while there is one.
 */
export function togglePick(order: readonly number[], place: number, standing: readonly number[]): number[] {
  if (order.includes(place)) return order.filter((each) => each !== place);
  if (!standing.includes(place) || order.length >= pickCount(standing)) return [...order];
  return [...order, place];
}

/** Whether `order` is a whole pick: `pickCount` different team places, each standing. */
export function isPickOrder(order: readonly number[], standing: readonly number[]): boolean {
  return order.length === pickCount(standing) && new Set(order).size === order.length && order.every((place) => standing.includes(place));
}
