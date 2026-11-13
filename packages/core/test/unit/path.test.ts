import { describe, expect, it } from 'vitest';
import { GRASS_STEP_COST, encounterZoneAt, findPath, mapFromRows, pathCost, type WorldMap } from '../../src/index.ts';

const open = mapFromRows('open', ['....', '....', '....']);

/** A map from rows where `g` is walkable tall grass, each such tile its own one-tile encounter area. */
function grassy(rows: readonly string[]): WorldMap {
  const encounterAreas = rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === 'g' ? [{ zone: 'meadow', x, y, width: 1, height: 1 }] : [])));
  return { ...mapFromRows('grassy', rows), encounterAreas };
}

describe('findPath', () => {
  it('walks around walls by the shortest way', () => {
    const map = mapFromRows('wall', ['.#..', '.#.#', '....']);
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 0 },
    ]);
  });

  it('breaks ties the same way every time', () => {
    const path = findPath(open, { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(path).toEqual([
      { x: 0, y: 1 },
      { x: 0, y: 2 },
      { x: 1, y: 2 },
      { x: 2, y: 2 },
    ]);
    expect(findPath(open, { x: 0, y: 0 }, { x: 2, y: 2 })).toEqual(path);
  });

  it('returns no steps when already there', () => {
    expect(findPath(open, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
  });

  it('refuses blocked, outside and unreachable targets', () => {
    const map = mapFromRows('island', ['..#.', '..#.']);
    expect(findPath(map, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 3, y: 0 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 9, y: 0 })).toBeNull();
    expect(findPath(map, { x: 0, y: 0 }, { x: 0.5, y: 0 })).toBeNull();
  });

  it('gives up past its search limit', () => {
    const long = mapFromRows('long', ['.'.repeat(60)]);
    expect(findPath(long, { x: 0, y: 0 }, { x: 59, y: 0 }, 10)).toBeNull();
    expect(findPath(long, { x: 0, y: 0 }, { x: 59, y: 0 })).toHaveLength(59);
  });
});

// The way straight along the bottom row is 4 steps; the way around the wall is 10.
const around = (bottom: string) => grassy(['.....', '.###.', '.###.', bottom]);

describe('findPath and tall grass', () => {
  const from = { x: 0, y: 3 };

  it('goes around tall grass when the way around is 2.5 times as long', () => {
    const map = around('.ggg.');
    const path = findPath(map, from, { x: 4, y: 3 });
    expect(path).toHaveLength(10);
    expect(path?.some((at) => encounterZoneAt(map, at) !== null)).toBe(false);
  });

  it('crosses tall grass when the way around is much longer', () => {
    const map = around('..g..');
    expect(findPath(map, from, { x: 4, y: 3 })).toEqual([1, 2, 3, 4].map((x) => ({ x, y: 3 })));
  });

  it('walks the shortest way when the player taps the grass itself', () => {
    const map = around('.gggg');
    expect(findPath(map, from, { x: 4, y: 3 })).toHaveLength(4);
    expect(findPath(map, from, { x: 3, y: 3 })).toHaveLength(3);
  });

  it('counts each step onto tall grass at GRASS_STEP_COST', () => {
    const map = around('.ggg.');
    expect(pathCost(map, [1, 2, 3, 4].map((x) => ({ x, y: 3 })))).toBe(3 * GRASS_STEP_COST + 1);
    expect(pathCost(open, [{ x: 1, y: 0 }, { x: 2, y: 0 }])).toBe(2);
    expect(pathCost(map, [])).toBe(0);
  });
});
