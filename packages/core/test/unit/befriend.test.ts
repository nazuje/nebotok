import { describe, expect, it } from 'vitest';
import { befriendChance, treatLiking, type BefriendRules, type Item } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

const rules: BefriendRules = { basePercent: 10, tiredPercent: 50, favouritePercent: 30, likedPercent: 15, levelPenaltyPer10Levels: 5, minPercent: 5, maxPercent: 95, windowPercent: 50 };
const glowbun = battleContent.species.get('glowbun')!;
const treat = (types: string[], species: string[] = []): Item => ({ id: 'test-treat', kind: 'treat', name: { en: 'Test Treat', sl: 'Testna poslastica' }, likedBy: { species, types } });

describe('treat liking', () => {
  it('knows a favourite, a treat for the weather type, and a plain treat', () => {
    expect(treatLiking(treat([], ['glowbun']), glowbun)).toBe('favourite');
    expect(treatLiking(treat(['sun']), glowbun)).toBe('liked');
    expect(treatLiking(treat(['rain']), glowbun)).toBe('none');
    expect(treatLiking(treat(['rain']), { ...glowbun, favouriteTreat: 'test-treat' })).toBe('favourite');
  });

  it('gives each placeholder treat to the type it is named for', () => {
    expect(treatLiking(battleContent.items.get('sun-treat')!, glowbun)).toBe('liked');
    expect(treatLiking(battleContent.items.get('plain-treat')!, glowbun)).toBe('none');
  });
});

describe('befriend chance', () => {
  it('adds up the base, tiredness and liking, less the level', () => {
    // Half its health gone: 25 of the 50 tired points. Level 20: 10 off.
    expect(befriendChance({ hp: 50, maxHp: 100, level: 20, liking: 'none' }, rules)).toBe(10 + 25 - 10);
    expect(befriendChance({ hp: 50, maxHp: 100, level: 20, liking: 'liked' }, rules)).toBe(10 + 25 + 15 - 10);
    expect(befriendChance({ hp: 0, maxHp: 100, level: 5, liking: 'favourite' }, rules)).toBe(10 + 50 + 30 - 2);
  });

  it('stays between the smallest and largest chance', () => {
    expect(befriendChance({ hp: 100, maxHp: 100, level: 100, liking: 'none' }, rules)).toBe(rules.minPercent);
    expect(befriendChance({ hp: 0, maxHp: 100, level: 1, liking: 'favourite' }, { ...rules, basePercent: 50 })).toBe(rules.maxPercent);
  });

  it('refuses a creature without health to lose', () => {
    expect(() => befriendChance({ hp: 0, maxHp: 0, level: 5, liking: 'none' }, rules)).toThrow(RangeError);
  });
});
