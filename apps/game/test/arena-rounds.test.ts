import { ROUND_DRAW, newCreature, type TeamCreature } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/battle-content.ts';
import { pipsOf, tappedOrder } from '../src/arena/arena-rounds.ts';

const creature = (species: string, hp?: number): TeamCreature => {
  const made = newCreature(species, 10, CONTENT);
  return { ...made, hp: hp ?? made.hp, learned: [] };
};

describe('the pick screen', () => {
  const team = [creature('glowbun'), creature('pinwhirl', 0), creature('puddlepip'), creature('drizzlesnail'), creature('glowbun')];

  it('takes a tapped creature out and puts it back in the first empty slot', () => {
    const out = tappedOrder([0, 2, 3], 2, team);
    expect(out).toEqual([0, 3]);
    expect(tappedOrder(out, 2, team)).toEqual([0, 3, 2]);
    expect(tappedOrder(out, 4, team)).toEqual([0, 3, 4]);
  });

  it('never picks a fainted creature, or a fourth', () => {
    expect(tappedOrder([0, 2], 1, team)).toEqual([0, 2]);
    expect(tappedOrder([0, 2, 3], 4, team)).toEqual([0, 2, 3]);
  });
});

describe('the score between rounds', () => {
  it('shows a trophy for each round you won, a puff for one lost or level, and empty ones to come', () => {
    expect(pipsOf([], 0)).toEqual(['empty', 'empty', 'empty']);
    expect(pipsOf([0], 0)).toEqual(['won', 'empty', 'empty']);
    expect(pipsOf([0, 1], 1)).toEqual(['lost', 'won', 'empty']);
    expect(pipsOf([ROUND_DRAW, 1, 1], 0)).toEqual(['lost', 'lost', 'lost']);
  });
});
