import { ARENA_KINDS } from './arena-shapes.ts';
import type { BattleContent } from './battle/content.ts';
import { learnedMoves } from './learning.ts';
import type { CreatureInstance, Loadout } from './save.ts';

/** What loadouts read: the moves' kinds, the species' learnsets and the levels arena.json unlocks buttons at. */
export type LoadoutContent = Pick<BattleContent, 'moves' | 'species' | 'arena'>;

type Owned = Pick<CreatureInstance, 'species' | 'level'>;
type Equipped = Owned & Pick<CreatureInstance, 'loadout'>;

/** The ability buttons, 0 to 2, each the button of one kind of move (`ARENA_KINDS`). */
function perButton(choose: (button: number) => string | null): Loadout {
  return [choose(0), choose(1), choose(2)];
}

/** Whether `button` (0 to 2) is unlocked at `level`. Without arena rules, as in the frozen turn-battle content, none is. */
export function buttonUnlocked(button: number, level: number, content: LoadoutContent): boolean {
  const unlocksAt = content.arena?.buttons[button];
  return unlocksAt !== undefined && level >= unlocksAt;
}

/** The moves a creature has learned (`learnedMoves`), or none when its species is gone. */
export function learnedBy(creature: Owned, content: LoadoutContent): string[] {
  const species = content.species.get(creature.species);
  return species ? learnedMoves(species, creature.level, content) : [];
}

const ofButtonKind = (id: string, button: number, content: LoadoutContent): boolean => content.moves.get(id)?.arena?.kind === ARENA_KINDS[button];

/** The default move for `button` (docs/arena.md): none while it is locked, else the first learned move of its kind. */
function defaultMove(level: number, button: number, learned: readonly string[], content: LoadoutContent): string | null {
  if (!buttonUnlocked(button, level, content)) return null;
  return learned.find((id) => ofButtonKind(id, button, content)) ?? null;
}

/** The loadout a creature starts with, on migrating to save v7 or when it is new: `defaultMove` on each button. */
export function defaultLoadout(creature: Owned, content: LoadoutContent): Loadout {
  const learned = learnedBy(creature, content);
  return perButton((button) => defaultMove(creature.level, button, learned, content));
}

function suits(id: string | null, button: number, level: number, learned: readonly string[], content: LoadoutContent): boolean {
  return id === null || (buttonUnlocked(button, level, content) && learned.includes(id) && ofButtonKind(id, button, content));
}

/** Whether each move of `loadout` suits the creature: learned, of its button's kind and on an unlocked button. An empty button always suits. */
export function loadoutFits(creature: Owned, loadout: Loadout, content: LoadoutContent): boolean {
  const learned = learnedBy(creature, content);
  return loadout.every((id, button) => suits(id, button, creature.level, learned, content));
}

/** The creature's loadout with every move that does not suit it (`loadoutFits`) replaced by the default. The same array when all suit. */
export function repairLoadout(creature: Equipped, content: LoadoutContent): Loadout {
  const learned = learnedBy(creature, content);
  const { loadout, level } = creature;
  if (loadout.every((id, button) => suits(id, button, level, learned, content))) return loadout;
  return perButton((button) => {
    const id = loadout[button] ?? null;
    return suits(id, button, level, learned, content) ? id : defaultMove(level, button, learned, content);
  });
}

/**
 * The creature's loadout once it has grown to `level`: a button that unlocks on the way gets the
 * default move, and an unlocked empty button gets the first move of its kind learned on the way. A
 * button with a move keeps it.
 */
export function grownLoadout(creature: Equipped, level: number, content: LoadoutContent): Loadout {
  const species = content.species.get(creature.species);
  if (!species || level <= creature.level) return creature.loadout;
  const before = learnedMoves(species, creature.level, content);
  const after = learnedMoves(species, level, content);
  const fresh = after.filter((id) => !before.includes(id));
  return perButton((button) => {
    const kept = creature.loadout[button] ?? null;
    if (kept !== null || !buttonUnlocked(button, level, content)) return kept;
    if (!buttonUnlocked(button, creature.level, content)) return defaultMove(level, button, after, content);
    return fresh.find((id) => ofButtonKind(id, button, content)) ?? null;
  });
}
