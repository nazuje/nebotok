import { greedyPolicy, battleStep, battleView, createRng, progressMessage, emptyProgress, newCreature, startBattle, type BattleAction, type BattleSetup, type BattleState, type BattleUpdate, type ProgressMessage } from '@nebotok/core';
import { CONTENT } from '../../src/battle-content.ts';
import type { ServerMessage } from '../../src/battle-link.ts';

/**
 * Typed server messages for the battle screen's tests, made by the same core rules the server
 * runs: a battle is started, then stepped with the actions given, and each step becomes the
 * `battle.turn` the server would send.
 */
export type FakeBattle = { readonly id: string; state: BattleState; readonly rng: ReturnType<typeof createRng> };

type Creature = BattleSetup['sides'][number]['creatures'][number];

export function wildBattle(team: readonly Creature[], wild: Creature, weather: string | null = null, id = 'battle-1'): { battle: FakeBattle; started: ServerMessage & { type: 'battle.started' } } {
  const { state, events } = startBattle({ sides: [{ creatures: [...team] }, { creatures: [wild] }], weather, wild: true }, CONTENT);
  return { battle: { id, state, rng: createRng(7) }, started: { type: 'battle.started', payload: { battle: battleView(id, state), events } } };
}

/** Without `theirs`, the wild creature acts as the server's bot would. */
export function turn(battle: FakeBattle, mine: BattleAction | null, theirs?: BattleAction | null): ServerMessage & { type: 'battle.turn'; payload: BattleUpdate } {
  const wild = theirs === undefined ? greedyPolicy(battle.state, 1, battle.rng, CONTENT) : theirs;
  const { state, events } = battleStep(battle.state, [mine, wild], battle.rng, CONTENT);
  battle.state = state;
  return { type: 'battle.turn', payload: { battle: battleView(battle.id, state), events } };
}

export function progress(team: readonly { species: string; level: number; hp?: number }[] = [], inventory: ProgressMessage['inventory'] = []): ServerMessage & { type: 'progress' } {
  const creatures = team.map(({ species, level, hp }) => {
    const made = newCreature(species, level, CONTENT);
    return hp === undefined ? made : { ...made, hp };
  });
  return { type: 'progress', payload: progressMessage({ ...emptyProgress(), team: creatures, inventory: [...inventory] }) };
}
