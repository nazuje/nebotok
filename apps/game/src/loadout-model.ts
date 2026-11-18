import { ARENA_KINDS, buttonUnlocked, type ArenaKind, type Loadout, type LoadoutContent, type TeamCreature } from '@nebotok/core';

/**
 * What the loadout picker offers, without the page: the three button tiles, the moves offered for
 * one button and what a tap does. The server checks every change again (core `loadoutFits`); these
 * only keep a wrong choice from being offered at all.
 */

type Creature = Pick<TeamCreature, 'level' | 'loadout' | 'learned'>;

/** How many power pips a move tile shows (docs/arena.md, "Loadout picker"): 1 for power 40 and 50, 2 for 65 and 80, 3 for 100, none for a call. */
export type Pips = 0 | 1 | 2 | 3;

export function powerPips(power: number): Pips {
  if (power <= 0) return 0;
  if (power < 65) return 1;
  return power < 100 ? 2 : 3;
}

/** One of a creature's three buttons: its kind, its move (null when empty or locked) and, while locked, the level it unlocks at. */
export type ButtonTile = { readonly button: number; readonly kind: ArenaKind; readonly move: string | null; readonly locked: boolean; readonly unlocksAt: number | null };

export function buttonTiles(creature: Creature, content: LoadoutContent): ButtonTile[] {
  return ARENA_KINDS.map((kind, button) => {
    const locked = !buttonUnlocked(button, creature.level, content);
    return { button, kind, move: locked ? null : (creature.loadout[button] ?? null), locked, unlocksAt: locked ? (content.arena?.buttons[button] ?? null) : null };
  });
}

/** The moves offered for `button`: the learned moves of its kind, in the order they were learned, and none while it is locked. */
export function offeredMoves(creature: Creature, button: number, content: LoadoutContent): string[] {
  if (!buttonUnlocked(button, creature.level, content)) return [];
  return creature.learned.filter((id) => content.moves.get(id)?.arena?.kind === ARENA_KINDS[button]);
}

/** The button shown after a tap on `button`: it, unless it is locked, when nothing changes. */
export function tappedButton(creature: Creature, shown: number, button: number, content: LoadoutContent): number {
  return buttonUnlocked(button, creature.level, content) ? button : shown;
}

/** The button a picker opened for `move` shows first: the button of its kind when that is unlocked, or else the first. */
export function buttonFor(creature: Creature, move: string | null, content: LoadoutContent): number {
  const kind = move === null ? undefined : content.moves.get(move)?.arena?.kind;
  const button = kind === undefined ? 0 : ARENA_KINDS.indexOf(kind);
  return button > 0 && buttonUnlocked(button, creature.level, content) ? button : 0;
}

/** The loadout to ask for after a tap on `move` for `button`, or null when it is not offered there or already on it. */
export function chosenLoadout(creature: Creature, button: number, move: string, content: LoadoutContent): Loadout | null {
  if (!offeredMoves(creature, button, content).includes(move) || creature.loadout[button] === move) return null;
  const [quick = null, special = null, ultimate = null] = creature.loadout.map((id, at) => (at === button ? move : id));
  return [quick, special, ultimate];
}
