import type { ArenaFight, FightSetup, FightStepResult } from './fight-state.ts';
import type { FightContent } from './rules.ts';
import { roundsStart, roundsStep } from './rounds.ts';
import type { ArenaInputs } from './state.ts';
import { wildStart, wildStep } from './wild-fight.ts';

/**
 * A whole fight around the island: `fightStart` from a setup, then `fightStep` once a tick with
 * both sides' inputs. A wild fight reads Treat, Swap and Leave from side 0's input; a best of 3
 * reads only the island's buttons. A finished fight steps no further.
 */

export function fightStart(setup: FightSetup, content: FightContent): ArenaFight {
  return setup.mode === 'wild' ? wildStart(setup, content) : roundsStart(setup, content);
}

export function fightStep(fight: ArenaFight, inputs: ArenaInputs, content: FightContent): FightStepResult {
  return fight.mode === 'wild' ? wildStep(fight, inputs, content) : roundsStep(fight, inputs, content);
}
