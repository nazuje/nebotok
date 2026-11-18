import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ARENA_SIDES,
  arenaHash,
  arenaStart,
  arenaStep,
  isqrt,
  oppositeDirection,
  otherSide,
  stormRadius,
  type ArenaEvent,
  type ArenaFighter,
  type ArenaInput,
  type ArenaInputs,
  type ArenaState,
  type Body,
  type Side,
  type Thing,
} from '../../src/index.ts';
import { arenaContent as content, arenaSpeciesIds } from '../support/arena-content.ts';
import { movesByButton } from '../support/arena-fighters.ts';

type Run = { readonly ticks: number; readonly sides: ArenaInputs };
type Fight = { readonly seed: number; readonly fighters: readonly [ArenaFighter, ArenaFighter]; readonly runs: readonly Run[] };

const press = fc.option(fc.constantFrom(0 as const, 1 as const, 2 as const), { nil: null, freq: 3 });
const input = fc.record({ dir: fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }), dash: fc.boolean(), press });
const run = fc.record({ ticks: fc.integer({ min: 1, max: 240 }), sides: fc.tuple(input, input) });
const species = fc.constantFrom(...arenaSpeciesIds);
const moveFor = (button: 0 | 1 | 2) => fc.option(fc.constantFrom(...movesByButton[button]!), { nil: null, freq: 5 });
const fighterOf = (id: string) =>
  fc.record({
    id: fc.constant(id),
    species,
    level: fc.integer({ min: 1, max: 50 }),
    loadout: fc.tuple(moveFor(0), moveFor(1), moveFor(2)),
    turtle: fc.boolean(),
    computer: fc.boolean(),
  });
/** Up to 40 runs of up to 4 s each, so many fights reach the storm. */
const fight = fc.record({ seed: fc.integer(), fighters: fc.tuple(fighterOf('left'), fighterOf('right')), runs: fc.array(run, { maxLength: 40 }) });

const SIZE = content.arena.island.body * 256;
const TOP = Math.trunc((content.arena.island.topSpeed * 256) / 60);
const FLOOR = stormRadius(1_000, content.arena);
const speedOf = (body: Body) => isqrt(body.vx * body.vx + body.vy * body.vy);
const distanceOf = (body: Body) => isqrt(body.x * body.x + body.y * body.y);

function play(setup: Fight, visit: (before: ArenaState, after: ArenaState, events: readonly ArenaEvent[], inputs: ArenaInputs) => void = () => {}): ArenaState {
  let state = arenaStart({ seed: setup.seed, fighters: [setup.fighters[0], setup.fighters[1]] }, content);
  for (const { ticks, sides } of setup.runs) {
    for (let tick = 0; tick < ticks && !state.outcome; tick += 1) {
      const { state: next, events } = arenaStep(state, sides, content);
      visit(state, next, events, sides);
      state = next;
    }
  }
  return state;
}

const mirrorInput = (side: ArenaInput): ArenaInput => ({ ...side, dir: side.dir === null ? null : oppositeDirection(side.dir) });
const mirrorBody = (body: Body): Body => ({
  ...body,
  x: -body.x,
  y: -body.y,
  vx: -body.vx,
  vy: -body.vy,
  facing: oppositeDirection(body.facing),
  dashDir: oppositeDirection(body.dashDir),
  windup: body.windup && { ...body.windup, x: -body.windup.x, y: -body.windup.y },
  lunge: body.lunge && { ...body.lunge, vx: -body.lunge.vx, vy: -body.lunge.vy },
});
const mirrorThing = (thing: Thing): Thing => ({ ...thing, side: otherSide(thing.side), x: -thing.x, y: -thing.y, vx: -thing.vx, vy: -thing.vy, dx: -thing.dx, dy: -thing.dy });

/** The same fight seen through the island's centre, with the sides swapped. */
function mirrorFight(setup: Fight): Fight {
  return {
    seed: setup.seed,
    fighters: [setup.fighters[1], setup.fighters[0]],
    runs: setup.runs.map(({ ticks, sides }) => ({ ticks, sides: [mirrorInput(sides[1]), mirrorInput(sides[0])] })),
  };
}

function mirrorState(state: ArenaState): ArenaState {
  const outcome = state.outcome && { ...state.outcome, winner: state.outcome.winner === null ? null : otherSide(state.outcome.winner) };
  return { ...state, bodies: [mirrorBody(state.bodies[1]), mirrorBody(state.bodies[0])], things: state.things.map(mirrorThing), outcome };
}

/**
 * The state's hash with its things in a fixed order and without their ids. Both sides cast in the
 * same step in side order, so a mirrored fight numbers and lists the same things the other way.
 */
function unorderedHash(state: ArenaState): string {
  const things = state.things.map(({ id: _id, ...thing }) => JSON.stringify(thing)).toSorted();
  return `${arenaHash({ ...state, things: [] })} ${things.join(' ')}`;
}

