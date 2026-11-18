import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ARENA_IDLE,
  DIRECTION_VECTORS,
  arenaStart,
  arenaStep,
  bodySpeed,
  createRng,
  isqrt,
  knockFor,
  oppositeDirection,
  stormRadius,
  walkCapOf,
  type ArenaEvent,
  type ArenaInput,
  type ArenaInputs,
  type ArenaState,
} from '../../src/index.ts';
import { arenaContent as content } from '../support/arena-content.ts';

const ARENA_SRC = fileURLToPath(new URL('../../src/arena/', import.meta.url));
const rules = content.arena;
const start = (species: readonly [string, string] = ['pinwhirl', 'glaciyak']) => arenaStart({ seed: 'arena-unit', species: [species[0], species[1]] }, content);
const walkTo = (dir: number): ArenaInput => ({ dir, dash: false });

/** Steps `ticks` times with the same inputs, collecting the events. */
function hold(state: ArenaState, inputs: ArenaInputs, ticks: number): { state: ArenaState; events: ArenaEvent[] } {
  const events: ArenaEvent[] = [];
  let now = state;
  for (let tick = 0; tick < ticks; tick += 1) {
    const step = arenaStep(now, inputs, content);
    now = step.state;
    events.push(...step.events);
  }
  return { state: now, events };
}

describe('arena whole-number maths', () => {
  it('takes exact integer square roots', () => {
    for (let n = 0; n < 5_000; n += 1) {
      const root = isqrt(n);
      expect(root * root).toBeLessThanOrEqual(n);
      expect((root + 1) * (root + 1)).toBeGreaterThan(n);
    }
    for (const n of [2 ** 31, 2 ** 40 + 12_345, 4_700_000_000_000, 2 ** 52 - 1]) {
      const root = isqrt(n);
      expect(BigInt(root) * BigInt(root)).toBeLessThanOrEqual(BigInt(n));
      expect(BigInt(root + 1) * BigInt(root + 1)).toBeGreaterThan(BigInt(n));
    }
    expect(() => isqrt(-1)).toThrow(RangeError);
  });

  it('has 16 unit vectors in 1/4096, each the opposite of the one 8 further round', () => {
    expect(DIRECTION_VECTORS).toHaveLength(16);
    DIRECTION_VECTORS.forEach(([x, y], index) => {
      const angle = (index * Math.PI) / 8;
      expect(Math.abs(x - Math.round(Math.cos(angle) * 4096))).toBe(0);
      expect(Math.abs(y - Math.round(Math.sin(angle) * 4096))).toBe(0);
      expect(Math.abs(isqrt(x * x + y * y) - 4096)).toBeLessThanOrEqual(1);
      const [ox, oy] = DIRECTION_VECTORS[oppositeDirection(index)]!;
      expect([ox + x, oy + y]).toEqual([0, 0]);
    });
  });

  it('knocks harder the more health is lost', () => {
    expect(knockFor(700, 1000, rules.island)).toBe(315);
    expect(knockFor(700, 0, rules.island)).toBe(1540);
    expect(knockFor(700, 500, rules.island)).toBe(927);
  });
});

