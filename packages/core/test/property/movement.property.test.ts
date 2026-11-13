import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  DIRECTIONS,
  GRASS_STEP_COST,
  IDLE,
  createWalker,
  encounterZoneAt,
  findPath,
  isWalkable,
  mapFromRows,
  pathCost,
  planCommand,
  planWalk,
  reachableFrom,
  samePoint,
  stepWalker,
  withIntent,
  type Intent,
  type Point,
  type WalkCommand,
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

/** A random scene as above with about a third of the open tiles tall grass, each its own one-tile encounter area. */
const grassScene = scene.chain(({ map, from, to }) =>
  fc.array(fc.nat({ max: map.width * map.height - 1 }), { maxLength: Math.ceil((map.width * map.height) / 3) }).map((grass) => ({
    map: { ...map, encounterAreas: [...new Set(grass)].toSorted((a, b) => a - b).map((at) => ({ zone: 'meadow', x: at % map.width, y: Math.floor(at / map.width), width: 1, height: 1 })) },
    from,
    to,
  })),
);

const grassAt = (map: WorldMap, at: Point) => encounterZoneAt(map, at) !== null;

/** The cheapest cost of reaching `to`, by Dijkstra over every tile, with `stepCost` for the step onto each tile. */
function cheapest(map: WorldMap, from: Point, to: Point, stepCost: (at: Point) => number | null): number | null {
  const cost = new Map<string, number>([[`${from.x},${from.y}`, 0]]);
  const done = new Set<string>();
  for (;;) {
    const open = [...cost].filter(([key]) => !done.has(key)).toSorted((a, b) => a[1] - b[1]);
    const [key, g] = open[0] ?? [];
    if (key === undefined || g === undefined) return null;
    const [x, y] = key.split(',').map(Number) as [number, number];
    if (x === to.x && y === to.y) return g;
    done.add(key);
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
      const next = { x: x + dx, y: y + dy };
      const step = isWalkable(map, next) ? stepCost(next) : null;
      const nextKey = `${next.x},${next.y}`;
      if (step !== null && !done.has(nextKey) && g + step < (cost.get(nextKey) ?? Infinity)) cost.set(nextKey, g + step);
    }
  }
}

describe('path finding properties with tall grass', () => {
  it('finds the cheapest path, a step onto grass costing GRASS_STEP_COST, or the shortest when the target is grass', () => {
    fc.assert(
      fc.property(grassScene, ({ map, from, to }) => {
        const path = findPath(map, from, to);
        const chose = grassAt(map, to);
        const best = chose ? distance(map, from, to) : cheapest(map, from, to, (at) => (grassAt(map, at) ? GRASS_STEP_COST : 1));
        expect(path && (chose ? path.length : pathCost(map, path))).toBe(best);
      }),
      { numRuns: 300 },
    );
  });

  it('stays out of the grass whenever a way around is less than GRASS_STEP_COST - 1 steps longer than the shortest', () => {
    fc.assert(
      fc.property(grassScene, ({ map, from, to }) => {
        if (grassAt(map, to)) return;
        const shortest = distance(map, from, to);
        const around = cheapest(map, from, to, (at) => (grassAt(map, at) ? null : 1));
        if (shortest === null || around === null || around >= shortest + GRASS_STEP_COST - 1) return;
        expect(findPath(map, from, to)?.some((at) => grassAt(map, at))).toBe(false);
      }),
      { numRuns: 300 },
    );
  });

  it('refuses exactly the targets that cannot be reached, grass or not', () => {
    fc.assert(
      fc.property(grassScene, ({ map, from, to }) => {
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

const tile = fc.record({ x: fc.nat({ max: 13 }), y: fc.nat({ max: 13 }) });
const walkCommand = fc.oneof(
  tile.map((target): WalkCommand => ({ kind: 'to', target })),
  fc.constantFrom(...DIRECTIONS).map((direction): WalkCommand => ({ kind: 'hold', direction })),
  fc.constant<WalkCommand>({ kind: 'stop' }),
);
const plannedCommands = fc.array(fc.record({ command: walkCommand, from: fc.option(tile, { nil: undefined }), ms: fc.nat({ max: 600 }) }), { maxLength: 30 });

describe('commands planned from a tile the client names', () => {
  it('never move the walker onto a blocked tile or faster than it walks, whatever tile is named', () => {
    fc.assert(
      fc.property(scene, plannedCommands, ({ map, from: start }, script) => {
        script.reduce((walker, { command, from, ms }) => {
          const next = planCommand(map, walker, command, from);
          const after = stepWalker(map, next ? withIntent(walker, next) : walker, ms, STEP);
          expect(isWalkable(map, after)).toBe(true);
          expect(Math.abs(after.x - walker.x) + Math.abs(after.y - walker.y)).toBeLessThanOrEqual(Math.floor(ms / STEP) + 1);
          return after;
        }, createWalker(start));
      }),
      { numRuns: 300 },
    );
  });

  it('refuse exactly the walk targets that cannot be reached', () => {
    fc.assert(
      fc.property(scene, tile, ({ map, from, to }, named) => {
        const walker = createWalker(from);
        expect(planCommand(map, walker, { kind: 'to', target: to }, named) !== null).toBe(planWalk(map, walker, to) !== null);
      }),
      { numRuns: 300 },
    );
  });
});
