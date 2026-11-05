import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, gainXp, maxHpOf, newCreature, xpToNextLevel } from '../../src/index.ts';
import { battleContent, speciesIds } from '../support/battle-content.ts';

const creature = fc
  .record({ species: fc.constantFrom(...speciesIds), level: fc.integer({ min: 1, max: MAX_LEVEL }), xpShare: fc.integer({ min: 0, max: 99 }), hpShare: fc.integer({ min: 0, max: 100 }) })
  .map(({ species, level, xpShare, hpShare }) => {
    const base = newCreature(species, level, battleContent);
    return Object.assign(base, { xp: level === MAX_LEVEL ? 0 : Math.floor((xpToNextLevel(level) * xpShare) / 100), hp: Math.floor((base.hp * hpShare) / 100) });
  });

describe('growth properties', () => {
  it('never lowers a level, never passes the top, and leaves less experience than the next level needs', () => {
    fc.assert(
      fc.property(creature, fc.integer({ min: 0, max: 100_000 }), (before, xp) => {
        const after = gainXp(before, xp, battleContent);
        expect(after.level).toBeGreaterThanOrEqual(before.level);
        expect(after.level).toBeLessThanOrEqual(MAX_LEVEL);
        expect(after.xp).toBeGreaterThanOrEqual(0);
        expect(after.level === MAX_LEVEL ? after.xp === 0 : after.xp < xpToNextLevel(after.level)).toBe(true);
        expect(after.hp).toBeGreaterThanOrEqual(0);
        expect(after.hp).toBeLessThanOrEqual(maxHpOf(after, battleContent));
        expect(after.hp === 0).toBe(before.hp === 0);
      }),
    );
  });

  it('gives the same result for experience given at once or in two parts', () => {
    fc.assert(
      fc.property(creature, fc.integer({ min: 0, max: 5_000 }), fc.integer({ min: 0, max: 5_000 }), (before, a, b) => {
        expect(gainXp(gainXp(before, a, battleContent), b, battleContent)).toEqual(gainXp(before, a + b, battleContent));
      }),
    );
  });
});
