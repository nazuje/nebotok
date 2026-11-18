import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  arenaRewards,
  befriendedFromFight,
  duelRewards,
  fightStart,
  fightStep,
  maxHpAt,
  newCreature,
  teamAfterFight,
  type ArenaFight,
  type ArenaFighter,
  type ArenaInputs,
  type CreatureInstance,
  type FightContent,
  type FightEvent,
  type RoundsFightSetup,
  type WildFight,
  type WildFightSetup,
} from '../../src/index.ts';
import { arenaSpeciesIds, fightContent } from '../support/arena-content.ts';
import { movesByButton } from '../support/arena-fighters.ts';
import { battleContent } from '../support/battle-content.ts';

/** A short time limit, so a fast-check run plays many whole fights. */
const LIMIT = 600;
const content: FightContent = { ...fightContent, arena: { ...fightContent.arena, island: { ...fightContent.arena.island, limitTicks: LIMIT } } };

type Run = { readonly ticks: number; readonly sides: ArenaInputs };

const press = fc.option(fc.constantFrom(0 as const, 1 as const, 2 as const), { nil: null, freq: 3 });
const rare = fc.boolean().chain((on) => (on ? fc.boolean() : fc.constant(false)));
const input = fc.record({
  dir: fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }),
  dash: fc.boolean(),
  press,
  treat: rare,
  swap: rare,
  leave: fc.integer({ min: 0, max: 40 }).map((roll) => roll === 0),
});
const run = fc.record({ ticks: fc.integer({ min: 1, max: 120 }), sides: fc.tuple(input, input) });
const runs = fc.array(run, { maxLength: 40 });
const species = fc.constantFrom(...arenaSpeciesIds);
const moveFor = (button: 0 | 1 | 2) => fc.option(fc.constantFrom(...movesByButton[button]!), { nil: null, freq: 5 });
const fighterOf = (id: string, computer: boolean) =>
  fc.record({
    id: fc.constant(id),
    species,
    level: fc.integer({ min: 1, max: 50 }),
    loadout: fc.tuple(moveFor(0), moveFor(1), moveFor(2)),
    turtle: fc.boolean(),
    computer: fc.constant(computer),
  });
const treatIds = [...content.items.values()].filter((item) => item.kind === 'treat').map((item) => item.id);
const bag = fc.uniqueArray(fc.record({ item: fc.constantFrom(...treatIds), count: fc.integer({ min: 0, max: 3 }) }), { selector: (stack) => stack.item, maxLength: 4 });

const mostHealth = (creature: { readonly species: string; readonly level: number }) => maxHpAt(battleContent.species.get(creature.species)!, creature.level);
const wildSetup: fc.Arbitrary<WildFightSetup> = fc
  .record({
    seed: fc.integer(),
    team: fc.array(fc.tuple(fighterOf('a', false), fc.integer({ min: 1, max: 200 })), { minLength: 1, maxLength: 6 }),
    wild: fighterOf('b1', true),
    treats: bag,
  })
  .map(({ seed, team, wild, treats }) => ({
    mode: 'wild' as const,
    seed,
    // A saved creature never has more than its most health.
    team: team.map(([fighter, hp], place) => ({ place, hp: Math.min(hp, mostHealth(fighter)), fighter: { ...fighter, id: `a${place + 1}` } })),
    wild,
    treats,
  }));

const picksOf = (side: readonly ArenaFighter[], name: string) => side.map((fighter, place) => ({ place, fighter: { ...fighter, id: `${name}${place}` } }));
const roundsSetup: fc.Arbitrary<RoundsFightSetup> = fc
  .record({
    seed: fc.integer(),
    left: fc.array(fighterOf('l', false), { minLength: 1, maxLength: 3 }),
    right: fc.array(fighterOf('r', false), { minLength: 1, maxLength: 3 }),
  })
  .map(({ seed, left, right }) => ({ mode: 'rounds' as const, seed, picks: [picksOf(left, 'l'), picksOf(right, 'r')] }));

function play(fight: ArenaFight, inputs: readonly Run[]): { readonly fight: ArenaFight; readonly events: readonly FightEvent[] } {
  let now = fight;
  const events: FightEvent[] = [];
  for (const { ticks, sides } of inputs) {
    for (let tick = 0; tick < ticks && !now.outcome; tick += 1) {
      const step = fightStep(now, sides, content);
      now = step.fight;
      events.push(...step.events);
    }
  }
  // Then nobody touches anything until it ends.
  const idle: ArenaInputs = [
    { dir: null, dash: false, press: null },
    { dir: null, dash: false, press: null },
  ];
  while (!now.outcome) {
    const step = fightStep(now, idle, content);
    now = step.fight;
    events.push(...step.events);
  }
  return { fight: now, events };
}

