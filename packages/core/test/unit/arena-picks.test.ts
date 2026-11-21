import { describe, expect, it } from 'vitest';
import { defaultPickOrder, isPickOrder, newCreature, pickCount, roundsTeam, togglePick } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

describe('picking three for a best of 3', () => {
  it('picks the first three standing creatures by default, or all of them when fewer stand', () => {
    expect(defaultPickOrder([0, 2, 3, 5])).toEqual([0, 2, 3]);
    expect(defaultPickOrder([1, 4])).toEqual([1, 4]);
    expect(pickCount([1, 4])).toBe(2);
    expect(isPickOrder(defaultPickOrder([0, 2, 3, 5]), [0, 2, 3, 5])).toBe(true);
  });

  it('takes a creature out with a tap, moves the rest up, and puts it back in the first empty slot', () => {
    const standing = [0, 1, 2, 3];
    const out = togglePick([0, 1, 2], 1, standing);
    expect(out).toEqual([0, 2]);
    expect(togglePick(out, 1, standing)).toEqual([0, 2, 1]);
    expect(togglePick(out, 3, standing)).toEqual([0, 2, 3]);
  });

  it('adds nothing to a full pick, and never a fainted creature', () => {
    expect(togglePick([0, 1, 2], 3, [0, 1, 2, 3])).toEqual([0, 1, 2]);
    expect(togglePick([0], 1, [0, 2, 3])).toEqual([0]);
  });

  it('refuses a short pick, a creature twice, a fainted one and one not on the team', () => {
    const standing = [0, 2, 3];
    expect(isPickOrder([0, 2], standing)).toBe(false);
    expect(isPickOrder([0, 0, 2], standing)).toBe(false);
    expect(isPickOrder([0, 1, 2], standing)).toBe(false);
    expect(isPickOrder([0, 2, 5], standing)).toBe(false);
    expect(isPickOrder([3, 0, 2], standing)).toBe(true);
  });

  it('offers the standing team as fighters named by their team place', () => {
    const team = [newCreature('glowbun', 8, battleContent), { ...newCreature('puddlepip', 8, battleContent), hp: 0 }, newCreature('bloomlet', 9, battleContent)];
    const picks = roundsTeam(team, true);
    expect(picks.map(({ place, fighter }) => [place, fighter.id, fighter.species, fighter.turtle, fighter.computer])).toEqual([
      [0, 'a1', 'glowbun', true, false],
      [2, 'a3', 'bloomlet', true, false],
    ]);
  });
});
