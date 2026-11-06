import { spriteFor } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CLEAR_WEATHER, backdropPlacement, backdropSprite } from '../src/battle-backdrop.ts';
import { CONTENT } from '../src/battle-content.ts';
import { ART } from '../src/sprites.ts';

const ART_SIZE = { width: 64, height: 36 };

describe('the battle background', () => {
  it('draws each weather type from its own background, and a clear day without weather', () => {
    for (const weather of CONTENT.weather.keys()) {
      expect(backdropSprite(weather)).toBe(spriteFor.weather(weather));
      expect(ART.sprites.has(backdropSprite(weather))).toBe(true);
    }
    expect(backdropSprite(null)).toBe(spriteFor.weather(CLEAR_WEATHER));
    expect(backdropSprite('no-such-weather')).toBe(spriteFor.weather(CLEAR_WEATHER));
  });

  it('spans the whole width and reaches from the top to the field’s bottom, at a whole-number scale', () => {
    const cases = [
      { canvas: { width: 390, height: 844 }, fieldBottom: 420 },
      { canvas: { width: 1194, height: 834 }, fieldBottom: 560 },
      { canvas: { width: 360, height: 740 }, fieldBottom: 300 },
      { canvas: { width: 200, height: 100 }, fieldBottom: 900 },
    ];
    for (const { canvas, fieldBottom } of cases) {
      const { x, y, scale } = backdropPlacement(ART_SIZE, canvas, fieldBottom);
      const bottom = Math.min(fieldBottom, canvas.height);
      expect(Number.isInteger(scale)).toBe(true);
      expect(x).toBeLessThanOrEqual(0);
      expect(x + ART_SIZE.width * scale).toBeGreaterThanOrEqual(canvas.width);
      expect(y).toBeLessThanOrEqual(0);
      expect(y + ART_SIZE.height * scale).toBe(bottom);
      expect(Math.abs(x + (ART_SIZE.width * scale) / 2 - canvas.width / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('never draws smaller than the art itself', () => {
    expect(backdropPlacement(ART_SIZE, { width: 10, height: 10 }, 5).scale).toBe(1);
  });
});