/**
 * What is wrong with the saved team after a wild fight: a creature that stayed off the island
 * changed, a rung-out one fainted, a knocked-out one kept health, or health over the most.
 */
function savedHealthProblems(before: readonly CreatureInstance[], after: readonly CreatureInstance[], fight: WildFight): string[] {
  return fight.team.flatMap((creature, place) => {
    const saved = after[place]!;
    const problems = [
      !creature.fought && saved !== before[place] && `${place} changed without fighting`,
      creature.fought && creature.out && saved.hp < 1 && `${place} fainted from a ring-out`,
      creature.fought && !creature.out && creature.health === 0 && saved.hp !== 0 && `${place} kept health after being knocked out`,
      saved.hp > mostHealth(saved) && `${place} has more than its most health`,
    ];
    return problems.filter((problem) => problem !== false);
  });
}

/** The saved team a wild setup came from, at the health it started with. */
function teamOf(setup: WildFightSetup): CreatureInstance[] {
  return setup.team.map(({ hp, fighter }) => ({ ...newCreature(fighter.species, fighter.level, battleContent), hp }));
}

describe('wild fight properties', () => {
  it('ends by the time limit, saves health only for the creatures that fought, and gives experience only to them', () => {
    fc.assert(
      fc.property(wildSetup, runs, (setup, inputs) => {
        const { fight } = play(fightStart(setup, content), inputs);
        if (fight.mode !== 'wild' || !fight.outcome) throw new Error('expected an ended wild fight');
        expect(fight.outcome.tick).toBeLessThanOrEqual(LIMIT);
        const before = teamOf(setup);
        const after = teamAfterFight(before, fight, content);
        expect(savedHealthProblems(before, after, fight)).toEqual([]);
        const rewarded = arenaRewards(after, fight, battleContent).rewards.map(({ index }) => index);
        const fought = new Set(fight.team.flatMap((creature, place) => (creature.fought ? [place] : [])));
        expect(rewarded.filter((index) => !fought.has(index))).toEqual([]);
        expect(['lost', 'ran'].includes(fight.outcome.result) && rewarded.length > 0).toBe(false);
      }),
      { numRuns: 60 },
    );
  });

  it('befriends only on a befriended ending, as the wild species and level', () => {
    fc.assert(
      fc.property(wildSetup, runs, (setup, inputs) => {
        const { fight, events } = play(fightStart(setup, content), inputs);
        if (fight.mode !== 'wild') throw new Error('expected a wild fight');
        const friend = befriendedFromFight(fight, battleContent);
        expect(friend !== null).toBe(fight.outcome?.result === 'befriended');
        expect(friend && { species: friend.species, level: friend.level }).toEqual(friend && { species: setup.wild.species, level: setup.wild.level });
        expect(events.filter((event) => event.kind === 'treatThrown').length).toBeLessThanOrEqual(setup.treats.reduce((sum, stack) => sum + stack.count, 0) + events.filter((event) => event.kind === 'treatPickedUp').length);
      }),
      { numRuns: 60 },
    );
  });
});

describe('best of 3 properties', () => {
  it('ends within three rounds, each replayed at most once, with a score that matches the result, and experience only for creatures that fought', () => {
    fc.assert(
      fc.property(roundsSetup, runs, (setup, inputs) => {
        const { fight } = play(fightStart(setup, content), inputs);
        if (fight.mode !== 'rounds' || !fight.outcome) throw new Error('expected an ended best of 3');
        // Three rounds, each played at most twice.
        expect(fight.outcome.tick).toBeLessThanOrEqual(LIMIT * 6);
        for (const round of [0, 1, 2]) expect(fight.rounds.filter((entry) => entry.round === round && entry.replayed).length).toBeLessThanOrEqual(1);
        expect(fight.rounds.filter((round) => !round.replayed).length).toBeLessThanOrEqual(3);
        const [left, right] = fight.score;
        const result = left === right ? 'draw' : left > right ? 'won' : 'lost';
        expect(fight.outcome.result).toBe(result);
        for (const side of [0, 1] as const) {
          const team = setup.picks[side].map(({ fighter }) => newCreature(fighter.species, fighter.level, battleContent));
          const rewarded = duelRewards(team, fight, side, battleContent).rewards.map(({ index }) => index);
          expect(rewarded.filter((index) => !fight.picks[side][index]?.fought)).toEqual([]);
        }
      }),
      { numRuns: 60 },
    );
  });
});
