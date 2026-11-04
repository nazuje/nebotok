import type { Rng } from '../rng.ts';
import type { BattleContent } from './content.ts';
import { damageOf, moveOf } from './damage.ts';
import { battleStep, legalActions, startBattle } from './engine.ts';
import {
  BattleError,
  SIDES,
  activeCreature,
  opponentOf,
  type BattleAction,
  type BattleCreature,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type SideIndex,
} from './state.ts';

/** Picks an action for one side, or null when that side has nothing to do. Bots drive tests and simulations. */
export type BattlePolicy = (state: BattleState, side: SideIndex, rng: Rng, content: BattleContent) => BattleAction | null;

/** Average damage times the chance to hit, in hundredths of a hit point. */
function expectedDamage(content: BattleContent, state: BattleState, attacker: BattleCreature, target: BattleCreature, moveId: string): number {
  const move = moveOf(content, moveId);
  if (move.power === 0) return 0;
  const roll = Math.floor((content.rules.minRollPercent + 100) / 2);
  return damageOf(content, attacker, target, move, state.weather, roll).damage * move.accuracy;
}

function bestDamage(content: BattleContent, state: BattleState, attacker: BattleCreature, target: BattleCreature): number {
  return Math.max(...attacker.moves.map((id) => expectedDamage(content, state, attacker, target, id)));
}

/** The first of the actions with the highest score, so ties always go the same way. */
function firstBest(actions: readonly BattleAction[], score: (action: BattleAction) => number): BattleAction | null {
  let best: BattleAction | null = null;
  let bestScore = -1;
  for (const action of actions) {
    const value = score(action);
    if (value > bestScore) {
      best = action;
      bestScore = value;
    }
  }
  return best;
}

/** Uses the move with the most expected damage, and sends out the creature that hits the opponent hardest. It never switches by choice. */
export const greedyPolicy: BattlePolicy = (state, side, _rng, content) => {
  const legal = legalActions(state, side);
  const target = activeCreature(state, opponentOf(side));
  const attacker = activeCreature(state, side);
  const creatures = state.sides[side].creatures;
  return firstBest(legal, (action) => {
    if (action.kind === 'move') return expectedDamage(content, state, attacker, target, attacker.moves[action.slot] ?? '');
    // Switching by choice scores 0, so a greedy bot only switches when it must.
    return state.phase === 'swap' ? bestDamage(content, state, creatures[action.to] ?? attacker, target) : 0;
  });
};

/** Any legal action, each equally likely. */
export const randomPolicy: BattlePolicy = (state, side, rng) => {
  const legal = legalActions(state, side);
  return legal.length === 0 ? null : rng.pick(legal);
};

export const BOT_POLICIES = { greedy: greedyPolicy, random: randomPolicy } as const satisfies Readonly<Record<string, BattlePolicy>>;
export type BotName = keyof typeof BOT_POLICIES;
export const BOT_NAMES = Object.keys(BOT_POLICIES).toSorted() as BotName[];

export type PlayedBattle = {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  /** Calls to battleStep, turns and swaps together. */
  readonly steps: number;
};

/**
 * Plays a battle to the end. The battle and the bots draw from separate RNGs, so a bot that
 * thinks differently never shifts the battle's own random numbers.
 */
export function playBattle(setup: BattleSetup, policies: readonly [BattlePolicy, BattlePolicy], battleRng: Rng, botRng: Rng, content: BattleContent): PlayedBattle {
  const started = startBattle(setup, content);
  let { state } = started;
  const events: BattleEvent[] = [...started.events];
  // Each turn is followed by at most one swap step, so this bound is only reached by an engine bug.
  const maxSteps = content.rules.turnLimit * 2 + 1;
  let steps = 0;
  while (state.phase !== 'over') {
    if (steps >= maxSteps) throw new BattleError(`battle did not end within ${maxSteps} steps`);
    const [first, second] = SIDES.map((side) => policies[side](state, side, botRng, content));
    const result = battleStep(state, [first ?? null, second ?? null], battleRng, content);
    state = result.state;
    events.push(...result.events);
    steps += 1;
  }
  return { state, events, steps };
}
