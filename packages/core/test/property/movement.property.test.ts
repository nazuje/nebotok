import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  IDLE,
  createWalker,
  findPath,
  isWalkable,
  mapFromRows,
  planWalk,
  reachableFrom,
  samePoint,
  stepWalker,
  withIntent,
  type Intent,
  type Point,
  type Walker,
  type WorldMap,
} from '../../src/index.ts';

const STEP = 200;

/** A random map up to 12 by 12, about a quarter blocked, with two random tiles on it. */
const scene = fc
  .record({ width: fc.integer({ min: 1, max: 12 }), height: fc.integer({ min: 1, max: 12 }) })
  .chain(({ width, height }) =>
    fc.record({
      blocked: fc.array(fc.nat({ max: width * height - 1 }), { maxLength: Math.ceil((width * height) / 3) }),
      from: fc.record({ x: fc.nat({ max: width - 1 }), y: fc.nat({ max: height - 1 }) }),
      to: fc.record({ x: fc.nat({ max: width - 1 }), y: fc.nat({ max: height - 1 }) }),
    }).map(({ blocked, from, to }) => {
      const cells = Array.from({ length: height }, (_row, y) => Array.from({ length: width }, (_cell, x) => (blocked.includes(y * width + x) ? '#' : '.')));
      // The start is always open, so there is somewhere to stand.
      cells[from.y]![from.x] = '.';
      return { map: mapFromRows('random', cells.map((row) => row.join(''))), from, to };
    }),
  );

/** Shortest distance by plain breadth-first search, to check A* against. */
function distance(map: WorldMap, from: Point, to: Point): number | null {
  const seen = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
  const queue: Point[] = [from];
  for (let at = 0; at < queue.length; at += 1) {
    const here = queue[at]!;
    const g = seen.get(`${here.x},${here.y}`)!;
    if (here.x === to.x && here.y === to.y) return g;
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const next = { x: here.x + dx, y: here.y + dy };
      if (isWalkable(map, next) && !seen.has(`${next.x},${next.y}`)) {
        seen.set(`${next.x},${next.y}`, g + 1);
        queue.push(next);
      }
    }
  }
  return null;
}

const intent = fc.oneof(
  fc.constant<Intent>(IDLE),
  fc.constantFrom(...DIRECTIONS).map((direction): Intent => ({ kind: 'hold', direction })),
  fc.record({ x: fc.nat({ max: 11 }), y: fc.nat({ max: 11 }) }).map((target) => ({ kind: 'walkTo' as const, target })),
);
const commands = fc.array(fc.record({ intent, ms: fc.nat({ max: 1_000 }) }), { maxLength: 30 });

type Command = { intent: Intent | { kind: 'walkTo'; target: Point }; ms: number };

function run(map: WorldMap, from: Point, script: readonly Command[], visit: (before: Walker, after: Walker, ms: number) => void = () => {}): Walker {
  return script.reduce((walker, { intent: next, ms }) => {
    const planned = next.kind === 'walkTo' ? planWalk(map, walker, next.target) : next;
    const after = stepWalker(map, planned ? withIntent(walker, planned) : walker, ms, STEP);
    visit(walker, after, ms);
    return after;
  }, createWalker(from));
}

describe('path finding properties', () => {
  it('finds a shortest path of single steps over walkable tiles whenever the target is reachable', () => {
    fc.assert(
      fc.property(scene, ({ map, from, to }) => {
        const path = findPath(map, from, to);
        expect(path?.length ?? null).toBe(distance(map, from, to));
        let here = from;
        for (const step of path ?? []) {
          expect(Math.abs(step.x - here.x) + Math.abs(step.y - here.y)).toBe(1);
          expect(isWalkable(map, step)).toBe(true);
          here = step;
        }
        expect(path === null || samePoint(here, to)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it('refuses exactly the targets that cannot be reached', () => {
    fc.assert(
      fc.property(scene, ({ map, from, to }) => {
        const reachable = reachableFrom(map, from)[to.y * map.width + to.x] === true;
        expect(findPath(map, from, to) !== null).toBe(reachable);
      }),
      { numRuns: 300 },
    );
  });
});

describe('movement properties', () => {
  it('never stands on a blocked tile and never outruns its walk speed', () => {
    fc.assert(
      fc.property(scene, commands, ({ map, from }, script) => {
        run(map, from, script, (before, after, ms) => {
          expect(isWalkable(map, after)).toBe(true);
          // A step claims its tile when it starts, so ms of walking reaches at most one tile further.
          expect(Math.abs(after.x - before.x) + Math.abs(after.y - before.y)).toBeLessThanOrEqual(Math.floor(ms / STEP) + 1);
        });
      }),
      { numRuns: 200 },
    );
  });

  it('gives the same result every time', () => {
    fc.assert(
      fc.property(scene, commands, ({ map, from }, script) => {
        expect(run(map, from, script)).toEqual(run(map, from, script));
      }),
      { numRuns: 100 },
    );
  });

  it('does not care how time is split into ticks', () => {
    fc.assert(
      fc.property(scene, fc.constantFrom(...DIRECTIONS), fc.array(fc.nat({ max: 400 }), { minLength: 1, maxLength: 20 }), ({ map, from }, direction, ticks) => {
        const start = withIntent(createWalker(from), { kind: 'hold', direction });
        const split = ticks.reduce((walker, ms) => stepWalker(map, walker, ms, STEP), start);
        const whole = stepWalker(map, start, ticks.reduce((sum, ms) => sum + ms, 0), STEP);
        expect(split).toEqual(whole);
      }),
      { numRuns: 200 },
    );
  });

  it('reaches any reachable target it is sent to', () => {
    fc.assert(
      fc.property(scene, ({ map, from, to }) => {
        const walker = createWalker(from);
        const planned = planWalk(map, walker, to);
        if (planned === null) return;
        const steps = planned.kind === 'path' ? planned.steps.length : 0;
        const done = stepWalker(map, withIntent(walker, planned), (steps + 1) * STEP, STEP);
        expect({ x: done.x, y: done.y, moving: done.moving }).toEqual({ ...to, moving: false });
      }),
      { numRuns: 300 },
    );
  });
});
