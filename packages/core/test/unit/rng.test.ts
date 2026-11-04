import { describe, expect, it } from 'vitest';
import { createRng, isRngState, rngFromState, type Rng } from '../../src/index.ts';

const draws = (rng: Rng) => Array.from({ length: 50 }, () => rng.next());

describe('seeded RNG', () => {
  it('repeats the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(draws(a)).toEqual(draws(b));
  });

  it('gives different sequences for different seeds', () => {
    expect(createRng(1).next()).not.toBe(createRng(2).next());
    expect(createRng('sky').next()).not.toBe(createRng('skz').next());
  });

  it('treats a string seed the same every time', () => {
    expect(createRng('nebotok').state()).toEqual(createRng('nebotok').state());
  });

  it('keeps next() in [0, 1)', () => {
    const rng = createRng(7);
    for (let draw = 0; draw < 10_000; draw += 1) {
      const value = rng.next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('includes both ends in int()', () => {
    const rng = createRng(3);
    const seen = new Set<number>();
    for (let draw = 0; draw < 2_000; draw += 1) seen.add(rng.int(1, 6));
    expect([...seen].toSorted()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects bad int() bounds', () => {
    const rng = createRng(3);
    expect(() => rng.int(5, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
    expect(() => rng.int(0, 2 ** 33)).toThrow(RangeError);
  });

  it('picks only from the list and refuses an empty one', () => {
    const rng = createRng(9);
    const items = ['cloud', 'island', 'kite'] as const;
    for (let draw = 0; draw < 100; draw += 1) expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);
  });

  it('resumes exactly from a saved state, even through JSON', () => {
    const rng = createRng(123);
    rng.next();
    const saved = JSON.parse(JSON.stringify(rng.state())) as unknown;
    if (!isRngState(saved)) throw new Error('state did not survive JSON');
    const resumed = rngFromState(saved);
    expect(Array.from({ length: 20 }, () => resumed.next())).toEqual(Array.from({ length: 20 }, () => rng.next()));
  });

  it('hands out a copy of its state', () => {
    const rng = createRng(5);
    const before = rng.state();
    rng.next();
    expect(rng.state()).not.toEqual(before);
  });

  it('rejects broken state', () => {
    expect(() => rngFromState([1, 2, 3] as unknown as [number, number, number, number])).toThrow(TypeError);
    expect(() => rngFromState([1, 2, 3, -1])).toThrow(TypeError);
  });
});
