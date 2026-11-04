import { z } from 'zod';
import { DirectionSchema } from './grid.ts';
import { stableHash, type Json } from './hash.ts';
import { mapFromRows, type WorldMap } from './map.ts';
import { createWalker, planWalk, stepWalker, withIntent, IDLE, type Walker } from './movement.ts';
import { createRng } from './rng.ts';

const Name = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/);
const Tile = z.number().int().min(0).max(255);

/**
 * Golden replays pin down rule behaviour: a seed plus a list of commands must always produce the
 * same hash. RNG commands draw numbers; movement commands lay out a map in rows of text (`#` is
 * blocked), place walkers, give them intents, and advance time, recording every walker after each tick.
 */
export const GoldenCommand = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('next') }),
  z.strictObject({ op: z.literal('int'), min: z.number().int(), max: z.number().int() }),
  z.strictObject({ op: z.literal('pick'), items: z.array(z.string()).min(1) }),
  z.strictObject({ op: z.literal('map'), rows: z.array(z.string().min(1).max(64)).min(1).max(64) }),
  z.strictObject({ op: z.literal('spawn'), walker: Name, x: Tile, y: Tile }),
  z.strictObject({ op: z.literal('walkTo'), walker: Name, x: Tile, y: Tile }),
  z.strictObject({ op: z.literal('hold'), walker: Name, direction: DirectionSchema }),
  z.strictObject({ op: z.literal('stop'), walker: Name }),
  z.strictObject({ op: z.literal('tick'), ms: z.number().int().min(0).max(10_000), stepMs: z.number().int().min(1).max(2_000) }),
]);
export type GoldenCommand = z.infer<typeof GoldenCommand>;

export const GoldenFile = z.strictObject({
  description: z.string().min(1),
  seed: z.union([z.number().int(), z.string()]),
  commands: z.array(GoldenCommand),
  expectedHash: z.string().regex(/^[0-9a-f]{14}$/),
});
export type GoldenFile = z.infer<typeof GoldenFile>;

export type Replay = { readonly outputs: readonly Json[]; readonly state: readonly number[] };

type Scene = { map: WorldMap | null; walkers: Map<string, Walker> };

function walkerJson(name: string, walker: Walker): Json {
  return [name, walker.x, walker.y, walker.facing, walker.moving, walker.elapsedMs];
}

function needMap(scene: Scene): WorldMap {
  if (!scene.map) throw new Error('a movement command came before the "map" command');
  return scene.map;
}

function needWalker(scene: Scene, name: string): Walker {
  const walker = scene.walkers.get(name);
  if (!walker) throw new Error(`no walker "${name}"; spawn it first`);
  return walker;
}

function move(scene: Scene, command: GoldenCommand & { op: 'map' | 'spawn' | 'walkTo' | 'hold' | 'stop' | 'tick' }): Json {
  switch (command.op) {
    case 'map':
      scene.map = mapFromRows('golden', command.rows);
      scene.walkers.clear();
      return command.rows.length;
    case 'spawn':
      scene.walkers.set(command.walker, createWalker(command));
      return walkerJson(command.walker, needWalker(scene, command.walker));
    case 'walkTo': {
      const walker = needWalker(scene, command.walker);
      const intent = planWalk(needMap(scene), walker, command);
      if (!intent) return 'refused';
      scene.walkers.set(command.walker, withIntent(walker, intent));
      return intent.kind === 'path' ? intent.steps.length : 0;
    }
    case 'hold':
      scene.walkers.set(command.walker, withIntent(needWalker(scene, command.walker), { kind: 'hold', direction: command.direction }));
      return 'hold';
    case 'stop':
      scene.walkers.set(command.walker, withIntent(needWalker(scene, command.walker), IDLE));
      return 'stop';
    case 'tick': {
      const map = needMap(scene);
      // Sorted, so the replay never depends on the order walkers were added.
      const names = [...scene.walkers.keys()].toSorted();
      return names.map((name) => {
        const next = stepWalker(map, needWalker(scene, name), command.ms, command.stepMs);
        scene.walkers.set(name, next);
        return walkerJson(name, next);
      });
    }
  }
}

export function replay(seed: number | string, commands: readonly GoldenCommand[]): Replay {
  const rng = createRng(seed);
  const scene: Scene = { map: null, walkers: new Map() };
  const outputs = commands.map((command): Json => {
    switch (command.op) {
      case 'next':
        return rng.next();
      case 'int':
        return rng.int(command.min, command.max);
      case 'pick':
        return rng.pick(command.items);
      default:
        return move(scene, command);
    }
  });
  return { outputs, state: rng.state() };
}

export function replayHash(seed: number | string, commands: readonly GoldenCommand[]): string {
  const { outputs, state } = replay(seed, commands);
  return stableHash({ outputs, state });
}
