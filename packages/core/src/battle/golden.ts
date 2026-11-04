import { z } from 'zod';
import { stableHash } from '../hash.ts';
import { createRng, type Rng, type RngState } from '../rng.ts';
import { BOT_NAMES, BOT_POLICIES, playBattle, type BattlePolicy, type BotName, type PlayedBattle } from './bots.ts';
import type { BattleContent } from './content.ts';
import { legalActions } from './engine.ts';
import { BattleAction, BattleError, BattleSetup } from './state.ts';

/** One side of a golden battle: these actions in order, each time the side must act, then the bot plays on. */
export const BattlePilot = z.strictObject({
  script: z.array(BattleAction).max(500),
  bot: z.enum(BOT_NAMES as [BotName, ...BotName[]]),
});
export type BattlePilot = z.infer<typeof BattlePilot>;

/**
 * Battle goldens live in `fixtures/golden/battle/`. The battle draws from an RNG seeded with
 * `seed`, and the bots from one seeded with `bots:<seed>`. The hash covers every event, the final
 * state and the battle RNG's final state.
 */
export const BattleGoldenFile = z.strictObject({
  description: z.string().min(1),
  seed: z.union([z.number().int(), z.string()]),
  setup: BattleSetup,
  pilots: z.tuple([BattlePilot, BattlePilot]),
  expectedHash: z.string().regex(/^[0-9a-f]{14}$/),
});
export type BattleGoldenFile = z.infer<typeof BattleGoldenFile>;

function scripted(pilot: BattlePilot): BattlePolicy {
  let next = 0;
  const bot = BOT_POLICIES[pilot.bot];
  return (state, side, rng, content) => {
    if (legalActions(state, side).length === 0 || next >= pilot.script.length) return bot(state, side, rng, content);
    const action = pilot.script[next];
    next += 1;
    if (!action) throw new BattleError(`script action ${next} is missing`);
    return action;
  };
}

export type BattleReplay = PlayedBattle & { readonly rng: RngState };

export function battleReplay(golden: Pick<BattleGoldenFile, 'seed' | 'setup' | 'pilots'>, content: BattleContent): BattleReplay {
  const battleRng: Rng = createRng(golden.seed);
  const played = playBattle(golden.setup, [scripted(golden.pilots[0]), scripted(golden.pilots[1])], battleRng, createRng(`bots:${golden.seed}`), content);
  return { ...played, rng: battleRng.state() };
}

export function battleReplayHash(golden: Pick<BattleGoldenFile, 'seed' | 'setup' | 'pilots'>, content: BattleContent): string {
  const { events, state, rng } = battleReplay(golden, content);
  return stableHash({ events, state, rng });
}
