import type { BattleContent } from './battle/content.ts';
import { maxHpAt } from './battle/damage.ts';
import { MAX_LEVEL } from './battle/state.ts';
import type { Species } from './content.ts';
import { movesAt, type Progress } from './creatures.ts';
import type { CreatureInstance } from './save.ts';

/** What `sanitizeProgress` changed, as content ids and a count only, so it can be logged. */
export type ProgressRepairs = {
  /** The species of each creature dropped because species.json no longer has it, team first. */
  readonly droppedCreatures: readonly string[];
  /** Items dropped because items.json no longer has them. */
  readonly droppedItems: readonly string[];
  /** Moves forgotten because moves.json no longer has them or the creature's species never learns them. */
  readonly replacedMoves: readonly string[];
  /** How many creatures had their level or health brought within bounds. */
  readonly clamped: number;
  /** Species dropped from `seen` and `befriended` because species.json no longer has them. */
  readonly forgottenSpecies: readonly string[];
  /** Every team creature was dropped, so a stored creature joined the team. */
  readonly refilledTeam: boolean;
};

export function isRepaired(repairs: ProgressRepairs): boolean {
  const { droppedCreatures, droppedItems, replacedMoves, clamped, forgottenSpecies, refilledTeam } = repairs;
  return droppedCreatures.length + droppedItems.length + replacedMoves.length + clamped + forgottenSpecies.length > 0 || refilledTeam;
}

/**
 * The moves a creature of `species` can know, that moves.json has: its first four and its whole
 * learnset. Any level counts, so a later change to the level a move is learned at never takes a
 * learned move away.
 */
export function knowableMoves(species: Species, content: BattleContent): ReadonlySet<string> {
  const learned = (species.learnset ?? []).map((entry) => entry.move);
  return new Set([...species.moves, ...learned].filter((id) => content.moves.has(id)));
}

type RepairedCreature = { readonly creature: CreatureInstance; readonly forgot: readonly string[]; readonly clamped: boolean };

/**
 * Keeps every move the creature can know and fills the slots of the rest from its species' moves
 * for its level, so it knows as many moves as before (at least one). Level and health are clamped.
 */
function repairCreature(owned: CreatureInstance, species: Species, content: BattleContent): RepairedCreature {
  const level = Math.min(Math.max(owned.level, 1), MAX_LEVEL);
  const hp = Math.min(Math.max(owned.hp, 0), maxHpAt(species, level));
  const allowed = knowableMoves(species, content);
  const forgot = owned.moves.filter((id) => !allowed.has(id));
  const clamped = level !== owned.level || hp !== owned.hp;
  if (forgot.length === 0 && !clamped) return { creature: owned, forgot, clamped };
  const moves = owned.moves.filter((id) => allowed.has(id));
  const wanted = Math.max(owned.moves.length, 1);
  for (const id of movesAt(species, level)) if (moves.length < wanted && !moves.includes(id) && content.moves.has(id)) moves.push(id);
  return { creature: { ...owned, level, hp, moves }, forgot, clamped };
}

/**
 * Progress, or a whole save's data, checked against today's content, for a save that was written
 * with older content. Apply it after `renameSpecies`. A creature whose species is gone is dropped;
 * a move that is gone or that its species never learns is replaced from the species'
 * moves for that level; level and health are clamped; items and `seen`/`befriended` species that are
 * gone are dropped. When every team creature is dropped and storage still has one, the first stored
 * creature that can battle (else the first) joins the team; with no creature left at all the player
 * chooses a starter again. Progress that matches the content comes back unchanged.
 */
export function sanitizeProgress<T extends Progress>(progress: T, content: BattleContent): { readonly progress: T; readonly repairs: ProgressRepairs } {
  const droppedCreatures: string[] = [];
  const replacedMoves: string[] = [];
  let clamped = 0;
  const repairAll = (creatures: readonly CreatureInstance[]): CreatureInstance[] =>
    creatures.flatMap((owned) => {
      const species = content.species.get(owned.species);
      if (!species) {
        droppedCreatures.push(owned.species);
        return [];
      }
      const repaired = repairCreature(owned, species, content);
      replacedMoves.push(...repaired.forgot);
      if (repaired.clamped) clamped += 1;
      return [repaired.creature];
    });
  let team = repairAll(progress.team);
  let storage = repairAll(progress.storage);
  const refilledTeam = team.length === 0 && storage.length > 0;
  if (refilledTeam) {
    const at = Math.max(storage.findIndex((creature) => creature.hp > 0), 0);
    team = storage.slice(at, at + 1);
    storage = storage.toSpliced(at, 1);
  }
  const knownSpecies = (ids: readonly string[]) => ids.filter((id) => content.species.has(id));
  const repairs: ProgressRepairs = {
    droppedCreatures,
    droppedItems: progress.inventory.filter((entry) => !content.items.has(entry.item)).map((entry) => entry.item),
    replacedMoves,
    clamped,
    forgottenSpecies: [...new Set([...progress.seen, ...progress.befriended].filter((id) => !content.species.has(id)))],
    refilledTeam,
  };
  if (!isRepaired(repairs)) return { progress, repairs };
  return {
    progress: {
      ...progress,
      team,
      storage,
      inventory: progress.inventory.filter((entry) => content.items.has(entry.item)),
      seen: knownSpecies(progress.seen),
      befriended: knownSpecies(progress.befriended),
    },
    repairs,
  };
}
