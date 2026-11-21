import { maxHpOf, newCreature, type TeamCreature } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/battle-content.ts';
import { cameInHurt, healthLevel, needsRest, teamNeedsRest } from '../src/health-level.ts';

const species = [...CONTENT.species.keys()][0]!;
const withHp = (share: number): TeamCreature => {
  const creature = newCreature(species, 10, CONTENT);
  return { ...creature, hp: Math.floor(maxHpOf(creature, CONTENT) * share), learned: [] };
};

describe('how hurt a creature looks', () => {
  it('is green above half, amber above a fifth and red at or below it', () => {
    expect(healthLevel(100, 100)).toBe('high');
    expect(healthLevel(51, 100)).toBe('high');
    expect(healthLevel(50, 100)).toBe('mid');
    expect(healthLevel(21, 100)).toBe('mid');
    expect(healthLevel(20, 100)).toBe('low');
    expect(healthLevel(0, 100)).toBe('low');
    expect(healthLevel(5, 0)).toBe('low');
  });

  it('points to the shrine once the bar is no longer green, fainted too', () => {
    expect(needsRest(51, 100)).toBe(false);
    expect(needsRest(50, 100)).toBe(true);
    expect(needsRest(0, 100)).toBe(true);
    expect(teamNeedsRest([withHp(1), withHp(0.9)])).toBe(false);
    expect(teamNeedsRest([withHp(1), withHp(0.4)])).toBe(true);
    expect(teamNeedsRest([])).toBe(false);
  });
});

describe('a creature that came onto the island hurt', () => {
  it('is judged by its health the first time it shows, and stays so while it fights on', () => {
    const entered = new Map<string, boolean>();
    expect(cameInHurt(entered, 'a', 30, 100)).toBe(true);
    expect(cameInHurt(entered, 'a', 0, 100)).toBe(true);
    expect(cameInHurt(entered, 'b', 100, 100)).toBe(false);
    expect(cameInHurt(entered, 'b', 10, 100)).toBe(false);
  });
});
