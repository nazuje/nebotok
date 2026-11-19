import type { ArenaKind, ArenaShape } from '@nebotok/core';
import { CONTENT } from './battle-content.ts';

/** A move's kind and shape in an arena fight (docs/arena.md, "Every move's kind and shape"), from its `arena` block in moves.json. */
export type MoveArena = { readonly kind: ArenaKind; readonly shape: ArenaShape };

/** A move's kind and shape, or null for a move the arena does not know. */
export function moveArena(moveId: string): MoveArena | null {
  const arena = CONTENT.moves.get(moveId)?.arena;
  return arena ? { kind: arena.kind, shape: arena.shape } : null;
}
