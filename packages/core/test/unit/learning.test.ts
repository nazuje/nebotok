import { describe, expect, it } from 'vitest';
import { answerMove, chooseMove, emptyProgress, gainXp, learnMoves, learnTeamMoves, newCreature, xpToNextLevel, type CreatureInstance } from '../../src/index.ts';
import { battleContent, goldenBattleContent } from '../support/battle-content.ts';

const glowbun = battleContent.species.get('glowbun')!;
const later = (glowbun.learnset ?? []).filter((entry) => entry.level > 1);
const [first, second, third] = later;

/** Glowbun at `level`, knowing `moves`. */
const glowbunAt = (level: number, moves: readonly string[] = glowbun.moves): CreatureInstance => ({ ...newCreature('glowbun', level, battleContent), moves: [...moves] });
const grownTo = (creature: CreatureInstance, level: number): CreatureInstance => ({ ...creature, level });

describe('learning moves', () => {
  it('offers the learnset move of a level reached with four moves known, and changes nothing yet', () => {
    const before = glowbunAt(first!.level - 1);
    const after = grownTo(before, first!.level);
    expect(learnMoves(before, after, battleContent)).toEqual({ creature: after, learned: [], offered: [first!.move] });
  });

  it('adds a new move straight away while the creature knows fewer than four', () => {
    const before = glowbunAt(first!.level - 1, glowbun.moves.slice(0, 2));
    const learning = learnMoves(before, grownTo(before, first!.level), battleContent);
    expect(learning.learned).toEqual([first!.move]);
    expect(learning.offered).toEqual([]);
    expect(learning.creature.moves).toEqual([...glowbun.moves.slice(0, 2), first!.move]);
  });

  it('takes several levels in learnset order: learning while there is room, offering the rest', () => {
    const before = glowbunAt(first!.level - 1, glowbun.moves.slice(0, 3));
    const learning = learnMoves(before, grownTo(before, third!.level), battleContent);
    expect(learning.learned).toEqual([first!.move]);
    expect(learning.offered).toEqual([second!.move, third!.move]);
    expect(learning.creature.moves).toHaveLength(4);
  });

  it('learns nothing it already knows, nothing at or below its old level, and nothing without a level up', () => {
    const knows = glowbunAt(first!.level - 1, [...glowbun.moves.slice(0, 3), first!.move]);
    expect(learnMoves(knows, grownTo(knows, first!.level), battleContent).offered).toEqual([]);
    const at = glowbunAt(first!.level);
    expect(learnMoves(at, grownTo(at, second!.level - 1), battleContent).offered).toEqual([]);
    expect(learnMoves(at, at, battleContent)).toEqual({ creature: at, learned: [], offered: [] });
  });

  it('goes with gainXp: experience that crosses a learnset level offers its move', () => {
    const before = glowbunAt(first!.level - 1);
    const after = gainXp(before, xpToNextLevel(before.level), battleContent);
    expect(learnMoves(before, after, battleContent).offered).toEqual([first!.move]);
  });

  it('learns nothing from content without learnsets, as the frozen golden content has', () => {
    const before = { ...newCreature('glowbun', 5, battleContent) };
    const species = [...goldenBattleContent.species.values()][0]!;
    const golden = { ...before, species: species.id, moves: [...species.moves] };
    expect(learnMoves(golden, grownTo(golden, 99), goldenBattleContent).offered).toEqual([]);
  });

  it('goes through a team by place: learning, offering, and passing over a creature that did not grow or is new', () => {
    const roomy = glowbunAt(first!.level - 1, glowbun.moves.slice(0, 2));
    const full = glowbunAt(first!.level - 1);
    const still = glowbunAt(first!.level - 1);
    const befriended = glowbunAt(first!.level);
    const before = [roomy, full, still];
    const after = [grownTo(roomy, first!.level), grownTo(full, first!.level), still, befriended];
    const taught = learnTeamMoves(before, after, battleContent);
    expect(taught.learned).toEqual([{ index: 0, move: first!.move }]);
    expect(taught.offers).toEqual([{ index: 1, move: first!.move }]);
    expect(taught.team.map((creature) => creature.moves)).toEqual([[...glowbun.moves.slice(0, 2), first!.move], glowbun.moves, glowbun.moves, glowbun.moves]);
    expect(taught.team[2]).toBe(still);
    expect(taught.team[3]).toBe(befriended);
  });
});

describe('choosing a move', () => {
  it('puts the new move in the slot of the one forgotten, or keeps the moves on a skip', () => {
    const creature = glowbunAt(first!.level);
    expect(chooseMove(creature, first!.move, 1)?.moves).toEqual(glowbun.moves.with(1, first!.move));
    expect(chooseMove(creature, first!.move, null)).toBe(creature);
  });

  it('refuses an empty slot or a move it knows', () => {
    const creature = glowbunAt(first!.level);
    expect(chooseMove(creature, first!.move, 4)).toBeNull();
    expect(chooseMove(creature, first!.move, -1)).toBeNull();
    expect(chooseMove(glowbunAt(first!.level, glowbun.moves.slice(0, 2)), first!.move, 2)).toBeNull();
    expect(chooseMove(creature, glowbun.moves[0]!, 1)).toBeNull();
  });

  it('answers for the team creature at a place, and refuses a place with nobody', () => {
    const progress = { ...emptyProgress(), team: [newCreature('puddlepip', 5, battleContent), glowbunAt(first!.level)] };
    expect(answerMove(progress, { index: 1, move: first!.move }, 0)?.team[1]?.moves[0]).toBe(first!.move);
    expect(answerMove(progress, { index: 1, move: first!.move }, null)).toBe(progress);
    expect(answerMove(progress, { index: 2, move: first!.move }, 0)).toBeNull();
  });
});
