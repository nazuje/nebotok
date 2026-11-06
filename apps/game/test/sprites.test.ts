import { COURIER_FACINGS, COURIER_POSES, DEFAULT_COURIER, courierFrame, isPngSprite, type PixelSprite } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { AVATARS } from '../src/avatars.ts';
import { courierSprite, stretched, walkTiming } from '../src/couriers.ts';
import { ART, animationFrames, sprite } from '../src/sprites.ts';

const drawn = (id: string): PixelSprite => {
  const art = sprite(id);
  if (isPngSprite(art)) throw new Error(`${id} is a PNG`);
  return art;
};

describe('art', () => {
  it('bundles every sprite and the island tileset', () => {
    expect(ART.sprites.size).toBeGreaterThan(0);
    expect(ART.tilesets.get('sky-tiles')?.tiles.length).toBeGreaterThan(0);
  });

  it('draws each avatar with its own courier, and an unknown one with the default courier', () => {
    for (const avatar of AVATARS) expect(courierSprite(avatar.id)).toBe(`couriers/${avatar.id}`);
    expect(courierSprite('no-such-avatar')).toBe(DEFAULT_COURIER);
  });

  it('moves the feet between poses and nothing else', () => {
    for (const avatar of AVATARS) {
      const art = drawn(courierSprite(avatar.id));
      for (const facing of COURIER_FACINGS) {
        const stand = art.frames[courierFrame(facing, 'stand')] ?? [];
        for (const pose of COURIER_POSES.filter((each) => each !== 'stand')) {
          const step = art.frames[courierFrame(facing, pose)] ?? [];
          expect(step.slice(0, -2)).toEqual(stand.slice(0, -2));
          expect(step.slice(-2)).not.toEqual(stand.slice(-2));
        }
      }
    }
  });

  it('gives each avatar the default courier with only its cap recoloured', () => {
    const base = drawn(DEFAULT_COURIER);
    for (const avatar of AVATARS) {
      const art = drawn(courierSprite(avatar.id));
      expect(art.frames).toEqual(base.frames);
      expect({ ...art.palette, y: base.palette.y }).toEqual(base.palette);
      expect(art.palette.y).not.toBe(base.palette.y);
    }
  });

  it('turns per-frame times into a Phaser frame rate and extra durations', () => {
    expect(animationFrames([700, 300])).toEqual({ frameRate: 1_000 / 300, durations: [400, 0] });
    expect(animationFrames([100, 100])).toEqual({ frameRate: 10, durations: [0, 0] });
  });

  it('stretches a walk cycle over two steps and leaves other animations alone', () => {
    expect(stretched([1, 1, 2], 400)).toEqual([100, 100, 200]);
    const timing = walkTiming(200);
    expect(timing('walk-down', [100, 100, 100, 100])).toEqual([100, 100, 100, 100]);
    expect(timing('walk-right', [50, 50, 50, 50])).toEqual([100, 100, 100, 100]);
    expect(timing('blink', [900, 100])).toEqual([900, 100]);
  });
});
