import { describe, expect, it } from 'vitest';
import { COURIER, COURIER_FACINGS, COURIER_POSES, checkArt, courierFrame, withCap } from '../src/art.ts';
import { TILE } from '../src/zoom.ts';

describe('placeholder art', () => {
  it('draws every courier frame on a full 16 by 16 grid with known colours', () => {
    for (const facing of COURIER_FACINGS) {
      for (const pose of COURIER_POSES) expect(() => checkArt(`courier ${facing} ${pose}`, courierFrame(facing, pose), TILE)).not.toThrow();
    }
  });

  it('moves the feet between poses and nothing else', () => {
    for (const facing of COURIER_FACINGS) {
      const stand = courierFrame(facing, 'stand').rows;
      for (const pose of ['stepA', 'stepB'] as const) {
        const step = courierFrame(facing, pose).rows;
        expect(step.slice(0, -2)).toEqual(stand.slice(0, -2));
        expect(step.slice(-2)).not.toEqual(stand.slice(-2));
      }
    }
  });

  it('recolours only the cap', () => {
    const red = withCap(COURIER, 0xff0000);
    expect(red.rows).toBe(COURIER.rows);
    expect(red.palette.y).toBe(0xff0000);
    expect({ ...red.palette, y: COURIER.palette.y }).toEqual(COURIER.palette);
  });
});
