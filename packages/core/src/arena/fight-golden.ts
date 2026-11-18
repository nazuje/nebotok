import { z } from 'zod';
import { fightStart, fightStep } from './fight.ts';
import { FightSetup, fightHash, type ArenaFight, type FightEvent } from './fight-state.ts';
import { ArenaInputRun } from './golden.ts';
import type { FightContent } from './rules.ts';

/**
 * Fight goldens live in `fixtures/golden/arena/fights/` and replay against the arena goldens'
 * frozen content, with its items.json. The hash is `fightHash` of the fight once every input has
 * been played or the fight has ended.
 */
export const FightGoldenFile = z.strictObject({
  description: z.string().min(1),
  setup: FightSetup,
  inputs: z.array(ArenaInputRun).min(1).max(5_000),
  expectedHash: z.string().regex(/^[0-9a-f]{14}$/),
});
export type FightGoldenFile = z.infer<typeof FightGoldenFile>;

export type FightReplay = { readonly fight: ArenaFight; readonly events: readonly FightEvent[] };

export function fightReplay(golden: Pick<FightGoldenFile, 'setup' | 'inputs'>, content: FightContent): FightReplay {
  let fight = fightStart(golden.setup, content);
  const events: FightEvent[] = [];
  for (const run of golden.inputs) {
    for (let tick = 0; tick < run.ticks && !fight.outcome; tick += 1) {
      const step = fightStep(fight, run.sides, content);
      fight = step.fight;
      events.push(...step.events);
    }
  }
  return { fight, events };
}

export const fightReplayHash = (golden: Pick<FightGoldenFile, 'setup' | 'inputs'>, content: FightContent): string => fightHash(fightReplay(golden, content).fight);
