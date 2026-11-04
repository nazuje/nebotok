import { z } from 'zod';
import { stableHash, type Json } from './hash.ts';
import { createRng } from './rng.ts';

/**
 * Golden replays pin down rule behaviour: a seed plus a list of commands must always produce the
 * same hash. Phase 0 only has RNG commands; game commands join this union as rules arrive.
 */
export const GoldenCommand = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('next') }),
  z.strictObject({ op: z.literal('int'), min: z.number().int(), max: z.number().int() }),
  z.strictObject({ op: z.literal('pick'), items: z.array(z.string()).min(1) }),
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

export function replay(seed: number | string, commands: readonly GoldenCommand[]): Replay {
  const rng = createRng(seed);
  const outputs = commands.map((command): Json => {
    switch (command.op) {
      case 'next':
        return rng.next();
      case 'int':
        return rng.int(command.min, command.max);
      case 'pick':
        return rng.pick(command.items);
    }
  });
  return { outputs, state: rng.state() };
}

export function replayHash(seed: number | string, commands: readonly GoldenCommand[]): string {
  const { outputs, state } = replay(seed, commands);
  return stableHash({ outputs, state });
}
