import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRng, rngFromState, rollEncounter, type EncounterZone } from '../../src/index.ts';
import { speciesIds, weatherIds } from '../support/battle-content.ts';

const entry = fc
  .record({ species: fc.constantFrom(...speciesIds), a: fc.integer({ min: 1, max: 100 }), b: fc.integer({ min: 1, max: 100 }), weight: fc.integer({ min: 1, max: 1_000 }) })
  .map(({ species, a, b, weight }) => ({ species, minLevel: Math.min(a, b), maxLevel: Math.max(a, b), weight }));
const zone: fc.Arbitrary<EncounterZone> = fc.record({
  id: fc.constant('test-grass'),
  encounterPercent: fc.integer({ min: 1, max: 100 }),
  weather: fc.option(fc.constantFrom(...weatherIds), { nil: null }),
  creatures: fc.array(entry, { minLength: 1, maxLength: 8 }),
});
const seed = fc.integer({ min: 0, max: 0xffffffff });

describe('wild encounter properties', () => {
  it('only ever meets a creature the zone lists, at a level it allows', () => {
    fc.assert(
      fc.property(zone, seed, (z, value) => {
        const rng = createRng(value);
        for (let step = 0; step < 20; step += 1) {
          const wild = rollEncounter(z, rng);
          if (wild === null) continue;
          expect(z.creatures.some((c) => c.species === wild.species && wild.level >= c.minLevel && wild.level <= c.maxLevel)).toBe(true);
        }
      }),
    );
  });

  it('gives the same encounter and leaves the RNG in the same state from the same RNG state', () => {
    fc.assert(
      fc.property(zone, seed, (z, value) => {
        const rng = createRng(value);
        const before = rng.state();
        const wild = rollEncounter(z, rng);
        const after = rng.state();
        const replay = rngFromState(before);
        expect(rollEncounter(z, replay)).toEqual(wild);
        expect(replay.state()).toEqual(after);
      }),
    );
  });
});
