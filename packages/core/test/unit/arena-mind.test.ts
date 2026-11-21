import { describe, expect, it } from 'vitest';
import {
  ARENA_BUTTONS,
  ARENA_KINDS,
  DIRECTION_VECTORS,
  arenaStart,
  buttonUnlocked,
  createBrain,
  createRng,
  directionOf,
  learnedBy,
  stormRadius,
  wildInput,
  wildLoadout,
  wildMindFor,
  type ArenaState,
  type Body,
} from '../../src/index.ts';
import { arenaContent as content, arenaSpeciesIds, goldenArenaContent } from '../support/arena-content.ts';
import { fighter, loadoutWith } from '../support/arena-fighters.ts';

const UNIT = 256;
const rules = content.arena;

describe('directionOf', () => {
  it('gives each direction its own index, at any length, and null for no vector', () => {
    DIRECTION_VECTORS.forEach(([x, y], index) => {
      expect(directionOf(x, y)).toBe(index);
      expect(directionOf(x * 7, y * 7)).toBe(index);
    });
    expect(directionOf(0, 0)).toBeNull();
  });
});

describe('wildMindFor', () => {
  it('is the gentler mind against a player with the turtle setting on', () => {
    expect(wildMindFor(true)).toBe('WILD_EASIER');
    expect(wildMindFor(false)).toBe('WILD');
  });
});

/** What is wrong with `wildLoadout`'s move for `button`, if anything. */
function loadoutProblem(species: string, level: number, button: (typeof ARENA_BUTTONS)[number]): string[] {
  const type = content.species.get(species)?.type;
  const id = wildLoadout(species, level, content)[button] ?? null;
  const ofKind = learnedBy({ species, level }, content).flatMap((move) => (content.moves.get(move)?.arena?.kind === ARENA_KINDS[button] ? [content.moves.get(move)!] : []));
  const where = `${species} level ${level} button ${button}`;
  if (!buttonUnlocked(button, level, content) || ofKind.length === 0) return id === null ? [] : [`${where}: ${id} on a button with nothing to fill it`];
  const chosen = ofKind.find((move) => move.id === id);
  if (!chosen) return [`${where}: ${id} is not a learned move of its kind`];
  const better = ofKind.filter((move) => Number(move.type === type) > Number(chosen.type === type) || (move.type === chosen.type && move.power > chosen.power));
  return better.map((move) => `${where}: ${move.id} beats ${id}`);
}

describe('wildLoadout', () => {
  it('fills each unlocked button with its strongest learned move of that kind, its own type first', () => {
    const levels = Array.from({ length: 50 }, (_, index) => index + 1);
    const problems = arenaSpeciesIds.flatMap((species) => levels.flatMap((level) => ARENA_BUTTONS.flatMap((button) => loadoutProblem(species, level, button))));
    expect(problems).toEqual([]);
  });

  it('gives a level 15 glowbun its sun moves', () => {
    expect(wildLoadout('glowbun', 15, goldenArenaContent)).toEqual(['heat-shimmer', 'sun-wallop', 'sun-call']);
    expect(wildLoadout('glowbun', 1, goldenArenaContent)).toEqual(['heat-shimmer', null, null]);
  });
});

const at = (body: Body, place: number): Body => ({ ...body, x: place * UNIT, y: 0, vx: 0, vy: 0 });
const warned = (state: ArenaState): ArenaState => ({ ...state, storm: { ...state.storm, phase: 'warning' } });

/** A fight at tick 60, when a new mind first thinks, with side 0 at `x` and side 1 at `otherX` (arena units, on the x axis). */
function standing(x: number, otherX: number, change: (state: ArenaState) => ArenaState = (state) => state): ArenaState {
  const start = arenaStart({ seed: 'arena-mind', fighters: [fighter('puddlepip', { level: 1, loadout: loadoutWith('drip-drop'), computer: true }), fighter('glowbun', { level: 1 })] }, content);
  return change({ ...start, tick: 60, bodies: [at(start.bodies[0], x), at(start.bodies[1], otherX)] });
}

/** Where side 0's mind chooses to walk, as the x of its direction. */
function walkX(state: ArenaState): number {
  const brain = createBrain('WILD', rules);
  wildInput(state, 0, brain, createRng('arena-mind'), content);
  expect(brain.walk).not.toBeNull();
  return DIRECTION_VECTORS[brain.walk!]![0];
}

describe('wildInput', () => {
  const range = rules.minds.ranges.bolt;
  const margin = rules.minds.edgeMargin;

  it('backs away from a creature too close, but not over its edge margin', () => {
    expect(walkX(standing(0, -range / 2))).toBeGreaterThan(0);
    const edge = rules.island.radius - 20;
    expect(walkX(standing(edge, edge - range / 2))).toBeLessThan(0);
  });

  it('keeps to its range, and treats the edge the storm warns of as the edge', () => {
    const shrunk = stormRadius(1, rules) / UNIT;
    const x = shrunk - margin + 40;
    expect(x + margin).toBeLessThan(rules.island.radius);
    expect(walkX(standing(x, x - range))).toBe(0);
    expect(walkX(standing(x, x - range, warned))).toBeLessThan(0);
  });

  it('presses nothing in its first second', () => {
    const brain = createBrain('BOT', rules);
    const rng = createRng('arena-mind');
    const early = standing(0, -range / 2, (state) => ({ ...state, tick: 0 }));
    for (let tick = 0; tick < 60; tick += 1) expect(wildInput({ ...early, tick }, 0, brain, rng, content).press).toBeNull();
  });
});
