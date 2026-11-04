import { describe, expect, it } from 'vitest';
import { COURIER, ISLAND, ISLAND_TILE_KEYS, TILES, checkArt } from '../src/art.ts';
import { TILE } from '../src/zoom.ts';

describe('placeholder art', () => {
  it('draws every sprite on a full 16 by 16 grid with known colours', () => {
    expect(() => checkArt('courier', COURIER, TILE)).not.toThrow();
    for (const [name, art] of Object.entries(TILES)) expect(() => checkArt(name, art, TILE)).not.toThrow();
  });

  it('builds the island only from tiles that exist', () => {
    const width = ISLAND[0]?.length;
    for (const row of ISLAND) {
      expect(row.length).toBe(width);
      for (const letter of row) {
        if (letter === '.') continue;
        const key = ISLAND_TILE_KEYS[letter];
        expect(key && TILES[key]).toBeTruthy();
      }
    }
  });
});