/** The inputs with `side` never pressing a button. */
function quiet(side: Side, sides: ArenaInputs): ArenaInputs {
  const still: ArenaInput = { ...sides[side], press: null };
  return side === 0 ? [still, sides[1]] : [sides[0], still];
}

function damageBySide(setup: Fight): [number, number] {
  const totals: [number, number] = [0, 0];
  play(setup, (_before, _after, events) => {
    for (const event of events) if (event.kind === 'hit') totals[event.by] += event.damage;
  });
  return totals;
}

describe('arena bodies properties', () => {
  it('replays the same fight to the same hash', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        expect(arenaHash(play(setup))).toBe(arenaHash(play(setup)));
      }),
      { numRuns: 30 },
    );
  });

  it('never throws, never passes top speed, and a body is out exactly when it is past the edge', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        play(setup, (before, after, events) => {
          for (const side of ARENA_SIDES) {
            const body = after.bodies[side];
            expect(speedOf(body)).toBeLessThanOrEqual(TOP);
            if (before.bodies[side].out) continue;
            expect(body.out).toBe(distanceOf(body) > after.radius + SIZE);
            expect(events.some((event) => event.kind === 'ringOut' && event.side === side)).toBe(body.out);
          }
        });
      }),
      { numRuns: 60 },
    );
  });

  it('only ever shrinks the island, never below the storm floor', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        play(setup, (before, after) => {
          expect(after.radius).toBeLessThanOrEqual(before.radius);
          expect(after.radius).toBeGreaterThanOrEqual(FLOOR);
        });
      }),
      { numRuns: 60 },
    );
    for (let step = 0; step < 100; step += 1) {
      expect(stormRadius(step + 1, content.arena)).toBeLessThanOrEqual(stormRadius(step, content.arena));
      expect(stormRadius(step, content.arena)).toBeGreaterThanOrEqual(FLOOR);
    }
  });

  it('ends a mirrored fight mirrored', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        expect(unorderedHash(play(mirrorFight(setup)))).toBe(unorderedHash(mirrorState(play(setup))));
      }),
      { numRuns: 60 },
    );
  });

  it('deals mirrored damage in a mirrored fight', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        const [first, second] = damageBySide(setup);
        expect(damageBySide(mirrorFight(setup))).toEqual([second, first]);
      }),
      { numRuns: 40 },
    );
  });

  it('draws a fight in which each side mirrors the other', () => {
    const mirrored = fc.record({
      seed: fc.integer(),
      fighter: fighterOf('both'),
      runs: fc.array(fc.record({ ticks: fc.integer({ min: 1, max: 600 }), side: input }), { maxLength: 30 }),
    });
    fc.assert(
      fc.property(mirrored, ({ seed, fighter, runs }) => {
        const state = play({ seed, fighters: [fighter, fighter], runs: runs.map(({ ticks, side }) => ({ ticks, sides: [side, mirrorInput(side)] })) });
        expect(unorderedHash(state)).toBe(unorderedHash(mirrorState(state)));
        expect(state.outcome?.winner ?? null).toBeNull();
      }),
      { numRuns: 60 },
    );
  });

  it('keeps health between 0 and the most', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        play(setup, (_before, after) => {
          for (const body of after.bodies) {
            expect(body.health).toBeGreaterThanOrEqual(0);
            expect(body.health).toBeLessThanOrEqual(body.maxHealth);
          }
        });
      }),
      { numRuns: 60 },
    );
  });

  it('never casts from a locked or cooling button', () => {
    fc.assert(
      fc.property(fight, (setup) => {
        play(setup, (before, _after, events, inputs) => {
          for (const event of events) {
            if (event.kind !== 'cast' && event.kind !== 'windup') continue;
            const body = before.bodies[event.side];
            expect(body.level).toBeGreaterThanOrEqual(content.arena.buttons[event.button]);
            const fromWindup = event.kind === 'cast' && body.windup?.button === event.button && body.windup.ticks <= 1;
            if (fromWindup) continue;
            expect(inputs[event.side].press).toBe(event.button);
            // Timers tick down at the start of the step, so a cooldown of 1 is ready.
            expect(body.cooldowns[event.button]).toBeLessThanOrEqual(1);
          }
        });
      }),
      { numRuns: 60 },
    );
  });

  it('lets a creature that never presses deal no damage', () => {
    fc.assert(
      fc.property(fight, fc.constantFrom<Side>(0, 1), (setup, side) => {
        const runs = setup.runs.map(({ ticks, sides }) => ({ ticks, sides: quiet(side, sides) }));
        play({ ...setup, runs }, (_before, _after, events) => {
          expect(events.filter((event) => event.kind === 'hit' && event.by === side && event.damage > 0)).toEqual([]);
        });
      }),
      { numRuns: 60 },
    );
  });
});
