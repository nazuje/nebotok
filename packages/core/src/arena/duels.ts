import type { Point } from '../grid.ts';
import { grownLoadout, repairLoadout, type LoadoutContent } from '../loadout.ts';
import type { CreatureInstance } from '../save.ts';
import { abs, div } from './fixed.ts';
import type { RoundPick, RoundsFightSetup } from './fight-state.ts';
import type { ArenaLoadout, Side } from './state.ts';

/**
 * Friendly duels between two players (docs/arena.md, "Rounds" and "Even match"): who may ask whom,
 * and the best of 3 an accepted ask starts.
 */

/** Each side fights with this many creatures, its first standing ones. */
export const DUEL_TEAM = 3;
/** Another courier can be asked from this many tiles away or nearer, along either axis. */
export const DUEL_REACH = 4;
/** An ask with no answer this long declines by itself. */
export const DUEL_ANSWER_MS = 20_000;
/** After a no, no answer or a take-back the same two players wait this long before either asks the other again. */
export const DUEL_PAUSE_MS = 30_000;
/** At most this many players watch one duel. */
export const DUEL_WATCHERS = 6;
/** Give up is held this long before it counts. */
export const DUEL_GIVE_UP_MS = 2_000;
/** The winner's courier wears a trophy in the world this long. */
export const DUEL_TROPHY_MS = 60_000;

type Owned = Pick<CreatureInstance, 'species' | 'level' | 'hp' | 'loadout'>;

/** The creatures a player duels with: the first `DUEL_TEAM` standing ones, with their team places. */
export function duelLineup<T extends Owned>(team: readonly T[]): { readonly place: number; readonly creature: T }[] {
  return team.flatMap((creature, place) => (creature.hp > 0 ? [{ place, creature }] : [])).slice(0, DUEL_TEAM);
}

/** Whether a team has the `DUEL_TEAM` standing creatures a duel needs. */
export const canDuel = (team: readonly Owned[]): boolean => duelLineup(team).length === DUEL_TEAM;

/** Whether two couriers are near enough for one to ask the other. */
export const inDuelReach = (from: Point, to: Point): boolean => Math.max(abs(from.x - to.x), abs(from.y - to.y)) <= DUEL_REACH;

/** A team's average level, rounded half up; 1 for an empty team. */
function averageLevel(team: readonly Pick<CreatureInstance, 'level'>[]): number {
  if (team.length === 0) return 1;
  const sum = team.reduce((total, creature) => total + creature.level, 0);
  return div(2 * sum + team.length, 2 * team.length);
}

/** The level every creature of an even match fights at: the higher of the two teams' average levels. */
export const evenLevel = (teams: readonly [readonly Pick<CreatureInstance, 'level'>[], readonly Pick<CreatureInstance, 'level'>[]]): number =>
  Math.max(averageLevel(teams[0]), averageLevel(teams[1]));

/** The creature's buttons at `level`: grown into the buttons that unlock on the way up, and without moves it would not know yet on the way down. */
function loadoutAt(creature: Owned, level: number, content: LoadoutContent): ArenaLoadout {
  const grown = level > creature.level ? grownLoadout(creature, level, content) : creature.loadout;
  return [...repairLoadout({ species: creature.species, level, loadout: grown }, content)] as ArenaLoadout;
}

export type DuelSetupOptions = {
  readonly seed: number | string;
  /** Side 0's team (the player who asked), then side 1's. */
  readonly teams: readonly [readonly CreatureInstance[], readonly CreatureInstance[]];
  /** Even match: every creature at `evenLevel`, for this duel only. */
  readonly even: boolean;
  /** Each player's turtle setting, for their own side. */
  readonly turtles: readonly [boolean, boolean];
  readonly content: LoadoutContent;
};

const FIGHTER_PREFIX: Readonly<Record<Side, string>> = { 0: 'a', 1: 'b' };

/**
 * Every standing creature of each side in team order, as it fights in this duel: with its loadout
 * and its player's turtle setting, at its real level or at `evenLevel`. Each player picks three
 * from their side's.
 */
export function duelTeams({ teams, even, turtles, content }: Omit<DuelSetupOptions, 'seed'>): readonly [RoundPick[], RoundPick[]] {
  const level = evenLevel(teams);
  const sideOf = (side: Side): RoundPick[] =>
    teams[side].flatMap((creature, place) => {
      if (creature.hp <= 0) return [];
      const at = even ? level : creature.level;
      return [{ place, fighter: { id: `${FIGHTER_PREFIX[side]}${place + 1}`, species: creature.species, level: at, loadout: loadoutAt(creature, at, content), turtle: turtles[side], computer: false } }];
    });
  return [sideOf(0), sideOf(1)];
}

/**
 * The best of 3 an accepted duel starts, before its players pick: each side's first three
 * standing creatures (`duelLineup`) from `duelTeams`. Nothing here changes a save.
 */
export function duelSetup({ seed, ...options }: DuelSetupOptions): RoundsFightSetup {
  const [first, second] = duelTeams(options);
  if (first.length === 0 || second.length === 0) throw new RangeError('a duel needs a standing creature on each side');
  return { mode: 'rounds', seed, picks: [first.slice(0, DUEL_TEAM), second.slice(0, DUEL_TEAM)] };
}
