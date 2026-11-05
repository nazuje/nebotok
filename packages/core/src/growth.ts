import type { BattleContent } from './battle/content.ts';
import { MAX_LEVEL, PLAYER_SIDE, WILD_SIDE, activeCreature, type BattleEvent, type BattleState } from './battle/state.ts';
import { maxHpOf } from './creatures.ts';
import type { CreatureReward } from './messages.ts';
import type { CreatureInstance } from './save.ts';

/** Experience each team creature that was sent out and is still standing gets for beating or befriending a wild creature. */
export function xpForWin(wildLevel: number): number {
  return 10 + 4 * wildLevel;
}

/** Experience a creature at `level` needs to reach the next level. */
export function xpToNextLevel(level: number): number {
  return 20 + 10 * level;
}

/**
 * Adds experience, levelling up as many times as it reaches. A level up raises full health and
 * keeps the damage already taken. At MAX_LEVEL experience stays at 0.
 */
export function gainXp(creature: CreatureInstance, xp: number, content: BattleContent): CreatureInstance {
  if (!Number.isInteger(xp) || xp < 0) throw new RangeError(`gainXp() needs a whole, non-negative xp, got ${xp}`);
  let { level } = creature;
  let total = creature.xp + xp;
  while (level < MAX_LEVEL && total >= xpToNextLevel(level)) {
    total -= xpToNextLevel(level);
    level += 1;
  }
  if (level === MAX_LEVEL) total = 0;
  const hp = creature.hp === 0 ? 0 : creature.hp + maxHpOf({ species: creature.species, level }, content) - maxHpOf(creature, content);
  return { ...creature, level, xp: total, hp };
}

/** The team places of the creatures side 0 sent out during a battle, from its events (start events included), in order. */
export function sentOut(events: readonly BattleEvent[]): number[] {
  const places = events.flatMap((event) => (event.kind === 'switched' && event.side === PLAYER_SIDE ? [Number(event.to.slice(1)) - 1] : []));
  return [...new Set(places)].toSorted((a, b) => a - b);
}

/**
 * Experience after a wild battle the player won or befriended in: every creature in `places`
 * (see `sentOut`) that is still standing gets `xpForWin` of the wild creature's level. `team` is
 * the team after the battle (`teamAfterBattle`). Any other outcome gives nothing.
 */
export function awardXp(team: readonly CreatureInstance[], state: BattleState, places: readonly number[], content: BattleContent): { readonly team: CreatureInstance[]; readonly rewards: CreatureReward[] } {
  const won = state.outcome?.winner === PLAYER_SIDE && (state.outcome.reason === 'fainted' || state.outcome.reason === 'befriended');
  const xp = won ? xpForWin(activeCreature(state, WILD_SIDE).level) : 0;
  const rewards: CreatureReward[] = [];
  const next = team.map((creature, index) => {
    if (xp === 0 || !places.includes(index) || creature.hp === 0) return creature;
    const grown = gainXp(creature, xp, content);
    rewards.push({ index, xp, level: grown.level });
    return grown;
  });
  return { team: next, rewards };
}
