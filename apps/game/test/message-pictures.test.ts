import { REFUSAL_REASONS } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { REFUSAL_PICTURES, SHRINE_SPRITE, toastPicture } from '../src/message-pictures.ts';
import { ART } from '../src/sprites.ts';

describe('message pictures', () => {
  it('gives every refusal reason a picture the art has, on its toast too', () => {
    for (const reason of REFUSAL_REASONS) {
      const picture = REFUSAL_PICTURES[reason];
      expect(picture, `refused.${reason} has no picture`).toBeTruthy();
      expect(ART.sprites.has(picture), `refused.${reason}: no sprite ${picture}`).toBe(true);
      expect(toastPicture(`refused.${reason}`)).toBe(picture);
    }
  });

  it('shows why with the picture that says it', () => {
    expect(REFUSAL_PICTURES.tooFar).toBe('pictures/footprints');
    expect(REFUSAL_PICTURES.notAtShrine).toBe(SHRINE_SPRITE);
    expect(REFUSAL_PICTURES.needsLevel).toBe('pictures/lock');
    expect(REFUSAL_PICTURES.bagFull).toBe('pictures/bag-full');
    expect(REFUSAL_PICTURES.resting).toBe('pictures/clock');
  });

  it('pictures the other short messages, each with art', () => {
    for (const id of ['battle.interrupted', 'shrine.rested', 'profile.error.hasPin'] as const) {
      const picture = toastPicture(id);
      expect(picture !== null && ART.sprites.has(picture), `${id}: ${picture}`).toBe(true);
    }
    expect(toastPicture('game.title')).toBeNull();
  });
});
