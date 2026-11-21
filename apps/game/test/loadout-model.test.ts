import { ARENA_KINDS, learnedBy, newCreature, type TeamCreature } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/battle-content.ts';
import { buttonFor, buttonTiles, chosenLoadout, offeredMoves, powerPips, tappedButton } from '../src/loadout-model.ts';

const teamCreature = (species: string, level: number): TeamCreature => {
  const made = newCreature(species, level, CONTENT);
  return { ...made, learned: learnedBy(made, CONTENT) };
};
const kindOf = (move: string) => CONTENT.moves.get(move)?.arena?.kind;
const unlocksAt = CONTENT.arena?.buttons ?? [];

describe('the loadout picker', () => {
  it('offers exactly the learned moves of each button’s kind, for every species and level', () => {
    const emptyButtons: string[] = [];
    for (const species of CONTENT.species.keys()) {
      for (const level of [1, 6, 7, 11, 12, 15, 20, 40]) {
        const creature = teamCreature(species, level);
        for (const [button, kind] of ARENA_KINDS.entries()) {
          const offered = offeredMoves(creature, button, CONTENT);
          const unlocked = level >= (unlocksAt[button] ?? Infinity);
          expect(offered).toEqual(unlocked ? creature.learned.filter((move) => kindOf(move) === kind) : []);
          if (unlocked && offered.length === 0) emptyButtons.push(`${species} at ${level}, button ${button + 1}`);
        }
      }
    }
    expect(emptyButtons).toEqual([]);
  });

  it('offers a move learned past the four a turn battle keeps', () => {
    const creature = teamCreature('glowbun', 15);
    expect(creature.moves).not.toContain('sun-wallop');
    expect(offeredMoves(creature, 1, CONTENT)).toEqual(['sun-ray', 'sun-wallop']);
  });

  it('shows each button locked with its level until the creature reaches it', () => {
    const tiles = buttonTiles(teamCreature('glowbun', 8), CONTENT);
    expect(tiles.map(({ kind, locked, unlocksAt: at }) => ({ kind, locked, at }))).toEqual([
      { kind: 'quick', locked: false, at: null },
      { kind: 'special', locked: false, at: null },
      { kind: 'ultimate', locked: true, at: unlocksAt[2] },
    ]);
    expect(tiles[2]?.move).toBeNull();
  });

  it('does nothing on a tap on a locked button', () => {
    const young = teamCreature('glowbun', 3);
    expect(tappedButton(young, 0, 1, CONTENT)).toBe(0);
    expect(tappedButton(young, 0, 2, CONTENT)).toBe(0);
    expect(tappedButton(teamCreature('glowbun', 12), 0, 2, CONTENT)).toBe(2);
  });

  it('asks for a new loadout only for a move offered on that button and not already there', () => {
    const creature = teamCreature('glowbun', 15);
    expect(creature.loadout).toEqual(['heat-shimmer', 'sun-ray', 'sun-call']);
    expect(chosenLoadout(creature, 1, 'sun-wallop', CONTENT)).toEqual(['heat-shimmer', 'sun-wallop', 'sun-call']);
    expect(chosenLoadout(creature, 1, 'sun-ray', CONTENT)).toBeNull();
    expect(chosenLoadout(creature, 0, 'sun-wallop', CONTENT)).toBeNull();
    expect(chosenLoadout(teamCreature('glowbun', 3), 1, 'sun-ray', CONTENT)).toBeNull();
  });

  it('opens on the button of a new move’s kind when it is unlocked', () => {
    expect(buttonFor(teamCreature('glowbun', 15), 'sun-wallop', CONTENT)).toBe(1);
    expect(buttonFor(teamCreature('glowbun', 3), 'sun-ray', CONTENT)).toBe(0);
    expect(buttonFor(teamCreature('glowbun', 15), null, CONTENT)).toBe(0);
  });

  it('shows power as pips: 1 for 40 and 50, 2 for 65 and 80, 3 for 100, none for a call', () => {
    expect([0, 40, 50, 65, 80, 100].map(powerPips)).toEqual([0, 1, 1, 2, 2, 3]);
    const calls = [...CONTENT.moves.values()].filter((move) => move.setsWeather !== undefined).map((move) => move.id);
    expect([...CONTENT.moves.values()].filter((move) => powerPips(move.power) === 0).map((move) => move.id)).toEqual(calls);
  });
});
