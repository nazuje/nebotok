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
  type ArenaInput,
  type ArenaInputs,
  type ArenaState,
  type Body,
} from '../../src/index.ts';
import { arenaContent as content, arenaSpeciesIds } from '../support/arena-content.ts';

type Run = { readonly ticks: number; readonly sides: ArenaInputs };
type Fight = { readonly seed: number; readonly species: readonly [string, string]; readonly runs: readonly Run[] };

const input = fc.record({ dir: fc.option(fc.integer({ min: 0, max: 15 }), { nil: null }), dash: fc.boolean() });
const run = fc.record({ ticks: fc.integer({ min: 1, max: 240 }), sides: fc.tuple(input, input) });
const species = fc.constantFrom(...arenaSpeciesIds);
/** Up to 40 runs of up to 4 s each, so many fights reach the storm. */
const fight = fc.record({ seed: fc.integer(), species: fc.tuple(species, species), runs: fc.array(run, { maxLength: 40 }) });

const SIZE = content.arena.island.body * 256;
const TOP = Math.trunc((content.arena.island.topSpeed * 256) / 60);
const FLOOR = stormRadius(1_000, content.arena);
const speedOf = (body: Body) => isqrt(body.vx * body.vx + body.vy * body.vy);
const distanceOf = (body: Body) => isqrt(body.x * body.x + body.y * body.y);

function play(setup: Fight, visit: (before: ArenaState, after: ArenaState, events: readonly ArenaEvent[]) => void = () => {}): ArenaState {
  let state = arenaStart({ seed: setup.seed, species: [setup.species[0], setup.species[1]] }, content);
  for (const { ticks, sides } of setup.runs) {
    for (let tick = 0; tick < ticks && !state.outcome; tick += 1) {
      const { state: next, events } = arenaStep(state, sides, content);
      visit(state, next, events);
      state = next;
    }
  }
  return state;
}

const mirrorInput = (side: ArenaInput): ArenaInput => ({ dir: side.dir === null ? null : oppositeDirection(side.dir), dash: side.dash });
const mirrorBody = (body: Body): Body => ({ ...body, x: -body.x, y: -body.y, vx: -body.vx, vy: -body.vy, facing: oppositeDirection(body.facing), dashDir: oppositeDirection(body.dashDir) });

/** The same fight seen through the island's centre, with the sides swapped. */
function mirrorFight(setup: Fight): Fight {
  return {
    seed: setup.seed,
    species: [setup.species[1], setup.species[0]],
    runs: setup.runs.map(({ ticks, sides }) => ({ ticks, sides: [mirrorInput(sides[1]), mirrorInput(sides[0])] })),
  };
}

function mirrorState(state: ArenaState): ArenaState {
  const outcome = state.outcome && { ...state.outcome, winner: state.outcome.winner === null ? null : otherSide(state.outcome.winner) };
  return { ...state, bodies: [mirrorBody(state.bodies[1]), mirrorBody(state.bodies[0])], outcome };
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
        expect(arenaHash(play(mirrorFight(setup)))).toBe(arenaHash(mirrorState(play(setup))));
      }),
      { numRuns: 60 },
    );
  });

  it('draws a fight in which each side mirrors the other', () => {
    const mirrored = fc.record({ seed: fc.integer(), species, runs: fc.array(fc.record({ ticks: fc.integer({ min: 1, max: 600 }), side: input }), { maxLength: 30 }) });
    fc.assert(
      fc.property(mirrored, ({ seed, species: both, runs }) => {
        const state = play({ seed, species: [both, both], runs: runs.map(({ ticks, side }) => ({ ticks, sides: [side, mirrorInput(side)] })) });
        expect(arenaHash(state)).toBe(arenaHash(mirrorState(state)));
        expect(state.outcome?.winner ?? null).toBeNull();
      }),
      { numRuns: 60 },
    );
  });
});
