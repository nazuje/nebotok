import type { BattleContent } from '../battle/content.ts';
import { newCreature } from '../creatures.ts';
import type { WildEncounter } from '../encounter.ts';
import { gainXp, xpForWin } from '../growth.ts';
import type { CreatureReward } from '../messages.ts';
import type { CreatureInstance, SaveData } from '../save.ts';
import { div, percentOf } from './fixed.ts';
import type { ArenaFight, FightCreature, RoundPick, RoundsFight, WildFight, WildFightSetup, WildResult } from './fight-state.ts';
import type { ArenaContent } from './rules.ts';
import { otherSide, type ArenaFighter, type ArenaLoadout, type Side } from './state.ts';

/**
 * What a fight gives back to the team: health, experience, a new friend and the treats left. The
 * arena twins of `wildBattleSetup`, `teamAfterBattle`, `befriendedCreature` (creatures.ts) and
 * `awardXp` (growth.ts), which stay for turn battles until the switch-over.
 */

type Inventory = SaveData['inventory'];

/** The wild results that give experience: every one where the wild creature did not win and you did not run. */
const XP_RESULTS: ReadonlySet<WildResult> = new Set(['won', 'wonByRingOut', 'befriended', 'timeUp']);
/** A friendly duel gives this share of a win's experience to every creature that fought. */
export const DUEL_XP_PERCENT = 25;

export type WildSetupOptions = {
  readonly seed: number | string;
  readonly team: readonly CreatureInstance[];
  readonly wild: WildEncounter;
  /** The wild creature's buttons, as `wildLoadout` gives them. */
  readonly wildLoadout: ArenaLoadout;
  /** The player's turtle setting. */
  readonly turtle: boolean;
  readonly inventory: Inventory;
  readonly content: Pick<BattleContent, 'items'>;
  /** The encounter zone's weather, or null for clear skies. */
  readonly weather?: string | null;
};

/** A team creature as a fighter on the island: `a<place + 1>`, with its loadout and the player's turtle setting. */
const teamFighter = (creature: CreatureInstance, place: number, turtle: boolean): ArenaFighter => ({
  id: `a${place + 1}`,
  species: creature.species,
  level: creature.level,
  loadout: [...creature.loadout] as ArenaLoadout,
  turtle,
  computer: false,
});

/**
 * The wild fight an encounter starts: every team creature that can fight, in team order, each
 * with its loadout and the player's turtle setting; the wild creature as the computer's; the
 * treats in the bag; and the zone's weather.
 */
export function arenaWildSetup({ seed, team, wild, wildLoadout, turtle, inventory, content, weather = null }: WildSetupOptions): WildFightSetup {
  const standing = team.flatMap((creature, place) => (creature.hp > 0 ? [{ place, hp: creature.hp, fighter: teamFighter(creature, place, turtle) }] : []));
  const treats = inventory.filter(({ item, count }) => count > 0 && content.items.get(item)?.kind === 'treat').map(({ item, count }) => ({ item, count }));
  const fighter = { id: 'b1', species: wild.species, level: wild.level, loadout: wildLoadout, turtle: false, computer: true };
  return { mode: 'wild', seed, team: standing, wild: fighter, treats, ...(weather === null ? {} : { weather }) };
}

/** The creatures a player can pick for a best of 3: every team creature that can fight, in team order, as fighters. */
export function roundsTeam(team: readonly CreatureInstance[], turtle: boolean): RoundPick[] {
  return team.flatMap((creature, place) => (creature.hp > 0 ? [{ place, fighter: teamFighter(creature, place, turtle) }] : []));
}

/** Real health from arena health, rounded up, so a creature with any health left keeps at least 1. */
const realHealth = (creature: FightCreature, content: ArenaContent): number => {
  const scale = content.arena.island.hpScale;
  return div(creature.health + scale - 1, scale);
};

/**
 * The team after a wild fight: each creature that fought keeps `ceil(arena health ÷ hpScale)`, 0
 * only when it was knocked out; a rung-out one keeps what it had. Creatures that stayed off the
 * island are as they were. A best of 3 changes no health: duels put it back, and every round
 * starts at full health.
 */
