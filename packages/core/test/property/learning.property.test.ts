import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, MOVES_PER_CREATURE, chooseMove, learnMoves, newCreature } from '../../src/index.ts';
import { battleContent, speciesIds } from '../support/battle-content.ts';

const learnsetOf = (species: string) => battleContent.species.get(species)?.learnset?.map((entry) => entry.move) ?? [];

/** A creature at some level that knows one to four moves from its own learnset, and the level it grows to. */
const growing = fc
  .record({
    species: fc.constantFrom(...speciesIds),
    from: fc.integer({ min: 1, max: MAX_LEVEL }),
    by: fc.integer({ min: 0, max: 40 }),
    picks: fc.uniqueArray(fc.integer({ min: 0, max: 7 }), { minLength: 1, maxLength: MOVES_PER_CREATURE }),
  })
  .map(({ species, from, by, picks }) => {
    const learnset = learnsetOf(species);
    const moves = [...new Set(picks.map((at) => learnset[at % learnset.length]!))];
    const before = { ...newCreature(species, from, battleContent), moves };
    return { before, after: { ...before, level: Math.min(MAX_LEVEL, from + by) } };
  });

describe('learning properties', () => {
  it('never knows more than four moves or a move twice, whatever the player answers', () => {
    fc.assert(
      fc.property(growing, fc.array(fc.option(fc.integer({ min: 0, max: MOVES_PER_CREATURE - 1 })), { maxLength: 8 }), ({ before, after }, answers) => {
        const learning = learnMoves(before, after, battleContent);
        let creature = learning.creature;
        expect(creature.moves.length).toBeLessThanOrEqual(MOVES_PER_CREATURE);
        expect(new Set(creature.moves).size).toBe(creature.moves.length);
        expect(learning.offered.length === 0 || creature.moves.length === MOVES_PER_CREATURE).toBe(true);
        learning.offered.forEach((move, at) => {
          creature = chooseMove(creature, move, answers[at] ?? null) ?? creature;
          expect(creature.moves.length).toBeLessThanOrEqual(MOVES_PER_CREATURE);
          expect(new Set(creature.moves).size).toBe(creature.moves.length);
        });
      }),
    );
  });

  it('learns or offers each new learnset move of the levels crossed once, in learnset order', () => {
    fc.assert(
      fc.property(growing, ({ before, after }) => {
        const { learned, offered, creature } = learnMoves(before, after, battleContent);
        const learnset = battleContent.species.get(before.species)?.learnset ?? [];
        const crossed = learnset.filter((entry) => entry.level > before.level && entry.level <= after.level && !before.moves.includes(entry.move)).map((entry) => entry.move);
        expect([...learned, ...offered]).toEqual(crossed);
        expect(creature.moves).toEqual([...before.moves, ...learned]);
        expect(offered.some((move) => creature.moves.includes(move))).toBe(false);
      }),
    );
  });

  it('gives the same answer for the same creature', () => {
    fc.assert(
      fc.property(growing, ({ before, after }) => {
        expect(learnMoves(structuredClone(before), structuredClone(after), battleContent)).toEqual(learnMoves(before, after, battleContent));
      }),
    );
  });
});
