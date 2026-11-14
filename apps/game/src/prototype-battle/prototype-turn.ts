import type { ArenaScene } from './prototype-arena.ts';
import type { BattleLog } from './prototype-log.ts';
import { endTurn, enemySlot, moveOf, strike, turnOrder, type ProtoBattle, type Side } from './prototype-sim.ts';

/** What a variant may do just before a creature acts: change its damage, or put up a shield. */
export type Prepared = { readonly multiplier: number; readonly shielded: boolean };
export type BeforeStrike = (side: Side, move: string) => Promise<Prepared>;

const NORMAL: Prepared = { multiplier: 1, shielded: false };
const GAP_MS = 90;

export const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One whole turn, both actions back to back with no narration in between. */
export async function playTurn(battle: ProtoBattle, arena: ArenaScene, slot: number, log: BattleLog, before?: BeforeStrike): Promise<void> {
  const order = turnOrder(battle);
  const enemy = enemySlot(battle);
  const act = async (at: number): Promise<void> => {
    const side = order[at];
    if (side === undefined || battle.winner !== null) return;
    const chosen = side === 0 ? slot : enemy;
    const prepared = before ? await before(side, moveOf(battle, side, chosen)) : NORMAL;
    const result = strike(battle, side, chosen, prepared.multiplier);
    if (result) {
      log.strike(battle, result);
      await arena.playStrike(result, { shielded: prepared.shielded });
      if (result.fainted) {
        await arena.playFaint(side === 0 ? 1 : 0);
        arena.crown(side);
        return;
      }
      if (at === 0) await pause(GAP_MS);
    }
    await act(at + 1);
  };
  await act(0);
  if (battle.winner === null && endTurn(battle)) {
    arena.setWeather(null);
    log.line('battle.weatherEnded');
  }
}
