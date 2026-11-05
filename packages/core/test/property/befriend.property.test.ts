import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { befriendChance, type BefriendRules, type TreatLiking } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

const percent = fc.integer({ min: 0, max: 100 });
const rules: fc.Arbitrary<BefriendRules> = fc
  .record({ basePercent: percent, tiredPercent: percent, favouritePercent: percent, likedPercent: percent, levelPenaltyPer10Levels: percent, minPercent: percent, maxPercent: fc.integer({ min: 1, max: 100 }), windowPercent: fc.integer({ min: 1, max: 100 }) })
  .map((raw) => ({
    basePercent: raw.basePercent,
    tiredPercent: raw.tiredPercent,
    favouritePercent: raw.favouritePercent,
    likedPercent: Math.min(raw.likedPercent, raw.favouritePercent),
    levelPenaltyPer10Levels: raw.levelPenaltyPer10Levels,
    minPercent: Math.min(raw.minPercent, raw.maxPercent),
    maxPercent: raw.maxPercent,
    windowPercent: raw.windowPercent,
  }));
const anyRules = fc.oneof(rules, fc.constant(battleContent.befriending));
const creature = fc.integer({ min: 1, max: 1_023 }).chain((maxHp) => fc.record({ maxHp: fc.constant(maxHp), hp: fc.integer({ min: 0, max: maxHp }), level: fc.integer({ min: 1, max: 100 }) }));
const liking = fc.constantFrom<TreatLiking>('favourite', 'liked', 'none');

describe('befriend chance properties', () => {
  it('is a whole percent between the smallest and largest chance', () => {
    fc.assert(
      fc.property(anyRules, creature, liking, (r, c, l) => {
        const chance = befriendChance({ ...c, liking: l }, r);
        expect(Number.isInteger(chance)).toBe(true);
        expect(chance).toBeGreaterThanOrEqual(r.minPercent);
        expect(chance).toBeLessThanOrEqual(r.maxPercent);
      }),
    );
  });

  it('never falls as the creature tires', () => {
    fc.assert(
      fc.property(anyRules, creature, liking, fc.integer({ min: 0, max: 1_023 }), (r, c, l, lost) => {
        const tired = { ...c, hp: Math.max(0, c.hp - lost) };
        expect(befriendChance({ ...tired, liking: l }, r)).toBeGreaterThanOrEqual(befriendChance({ ...c, liking: l }, r));
      }),
    );
  });

  it('ranks a favourite treat over a liked one over a plain one', () => {
    fc.assert(
      fc.property(anyRules, creature, (r, c) => {
        const [favourite, liked, none] = (['favourite', 'liked', 'none'] as const).map((l) => befriendChance({ ...c, liking: l }, r));
        expect(favourite).toBeGreaterThanOrEqual(liked!);
        expect(liked).toBeGreaterThanOrEqual(none!);
      }),
    );
  });

  it('never rises with level', () => {
    fc.assert(
      fc.property(anyRules, creature, liking, fc.integer({ min: 0, max: 99 }), (r, c, l, more) => {
        const higher = { ...c, level: Math.min(100, c.level + more) };
        expect(befriendChance({ ...higher, liking: l }, r)).toBeLessThanOrEqual(befriendChance({ ...c, liking: l }, r));
      }),
    );
  });
});
