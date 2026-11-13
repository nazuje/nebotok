import { DIRECTIONS, samePoint, stepFrom, type Point } from './grid.ts';
import { encounterZoneAt, isWalkable, type WorldMap } from './map.ts';

/** How many tiles A* may expand before giving up, so a far or impossible target costs a bounded time. */
export const PATH_SEARCH_LIMIT = 4_096;

/**
 * What a step onto tall grass costs, against 1 for any other tile, so a walk goes around the grass
 * (where wild creatures appear) unless the way around is about GRASS_STEP_COST - 1 steps longer for
 * each grass tile the way through crosses.
 */
export const GRASS_STEP_COST = 5;

const inGrass = (map: WorldMap, at: Point) => encounterZoneAt(map, at) !== null;

/** What walking `steps` costs by GRASS_STEP_COST: one for each step, more for each step onto tall grass. */
export function pathCost(map: WorldMap, steps: readonly Point[]): number {
  return steps.reduce((sum, at) => sum + (inGrass(map, at) ? GRASS_STEP_COST : 1), 0);
}

type Node = { readonly index: number; readonly g: number; readonly f: number; readonly h: number; readonly order: number };

/** Lower f first, then lower h (closer to the goal), then the earlier-found node: the same path every time. */
function before(a: Node, b: Node): boolean {
  if (a.f !== b.f) return a.f < b.f;
  if (a.h !== b.h) return a.h < b.h;
  return a.order < b.order;
}

/** A small binary min-heap ordered by `before`. */
function createHeap() {
  const items: Node[] = [];
  const swap = (a: number, b: number) => {
    const held = items[a] as Node;
    items[a] = items[b] as Node;
    items[b] = held;
  };
  return {
    get size() {
      return items.length;
    },
    push(node: Node) {
      items.push(node);
      let at = items.length - 1;
      while (at > 0) {
        const parent = (at - 1) >> 1;
        if (!before(items[at] as Node, items[parent] as Node)) break;
        swap(at, parent);
        at = parent;
      }
    },
    pop(): Node | undefined {
      const top = items[0];
      const last = items.pop();
      if (items.length > 0 && last) {
        items[0] = last;
        let at = 0;
        for (;;) {
          const left = at * 2 + 1;
          const right = left + 1;
          let best = at;
          if (left < items.length && before(items[left] as Node, items[best] as Node)) best = left;
          if (right < items.length && before(items[right] as Node, items[best] as Node)) best = right;
          if (best === at) break;
          swap(at, best);
          at = best;
        }
      }
      return top;
    },
  };
}

/**
 * The cheapest 4-directional path from `from` to `to`, as the tiles to step on in order (without
 * `from`). Each step costs 1, or GRASS_STEP_COST onto tall grass; when `to` is itself tall grass
 * the player chose the grass, so every step costs 1 and the path is the shortest. Without tall
 * grass on the way it is the shortest path. An empty list means already there; null means the
 * target is blocked, unreachable, or further than the search limit allows.
 */
export function findPath(map: WorldMap, from: Point, to: Point, limit: number = PATH_SEARCH_LIMIT): Point[] | null {
  if (!isWalkable(map, from) || !isWalkable(map, to)) return null;
  if (samePoint(from, to)) return [];
  const { width } = map;
  const indexOf = (at: Point) => at.y * width + at.x;
  const pointOf = (index: number): Point => ({ x: index % width, y: Math.floor(index / width) });
  const distance = (at: Point) => Math.abs(at.x - to.x) + Math.abs(at.y - to.y);
  const grassCost = inGrass(map, to) ? 1 : GRASS_STEP_COST;

  const best = new Map<number, number>([[indexOf(from), 0]]);
  const cameFrom = new Map<number, number>();
  const closed = new Set<number>();
  const open = createHeap();
  let order = 0;
  open.push({ index: indexOf(from), g: 0, h: distance(from), f: distance(from), order: order++ });
  const goal = indexOf(to);

  while (open.size > 0 && closed.size < limit) {
    const node = open.pop() as Node;
    if (closed.has(node.index)) continue;
    if (node.index === goal) {
      const steps: Point[] = [];
      for (let at: number | undefined = goal; at !== undefined && at !== indexOf(from); at = cameFrom.get(at)) steps.push(pointOf(at));
      return steps.toReversed();
    }
    closed.add(node.index);
    const here = pointOf(node.index);
    for (const direction of DIRECTIONS) {
      const next = stepFrom(here, direction);
      if (!isWalkable(map, next)) continue;
      const index = indexOf(next);
      const g = node.g + (inGrass(map, next) ? grassCost : 1);
      if (closed.has(index) || g >= (best.get(index) ?? Infinity)) continue;
      best.set(index, g);
      cameFrom.set(index, node.index);
      const h = distance(next);
      open.push({ index, g, h, f: g + h, order: order++ });
    }
  }
  return null;
}
