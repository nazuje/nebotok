import { describe, expect, it } from 'vitest';
import { MIN_VIEW_TILES, TILE, integerView } from '../src/zoom.ts';

describe('integer zoom', () => {
  it('uses the largest whole zoom that still shows the minimum view', () => {
    expect(integerView(390, 844)).toEqual({ zoom: 2, width: 195, height: 422 });
    expect(integerView(1194, 834)).toEqual({ zoom: 4, width: 298, height: 208 });
    expect(integerView(1920, 1080)).toEqual({ zoom: 6, width: 320, height: 180 });
  });

  it('always shows at least the minimum view in tiles', () => {
    for (const [w, h] of [[360, 640], [390, 844], [768, 1024], [1366, 768], [2560, 1440]] as const) {
      const view = integerView(w, h);
      expect(Number.isInteger(view.zoom)).toBe(true);
      expect(view.width * view.zoom).toBeLessThanOrEqual(w);
      expect(view.height * view.zoom).toBeLessThanOrEqual(h);
      expect(view.width).toBeGreaterThanOrEqual(MIN_VIEW_TILES.width * TILE);
      expect(view.height).toBeGreaterThanOrEqual(MIN_VIEW_TILES.height * TILE);
    }
  });

  it('never goes below zoom 1 on a tiny screen', () => {
    expect(integerView(100, 100).zoom).toBe(1);
  });
});
