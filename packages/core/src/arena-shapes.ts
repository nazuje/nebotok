/**
 * What a move does in an arena fight (docs/arena.md): its kind, the button it sits on, and its
 * shape, what it does on the island. Each move's `arena` block in `content/creatures/moves.json`
 * names one of each.
 */

/** Which button a move sits on: quick (button 1), special (2) or ultimate (3). */
export const ARENA_KINDS = ['quick', 'special', 'ultimate'] as const;
export type ArenaKind = (typeof ARENA_KINDS)[number];

/** What a move does on the island. */
export const ARENA_SHAPES = ['bolt', 'spray', 'cone', 'snare', 'lunge', 'burst', 'puddle', 'shield', 'strike', 'wall', 'freeze', 'zone', 'weather'] as const;
export type ArenaShape = (typeof ARENA_SHAPES)[number];