export function teamAfterFight(team: readonly CreatureInstance[], fight: ArenaFight, content: ArenaContent): CreatureInstance[] {
  if (fight.mode !== 'wild') return [...team];
  return team.map((creature, place) => {
    const fought = fight.team.find((entry) => entry.place === place && entry.fought);
    return fought ? { ...creature, hp: realHealth(fought, content) } : creature;
  });
}

/** The wild creature of a fight that ended `befriended`, as a new team creature at full health; else null. */
export function befriendedFromFight(fight: ArenaFight, content: BattleContent): CreatureInstance | null {
  if (fight.mode !== 'wild' || fight.outcome?.result !== 'befriended') return null;
  const wild = fight.island.bodies[1];
  return newCreature(wild.species, wild.level, content);
}

type Rewarded = { readonly team: CreatureInstance[]; readonly rewards: CreatureReward[] };

/** Gives `xpOf(place)` experience to each team place it names, in team order. */
function rewarded(team: readonly CreatureInstance[], xpOf: (place: number, creature: CreatureInstance) => number, content: BattleContent): Rewarded {
  const rewards: CreatureReward[] = [];
  const next = team.map((creature, index) => {
    const xp = xpOf(index, creature);
    if (xp <= 0) return creature;
    const grown = gainXp(creature, xp, content);
    rewards.push({ index, xp, level: grown.level });
    return grown;
  });
  return { team: next, rewards };
}

const foughtPlaces = (creatures: readonly FightCreature[]): ReadonlySet<number> => new Set(creatures.flatMap((creature) => (creature.fought && creature.place !== null ? [creature.place] : [])));

/**
 * Experience after a wild fight: `xpForWin` of the wild creature's level to every team creature
 * that fought and still stands in `team` (the team after `teamAfterFight`), when the fight was
 * won, won by a ring-out, befriended or ran out of time. Lost and ran give nothing.
 */
export function arenaRewards(team: readonly CreatureInstance[], fight: WildFight, content: BattleContent): Rewarded {
  const result = fight.outcome?.result;
  const xp = result !== undefined && XP_RESULTS.has(result) ? xpForWin(fight.island.bodies[1].level) : 0;
  const fought = foughtPlaces(fight.team);
  return rewarded(team, (place, creature) => (fought.has(place) && creature.hp > 0 ? xp : 0), content);
}

/**
 * Experience after a friendly duel, win or lose: each of `side`'s creatures that fought gets
 * `DUEL_XP_PERCENT` of `xpForWin` of the level of the creature it faced. Nothing is lost.
 */
export function duelRewards(team: readonly CreatureInstance[], fight: RoundsFight, side: Side, content: BattleContent): Rewarded {
  return roundsRewards(team, fight, side, DUEL_XP_PERCENT, content);
}

/**
 * Experience after a trainer's best of 3, win or lose: each of `side`'s creatures that fought gets
 * the trainer's `xpPercent` of `xpForWin` of the level of the creature it faced.
 */
export function trainerRewards(team: readonly CreatureInstance[], fight: RoundsFight, side: Side, xpPercent: number, content: BattleContent): Rewarded {
  return roundsRewards(team, fight, side, xpPercent, content);
}

/** `percent` of `xpForWin` of the level of the creature each of `side`'s creatures that fought faced. */
function roundsRewards(team: readonly CreatureInstance[], fight: RoundsFight, side: Side, percent: number, content: BattleContent): Rewarded {
  const mine = fight.picks[side];
  const theirs = fight.picks[otherSide(side)];
  const xpByPlace = new Map<number, number>();
  mine.forEach((creature, round) => {
    const faced = theirs[round];
    if (!creature.fought || creature.place === null || !faced) return;
    xpByPlace.set(creature.place, percentOf(xpForWin(faced.fighter.level), percent));
  });
  return rewarded(team, (place) => xpByPlace.get(place) ?? 0, content);
}

/** The bag after a wild fight: each treat's count as the fight left it; a treat all thrown away is gone. */
export function inventoryAfterFight(inventory: Inventory, fight: ArenaFight): Inventory {
  if (fight.mode !== 'wild') return [...inventory];
  const left = new Map(fight.treats.map(({ item, count }) => [item, count]));
  return inventory.flatMap((entry) => {
    const count = left.get(entry.item);
    if (count === undefined) return [entry];
    return count > 0 ? [{ ...entry, count }] : [];
  });
}
