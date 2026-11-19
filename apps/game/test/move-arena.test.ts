import { ARENA_SHAPES, DIGIT_FRAMES, KIND_PICTURES, SHAPE_PICTURES, TINT_KEYS, frameNames, isPngSprite, spriteFor } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/battle-content.ts';
import { moveArena } from '../src/move-arena.ts';
import { ART } from '../src/sprites.ts';

describe('move pictures', () => {
  it('gives every move a kind and a shape, whose pictures the art has', () => {
    for (const moveId of CONTENT.moves.keys()) {
      const arena = moveArena(moveId);
      expect(arena, `${moveId} has no kind and shape`).not.toBeNull();
      if (!arena) continue;
      expect(ART.sprites.has(spriteFor.picture(SHAPE_PICTURES[arena.shape])), `${moveId}: no picture for ${arena.shape}`).toBe(true);
      expect(ART.sprites.has(spriteFor.picture(KIND_PICTURES[arena.kind])), `${moveId}: no mark for ${arena.kind}`).toBe(true);
    }
  });

  it('reads each move\'s own arena block, and knows no move that is not in moves.json', () => {
    expect(moveArena('rain-tap')).toEqual({ kind: 'quick', shape: 'bolt' });
    expect(moveArena('storm-wallop')).toEqual({ kind: 'special', shape: 'lunge' });
    expect(moveArena('bloom-call')).toEqual({ kind: 'ultimate', shape: 'weather' });
    expect(moveArena('big-freeze')).toEqual({ kind: 'ultimate', shape: 'freeze' });
    expect(moveArena('no-such-move')).toBeNull();
  });

  it('draws every shape in the tint keys, so a type can colour it', () => {
    for (const shape of ARENA_SHAPES) {
      const drawn = ART.sprites.get(spriteFor.picture(SHAPE_PICTURES[shape]));
      expect(drawn && !isPngSprite(drawn), `${shape} is not drawn`).toBe(true);
      if (!drawn || isPngSprite(drawn)) continue;
      const used = new Set(Object.values(drawn.frames).flat().join(''));
      expect(used.has(TINT_KEYS.main), `${shape} has no main tint`).toBe(true);
    }
  });

  it('gives every weather type its tint and every digit a frame', () => {
    for (const type of CONTENT.weather.values()) expect(type.colours, `${type.id} has no colours`).toBeDefined();
    const digits = ART.sprites.get(spriteFor.picture('digits'));
    expect(digits && frameNames(digits)).toEqual(DIGIT_FRAMES);
  });
});
