import { ARENA_KINDS, type ArenaFighter, type ArenaInput, type ArenaLoadout, type Button } from '../../src/index.ts';
import { arenaContent } from './arena-content.ts';

/** A fighter of `species` at level 10 with no moves, or as `overrides` say. */
export const fighter = (species: string, overrides: Partial<ArenaFighter> = {}): ArenaFighter => ({
  id: `${species}-fighter`,
  species,
  level: 10,
  loadout: [null, null, null],
  turtle: false,
  computer: false,
  ...overrides,
});

/** One move on its kind's button, the others empty. */
export function loadoutWith(...moves: readonly string[]): ArenaLoadout {
  const loadout: [string | null, string | null, string | null] = [null, null, null];
  for (const id of moves) {
    const kind = arenaContent.moves.get(id)?.arena?.kind;
    if (!kind) throw new RangeError(`no arena move "${id}"`);
    loadout[ARENA_KINDS.indexOf(kind)] = id;
  }
  return loadout;
}

/** An input: the stick, and optionally dash and a button. */
export const stick = (dir: number | null, press: Button | null = null, dash = false): ArenaInput => ({ dir, dash, press });

/** The live moves of each button's kind, sorted, for property tests. */
export const movesByButton: readonly (readonly string[])[] = ARENA_KINDS.map((kind) =>
  [...arenaContent.moves.values()].filter((move) => move.arena?.kind === kind).map((move) => move.id).toSorted(),
);
