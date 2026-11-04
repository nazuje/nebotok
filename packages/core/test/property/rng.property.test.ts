import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng, rngFromState } from '../../src/index.ts';

const seed = fc.oneof(fc.integer({ min: 0, max: 0xffffffff }), fc.string());

describe('seeded RNG properties', () => {
  it('replays identically for any seed', () => {
    fc.assert(
      fc.property(seed, fc.integer({ min: 1, max: 200 }), (value, length) => {
        const a = createRng(value);
        const b = createRng(value);
        for (let draw = 0; draw < length; draw += 1) expect(a.next()).toBe(b.next());
      }),
    );
  });

  it('keeps int() inside any valid range', () => {
    fc.assert(
      fc.property(
        seed,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (value, min, width) => {
          const max = min + width;
          const rng = createRng(value);
          for (let draw = 0; draw < 20; draw += 1) {
            const result = rng.int(min, max);
            expect(Number.isInteger(result)).toBe(true);
            expect(result).toBeGreaterThanOrEqual(min);
            expect(result).toBeLessThanOrEqual(max);
          }
        },
      ),
    );
  });

  it('always picks a member of a non-empty list', () => {
    fc.assert(
      fc.property(seed, fc.array(fc.string(), { minLength: 1, maxLength: 30 }), (value, items) => {
        expect(items).toContain(createRng(value).pick(items));
      }),
    );
  });

  it('resumes from any point in the sequence', () => {
    fc.assert(
      fc.property(seed, fc.integer({ min: 0, max: 100 }), (value, skip) => {
        const rng = createRng(value);
        for (let draw = 0; draw < skip; draw += 1) rng.next();
        const resumed = rngFromState(rng.state());
        expect(resumed.int(0, 1_000_000)).toBe(rng.int(0, 1_000_000));
      }),
    );
  });

  it('spreads int() roughly evenly', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (value) => {
        const rng = createRng(value);
        const counts = [0, 0, 0, 0];
        const draws = 4_000;
        for (let draw = 0; draw < draws; draw += 1) counts[rng.int(0, 3)]! += 1;
        for (const count of counts) expect(Math.abs(count - draws / 4)).toBeLessThan(draws * 0.06);
      }),
      { numRuns: 30 },
    );
  });
});
