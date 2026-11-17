import { ARENA_KINDS, ARENA_SHAPES, type ArenaKind, type ArenaShape } from '@nebotok/core';
import moves from '../../../content/creatures/moves.json';
import { CONTENT } from './battle-content.ts';

/**
 * Each move's kind and shape in an arena fight (docs/arena.md, "Every move's kind and shape"). The
 * move's own `arena` block in `content/creatures/moves.json` decides; until every move carries one,
 * the table below stands in, copied from docs/arena.md.
 */

export type MoveArena = { readonly kind: ArenaKind; readonly shape: ArenaShape };

const FROM_DOCS: Readonly<Record<string, MoveArena>> = {
  'heat-shimmer': { kind: 'quick', shape: 'cone' },
  'sun-ray': { kind: 'special', shape: 'shield' },
  'noon-blaze': { kind: 'ultimate', shape: 'zone' },
  'drip-drop': { kind: 'quick', shape: 'bolt' },
  'puddle-jump': { kind: 'special', shape: 'puddle' },
  downpour: { kind: 'ultimate', shape: 'wall' },
  'snow-puff': { kind: 'quick', shape: 'cone' },
  'icicle-poke': { kind: 'special', shape: 'snare' },
  'big-freeze': { kind: 'ultimate', shape: 'freeze' },
  'gust-push': { kind: 'quick', shape: 'bolt' },
  twirl: { kind: 'special', shape: 'burst' },
  'sky-sweep': { kind: 'ultimate', shape: 'wall' },
  'static-zap': { kind: 'quick', shape: 'spray' },
  'cloud-clap': { kind: 'special', shape: 'strike' },
  'sky-crackle': { kind: 'ultimate', shape: 'strike' },
  'petal-toss': { kind: 'quick', shape: 'spray' },
  'vine-tickle': { kind: 'special', shape: 'snare' },
  'pollen-burst': { kind: 'ultimate', shape: 'zone' },
};

const isKind = (value: unknown): value is ArenaKind => ARENA_KINDS.some((kind) => kind === value);
const isShape = (value: unknown): value is ArenaShape => ARENA_SHAPES.some((shape) => shape === value);

function ownBlock(moveId: string): MoveArena | null {
  const entry: unknown = moves.moves.find((move) => move.id === moveId);
  const block = entry && typeof entry === 'object' && 'arena' in entry ? entry.arena : null;
  if (!block || typeof block !== 'object' || !('kind' in block) || !('shape' in block)) return null;
  return isKind(block.kind) && isShape(block.shape) ? { kind: block.kind, shape: block.shape } : null;
}

/** Taps are bolts, wallops lunges and calls weather, whatever their type. */
function byName(moveId: string): MoveArena | null {
  if (CONTENT.moves.get(moveId)?.setsWeather) return { kind: 'ultimate', shape: 'weather' };
  if (moveId.endsWith('-tap')) return { kind: 'quick', shape: 'bolt' };
  if (moveId.endsWith('-wallop')) return { kind: 'special', shape: 'lunge' };
  return null;
}

/** A move's kind and shape, or null for a move the arena does not know. */
export function moveArena(moveId: string): MoveArena | null {
  return ownBlock(moveId) ?? byName(moveId) ?? FROM_DOCS[moveId] ?? null;
}
