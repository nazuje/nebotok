import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ARENA_IDLE,
  ARENA_MINDS,
  ARENA_SIDES,
  arenaHash,
  arenaStart,
  arenaStep,
  createBrain,
  createRng,
  mindFight,
  wildInput,
  wildLoadout,
  type ArenaFighter,
  type ArenaInput,
  type ArenaInputs,
  type ArenaLoadout,
  type ArenaMindName,
  type Side,
} from '../../src/index.ts';
import { arenaContent as content, arenaSpeciesIds } from '../support/arena-content.ts';
import { movesByButton } from '../support/arena-fighters.ts';

const press = fc.option(fc.constantFrom(0 as const, 1 as const, 2 as const), { nil: null, freq: 3 });
const input = fc.record({ dir: fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }), dash: fc.boolean(), press });
const run = fc.record({ ticks: fc.integer({ min: 1, max: 300 }), input });
const species = fc.constantFrom(...arenaSpeciesIds);
const mind = fc.constantFrom<ArenaMindName>(...ARENA_MINDS);
const moveFor = (button: 0 | 1 | 2) => fc.option(fc.constantFrom(...movesByButton[button]!), { nil: null, freq: 5 });
/** A creature with the wild loadout, or any moves of the right kinds, unlocked or not. */
const anyCreature = fc.record({
  species,
  level: fc.integer({ min: 1, max: 50 }),
  loadout: fc.option(fc.tuple(moveFor(0), moveFor(1), moveFor(2)), { nil: null }),
  turtle: fc.boolean(),
  computer: fc.boolean(),
});
type Creature = { species: string; level: number; loadout: ArenaLoadout | null; turtle: boolean; computer: boolean };

/**
 * A mind on `side` against another mind, or against random inputs (held for runs of ticks), for as
 * long as the runs last.
 */
const fight = fc.record({
  seed: fc.integer(),
  side: fc.constantFrom<Side>(0, 1),
  mind,
  opponent: fc.option(mind, { nil: null }),
  creatures: fc.tuple(anyCreature, anyCreature),
  runs: fc.array(run, { minLength: 1, maxLength: 15 }),
});
type Fight = { seed: number; side: Side; mind: ArenaMindName; opponent: ArenaMindName | null; creatures: [Creature, Creature]; runs: { ticks: number; input: ArenaInput }[] };

const fighterOf = (creature: Creature, side: Side): ArenaFighter => ({
  id: `side-${side}`,
  species: creature.species,
  level: creature.level,
  loadout: creature.loadout ?? wildLoadout(creature.species, creature.level, content),
  turtle: creature.turtle,
  computer: creature.computer,
});

/**
 * Plays the fight and lists what went wrong: a press of a mind's that was refused, or a mind's
 * creature falling off without a knock that sent it tumbling past the lip. A tumble can run out a
 * few ticks before the fall, so it counts from the knock until the creature is back inside the lip.
 */
function problemsIn(setup: Fight): string[] {
  const problems: string[] = [];
  const minds: (ArenaMindName | null)[] = setup.side === 0 ? [setup.mind, setup.opponent] : [setup.opponent, setup.mind];
  const brains = minds.map((name) => (name === null ? null : createBrain(name, content.arena)));
  const rngs = ARENA_SIDES.map((side) => createRng(`mind-property:${side}:${setup.seed}`));
  const tumbled = [false, false];
  let state = arenaStart({ seed: setup.seed, fighters: [fighterOf(setup.creatures[0], 0), fighterOf(setup.creatures[1], 1)] }, content);
  for (const { ticks, input: random } of setup.runs) {
    for (let tick = 0; tick < ticks && !state.outcome; tick += 1) {
      const before = state;
      const inputs = ARENA_SIDES.map((side) => {
        const brain = brains[side];
        return brain ? wildInput(before, side, brain, rngs[side]!, content) : random;
      }) as unknown as ArenaInputs;
      const { state: after, events } = arenaStep(before, inputs, content);
      for (const side of ARENA_SIDES) {
        if (!brains[side]) continue;
        if (events.some((event) => event.kind === 'refused' && event.side === side)) problems.push(`tick ${before.tick}: side ${side}'s press ${inputs[side].press} refused`);
        const body = after.bodies[side];
        if (body.knockedTicks > 0) tumbled[side] = true;
        else if (!body.teetering && !body.out) tumbled[side] = false;
        if (!tumbled[side] && events.some((event) => event.kind === 'ringOut' && event.side === side)) problems.push(`tick ${before.tick}: side ${side} walked off`);
      }
      state = after;
    }
  }
  return problems;
}

describe('arena mind properties', () => {
  it('never sends a press that is refused, nor walks off the island on its own, in 5000 random fights', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        expect(problemsIn(setup as Fight)).toEqual([]);
      }),
      { numRuns: 5_000 },
    );
  }, 60_000);

  it('plays the same fight the same way from the same seed', () => {
    const setup = fc.record({ seed: fc.integer(), creatures: fc.tuple(anyCreature, anyCreature), minds: fc.tuple(mind, mind) });
    fc.assert(
      fc.property(setup, ({ seed, creatures, minds }) => {
        const fighters: [ArenaFighter, ArenaFighter] = [fighterOf(creatures[0], 0), fighterOf(creatures[1], 1)];
        expect(arenaHash(mindFight({ seed, fighters }, minds, content))).toBe(arenaHash(mindFight({ seed, fighters }, minds, content)));
      }),
      { numRuns: 20 },
    );
  });

  it('sends nothing for a creature that is out or a fight that is over', () => {
    const state = arenaStart({ seed: 1, fighters: [fighterOf({ species: 'glowbun', level: 20, loadout: null, turtle: false, computer: true }, 0), fighterOf({ species: 'puddlepip', level: 20, loadout: null, turtle: false, computer: false }, 1)] }, content);
    const out = { ...state, bodies: [{ ...state.bodies[0], out: true }, state.bodies[1]] as const };
    const over = { ...state, outcome: { winner: 1, how: 'ringOut', tick: 0 } as const };
    expect(wildInput(out, 0, createBrain('WILD', content.arena), createRng(1), content)).toEqual(ARENA_IDLE);
    expect(wildInput(over, 0, createBrain('WILD', content.arena), createRng(1), content)).toEqual(ARENA_IDLE);
  });
});
