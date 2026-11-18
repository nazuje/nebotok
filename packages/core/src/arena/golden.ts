import { z } from 'zod';
import { ArenaInput, ArenaSetup, arenaHash, arenaStart, type ArenaEvent, type ArenaState } from './state.ts';
import type { ArenaContent } from './rules.ts';
import { arenaStep } from './step.ts';

/** `sides` holds for `ticks` ticks in a row: the inputs of every tick, run-length encoded. */
export const ArenaInputRun = z.strictObject({
  ticks: z.number().int().min(1).max(20_000),
  sides: z.tuple([ArenaInput, ArenaInput]),
});
export type ArenaInputRun = z.infer<typeof ArenaInputRun>;

/**
 * Arena goldens live in `fixtures/golden/arena/` and replay against the frozen content in
 * `fixtures/golden/arena/content/`. The hash is `arenaHash` of the state once every input has
 * been played or the fight has ended.
 */
export const ArenaGoldenFile = z.strictObject({
  description: z.string().min(1),
  setup: ArenaSetup,
  inputs: z.array(ArenaInputRun).min(1).max(1_000),
  expectedHash: z.string().regex(/^[0-9a-f]{14}$/),
});
export type ArenaGoldenFile = z.infer<typeof ArenaGoldenFile>;

export type ArenaReplay = { readonly state: ArenaState; readonly events: readonly ArenaEvent[] };

export function arenaReplay(golden: Pick<ArenaGoldenFile, 'setup' | 'inputs'>, content: ArenaContent): ArenaReplay {
  let state = arenaStart(golden.setup, content);
  const events: ArenaEvent[] = [];
  for (const run of golden.inputs) {
    for (let tick = 0; tick < run.ticks && !state.outcome; tick += 1) {
      const step = arenaStep(state, run.sides, content);
      state = step.state;
      events.push(...step.events);
    }
  }
  return { state, events };
}

export const arenaReplayHash = (golden: Pick<ArenaGoldenFile, 'setup' | 'inputs'>, content: ArenaContent): string => arenaHash(arenaReplay(golden, content).state);
