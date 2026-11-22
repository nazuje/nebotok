import { maxHpOf, type TeamCreature } from '@nebotok/core';
import { CONTENT } from './battle-content.ts';

/**
 * How hurt a creature looks, so it reads without words: its health bar green above half, amber
 * above a fifth and red at or below it, and, once the bar is no longer green, a picture pointing
 * to the shrine, where resting heals the team.
 */

export type HealthLevel = 'high' | 'mid' | 'low';

export function healthLevel(hp: number, maxHp: number): HealthLevel {
  const percent = maxHp > 0 ? Math.round((100 * Math.max(0, hp)) / maxHp) : 0;
  return percent > 50 ? 'high' : percent > 20 ? 'mid' : 'low';
}

/** Whether a creature is hurt enough for its card to point to the shrine. */
export const needsRest = (hp: number, maxHp: number): boolean => healthLevel(hp, maxHp) !== 'high';

/** Whether any creature of the team needs the shrine. */
export const teamNeedsRest = (team: readonly TeamCreature[]): boolean => team.some((creature) => needsRest(creature.hp, maxHpOf(creature, CONTENT)));

/**
 * Whether the fighter `id` came onto the island hurt: its health the first time it is asked about,
 * remembered in `entered`, needs the shrine. Only a wild fight starts a creature with its saved
 * health; a best of 3 starts every creature whole, so none of its fighters ever do.
 */
export function cameInHurt(entered: Map<string, boolean>, id: string, health: number, max: number): boolean {
  const known = entered.get(id);
  if (known !== undefined) return known;
  const hurt = needsRest(health, max);
  entered.set(id, hurt);
  return hurt;
}
