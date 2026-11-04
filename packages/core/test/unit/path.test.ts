import { describe, expect, it } from 'vitest';
import { findPath, mapFromRows } from '../../src/index.ts';

const open = mapFromRows('open', ['....', '....', '....']);

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