describe('arena step', () => {
  it('walks up to the species walk cap and no faster', () => {
    const cap = 330 + (220 * content.species.get('pinwhirl')!.stats.speed) / 100;
    expect(walkCapOf(70, rules)).toBe(Math.trunc((cap * 256) / 60));
    const { state } = hold(start(), [walkTo(4), walkTo(12)], 60);
    expect(bodySpeed(state.bodies[0])).toBeLessThanOrEqual(cap);
    expect(bodySpeed(state.bodies[0])).toBeGreaterThanOrEqual(cap * 0.98);
  });

  it('plants its feet when the stick lets go', () => {
    const walking = hold(start(), [walkTo(4), ARENA_IDLE], 60).state;
    expect(bodySpeed(hold(walking, [ARENA_IDLE, ARENA_IDLE], 20).state.bodies[0])).toBe(0);
  });

  it('dashes at dash speed for the dash ticks, then waits for the cooldown', () => {
    const dash: ArenaInputs = [{ dir: 4, dash: true }, ARENA_IDLE];
    const first = arenaStep(start(), dash, content);
    expect(first.events).toEqual([{ kind: 'dashed', side: 0, dir: 4 }]);
    let state = first.state;
    for (let tick = 1; tick < rules.dash.ticks; tick += 1) {
      expect(bodySpeed(state.bodies[0])).toBeGreaterThanOrEqual(rules.dash.speed - 1);
      state = arenaStep(state, [ARENA_IDLE, ARENA_IDLE], content).state;
    }
    expect(bodySpeed(state.bodies[0])).toBeGreaterThanOrEqual(rules.dash.speed - 1);
    expect(bodySpeed(arenaStep(state, [ARENA_IDLE, ARENA_IDLE], content).state.bodies[0])).toBeLessThan(rules.dash.speed - 1);
    const waited = hold(first.state, dash, rules.dash.cooldownTicks - 1);
    expect(waited.events.filter((event) => event.kind === 'dashed')).toEqual([]);
    expect(arenaStep(waited.state, dash, content).events).toEqual([{ kind: 'dashed', side: 0, dir: 4 }]);
  });

  it('dashes the way it faces when the stick is still', () => {
    const turned = hold(start(), [walkTo(6), ARENA_IDLE], 1).state;
    expect(arenaStep(turned, [{ dir: null, dash: true }, ARENA_IDLE], content).events).toEqual([{ kind: 'dashed', side: 0, dir: 6 }]);
  });

  it('warns, shrinks over the shrink ticks, and says when a shrink is done', () => {
    const { firstTicks, warnTicks, shrinkTicks } = rules.storm;
    const before = hold(start(), [ARENA_IDLE, ARENA_IDLE], firstTicks - warnTicks - 1);
    expect(before.events).toEqual([]);
    const warned = arenaStep(before.state, [ARENA_IDLE, ARENA_IDLE], content);
    expect(warned.events).toEqual([{ kind: 'stormWarning', step: 1, radius: stormRadius(1, rules) }]);
    expect(warned.state.storm.phase).toBe('warning');
    const shrinking = hold(warned.state, [ARENA_IDLE, ARENA_IDLE], warnTicks + shrinkTicks / 2);
    expect(shrinking.state.storm.phase).toBe('shrinking');
    expect(shrinking.state.radius).toBeLessThan(stormRadius(0, rules));
    expect(shrinking.state.radius).toBeGreaterThan(stormRadius(1, rules));
    const done = hold(shrinking.state, [ARENA_IDLE, ARENA_IDLE], shrinkTicks / 2);
    expect(done.events).toEqual([{ kind: 'stormShrank', step: 1, radius: stormRadius(1, rules) }]);
    expect(done.state.storm).toEqual({ step: 1, phase: 'calm', nextShrink: firstTicks + rules.storm.everyTicks });
    expect(done.state.radius).toBe(stormRadius(1, rules));
  });

  it('takes 10% of the radius five times, then 5% down to a quarter', () => {
    const percents = Array.from({ length: 12 }, (_unused, step) => (stormRadius(step, rules) * 100) / (rules.island.radius * 256));
    expect(percents).toEqual([100, 90, 80, 70, 60, 50, 45, 40, 35, 30, 25, 25]);
  });

  it('holds a walker at the lip however long it pushes outwards', () => {
    const { state, events } = hold(start(), [walkTo(8), walkTo(0)], 900);
    expect(events.filter((event) => event.kind === 'teeter')).toEqual([
      { kind: 'teeter', side: 0 },
      { kind: 'teeter', side: 1 },
    ]);
    expect(state.outcome).toBeNull();
    expect(state.bodies.every((body) => body.teetering && !body.out)).toBe(true);
  });

  it('lets the storm push a standing body off, and two at once is a draw', () => {
    const { state, events } = hold(start(['baskit', 'baskit']), [ARENA_IDLE, ARENA_IDLE], 10_000);
    expect(events.filter((event) => event.kind === 'ringOut')).toEqual([
      { kind: 'ringOut', side: 0 },
      { kind: 'ringOut', side: 1 },
    ]);
    expect(state.outcome).toMatchObject({ winner: null, how: 'ringOut' });
  });

  it('steps a finished fight no further', () => {
    const ended = hold(start(['baskit', 'baskit']), [ARENA_IDLE, ARENA_IDLE], 10_000).state;
    expect(arenaStep(ended, [walkTo(0), walkTo(0)], content)).toEqual({ state: ended, events: [] });
  });

  it('refuses a species it does not know', () => {
    expect(() => start(['pinwhirl', 'nobody'])).toThrow(RangeError);
  });

  it('runs 10,000 random steps at under 0.05 ms a step', () => {
    const rng = createRng('arena-speed');
    const species = [...content.species.keys()].toSorted();
    const random = (): ArenaInput => ({ dir: rng.int(0, 16) === 16 ? null : rng.int(0, 15), dash: rng.int(0, 20) === 0 });
    const inputs = Array.from({ length: 10_000 }, (): ArenaInputs => [random(), random()]);
    const fresh = () => arenaStart({ seed: rng.int(0, 1_000_000), species: [rng.pick(species), rng.pick(species)] }, content);
    const runAll = () => {
      let state = fresh();
      for (const input of inputs) state = state.outcome ? fresh() : arenaStep(state, input, content).state;
    };
    runAll();
    const started = performance.now();
    runAll();
    expect((performance.now() - started) / inputs.length).toBeLessThan(0.05);
  });
});

describe('arena source', () => {
  it('uses whole-number maths only: no randomness, clock or floating-point trigonometry', () => {
    const files = readdirSync(ARENA_SRC).filter((name) => name.endsWith('.ts'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    const forbidden = /\b(?:Math\.random|Date\.now|performance|sin|cos|atan2|asin|hypot|sqrt)\b/g;
    const allowedMath = new Set(['trunc', 'floor', 'max', 'min']);
    const problems = files.flatMap((name) => {
      const source = readFileSync(join(ARENA_SRC, name), 'utf8');
      const named = [...source.matchAll(forbidden)].map((match) => match[0]);
      const maths = [...source.matchAll(/\bMath\.(\w+)/g)].map((match) => match[1]!).filter((method) => !allowedMath.has(method));
      return [...named, ...maths.map((method) => `Math.${method}`)].map((found) => `${name}: ${found}`);
    });
    expect(problems).toEqual([]);
  });
});
