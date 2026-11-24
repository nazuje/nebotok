import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ARENA_KINDS,
  MAX_LEVEL,
  MAX_TEAM,
  createSave,
  defaultLoadout,
  emptyProgress,
  isRepaired,
  knowableMoves,
  learnedMoves,
  loadoutFits,
  maxHpOf,
  newCreature,
  sanitizeProgress,
  type CreatureInstance,
  type Progress,
} from '../../src/index.ts';
import { battleContent, speciesIds } from '../support/battle-content.ts';

const moveIds = [...battleContent.moves.keys()].toSorted();
const itemIds = [...battleContent.items.keys()].toSorted();
/** Ids content used to have: a save may still name them. */
const GONE = ['gone-species', 'old-cloud', 'gone-move', 'gone-treat'];
const someId = (ids: readonly string[]) => fc.oneof({ arbitrary: fc.constantFrom(...ids), weight: 4 }, { arbitrary: fc.constantFrom(...GONE), weight: 1 });

const creature: fc.Arbitrary<CreatureInstance> = fc.record({
  species: someId(speciesIds),
  level: fc.integer({ min: 1, max: MAX_LEVEL }),
  xp: fc.integer({ min: 0, max: 1_000 }),
  hp: fc.integer({ min: 0, max: 1_023 }),
  moves: fc.uniqueArray(someId(moveIds), { minLength: 1, maxLength: 4 }),
  loadout: fc.tuple(fc.option(someId(moveIds)), fc.option(someId(moveIds)), fc.option(someId(moveIds))),
});

/** A creature of a species content has, with a loadout of learned moves of each button's kind on its unlocked buttons, or empty ones. */
const fittingCreature: fc.Arbitrary<CreatureInstance> = fc
  .record({ species: fc.constantFrom(...speciesIds), level: fc.integer({ min: 1, max: MAX_LEVEL }) })
  .chain(({ species, level }) => {
    const learned = learnedMoves(battleContent.species.get(species)!, level, battleContent);
    const button = (at: 0 | 1 | 2) => {
      const fits = level >= battleContent.arena!.buttons[at]! ? learned.filter((id) => battleContent.moves.get(id)?.arena?.kind === ARENA_KINDS[at]) : [];
      return fc.constantFrom(null, ...fits);
    };
    const { xp, hp, moves } = newCreature(species, level, battleContent);
    return fc.tuple(button(0), button(1), button(2)).map((loadout): CreatureInstance => ({ species, level, xp, hp, moves, loadout }));
  });

const progress: fc.Arbitrary<Progress> = fc.record({
  team: fc.array(creature, { maxLength: MAX_TEAM }),
  storage: fc.array(creature, { maxLength: 8 }),
  inventory: fc.uniqueArray(fc.record({ item: someId(itemIds), count: fc.integer({ min: 1, max: 999 }) }), { maxLength: 6, selector: (entry) => entry.item }),
  lastShrine: fc.constant(null),
  seen: fc.uniqueArray(someId(speciesIds), { maxLength: 6 }),
  befriended: fc.uniqueArray(someId(speciesIds), { maxLength: 6 }),
  // The story is pruned against the story content after the repair, not by it.
  story: fc.constantFrom({ active: [], done: [], flags: [] }, { active: [{ quest: 'first-round', step: 0, count: 1 }], done: ['gone-quest'], flags: ['gone-flag'] }),
  // Skills and jobs are pruned against the skill content after the repair, like the story.
  skills: fc.constantFrom([], [{ skill: 'cooking', level: 3, xp: 10 }, { skill: 'gone-skill', level: 2, xp: 0 }]),
  jobs: fc.constant(null),
});

const SAVE = { name: 'Test Courier', language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position: null, settings: { readToMe: false, turtle: false, sounds: true } } as const;

describe('save repair properties', () => {
  it('keeps the story exactly as saved', () => {
    fc.assert(
      fc.property(progress, (before) => {
        expect(sanitizeProgress(before, battleContent).progress.story).toEqual(before.story);
      }),
    );
  });

  it('leaves only creatures, moves and items the content has, within bounds, in a save that still parses', () => {
    fc.assert(
      fc.property(progress, (before) => {
        const { progress: after } = sanitizeProgress(before, battleContent);
        for (const owned of [...after.team, ...after.storage]) {
          const species = battleContent.species.get(owned.species);
          expect(species).toBeDefined();
          const knowable = knowableMoves(species!, battleContent);
          expect(owned.moves.length).toBeGreaterThanOrEqual(1);
          expect(owned.moves.every((move) => knowable.has(move))).toBe(true);
          expect(owned.hp).toBeLessThanOrEqual(maxHpOf(owned, battleContent));
        }
        expect(after.inventory.every((entry) => battleContent.items.has(entry.item))).toBe(true);
        expect([...after.seen, ...after.befriended].every((id) => battleContent.species.has(id))).toBe(true);
        expect(() => createSave({ ...SAVE, ...after })).not.toThrow();
      }),
    );
  });

  it('keeps every creature whose species exists, and a team whenever any creature is left', () => {
    fc.assert(
      fc.property(progress, (before) => {
        const { progress: after } = sanitizeProgress(before, battleContent);
        const known = [...before.team, ...before.storage].filter((owned) => battleContent.species.has(owned.species));
        expect(after.team.length + after.storage.length).toBe(known.length);
        expect(after.team.length > 0 || after.storage.length === 0).toBe(true);
      }),
    );
  });

  it('changes nothing the second time, and gives the same answer for the same progress', () => {
    fc.assert(
      fc.property(progress, (before) => {
        const once = sanitizeProgress(before, battleContent);
        const twice = sanitizeProgress(once.progress, battleContent);
        expect(isRepaired(twice.repairs)).toBe(false);
        expect(twice.progress).toEqual(once.progress);
        expect(sanitizeProgress(structuredClone(before), battleContent)).toEqual(once);
      }),
    );
  });

  it('gives a default loadout of only learned moves of each button\'s kind, on unlocked buttons', () => {
    fc.assert(
      fc.property(fc.constantFrom(...speciesIds), fc.integer({ min: 1, max: MAX_LEVEL }), (id, level) => {
        const species = battleContent.species.get(id)!;
        const learned = learnedMoves(species, level, battleContent);
        const loadout = defaultLoadout({ species: id, level }, battleContent);
        const fits = (move: string | null, button: number) =>
          level < battleContent.arena!.buttons[button]! ? move === null : move === null || (learned.includes(move) && battleContent.moves.get(move)?.arena?.kind === ARENA_KINDS[button]);
        expect(loadout.map((move, button) => fits(move, button))).toEqual([true, true, true]);
      }),
    );
  });

  it('leaves only loadouts that suit their creature, and keeps one that already does', () => {
    fc.assert(
      fc.property(progress, (before) => {
        const { progress: after } = sanitizeProgress(before, battleContent);
        for (const owned of [...after.team, ...after.storage]) expect(loadoutFits(owned, owned.loadout, battleContent)).toBe(true);
      }),
    );
    fc.assert(
      fc.property(fittingCreature, (owned) => {
        expect(loadoutFits(owned, owned.loadout, battleContent)).toBe(true);
        const { progress: after } = sanitizeProgress({ ...emptyProgress(), team: [owned] }, battleContent);
        expect(after.team[0]!.loadout).toEqual(owned.loadout);
      }),
    );
  });
  it('leaves progress alone exactly when it reports no repair', () => {
    fc.assert(
      fc.property(progress, (before) => {
        const { progress: after, repairs } = sanitizeProgress(before, battleContent);
        expect(after === before).toBe(!isRepaired(repairs));
      }),
    );
  });
});
