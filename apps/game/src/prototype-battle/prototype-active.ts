import type { Language } from '@nebotok/core';
import type { ArenaScene, Judgement } from './prototype-arena.ts';
import { ENERGY_COLOUR } from './prototype-bars.ts';
import { actionButton, moveButtons } from './prototype-controls.ts';
import { BRACE, CHARGE_GAIN, ENERGY_START, TURN_GAIN, addEnergy, bigBonus, enemyPlan, slotCost, type Plan } from './prototype-energy.ts';
import type { BattleLog } from './prototype-log.ts';
import { dodgedStrike, endTurn, moveOf, movePower, newBattle, strike, turnOrder, type ProtoBattle, type Side } from './prototype-sim.ts';
import { mountStage } from './prototype-stage.ts';
import { easierWindows, timedTap, type Windows } from './prototype-timing.ts';
import type { Settings } from './prototype-toggles.ts';
import { pause } from './prototype-turn.ts';

/**
 * Variant 4, "Active turns": turn based, but every turn asks something of you. Moves cost energy,
 * Charge saves up and braces, your attack has a timing ring and the wild creature's attack a dodge
 * ring, and the wild creature shows when it is saving up for its big move.
 */

export type ActiveOptions = { readonly seed: number; readonly language: Language; readonly settings: Settings; newBattle(): void };

export const ACTIVE_WINDOWS: Windows = { ringMs: 800, perfectMs: 90, goodMs: 260 };
const AIM: Readonly<Record<Judgement, number>> = { perfect: 1.4, good: 1, miss: 0.7 };
/** A perfect dodge hits back with your free move at this share of its damage. */
const COUNTER = 0.5;
const ALERT_COLOUR = 0xff922b;
const GAP_MS = 90;
const JUDGED_PAUSE_MS = 160;

type Turn = { readonly battle: ProtoBattle; readonly arena: ArenaScene; readonly log: BattleLog; readonly windows: Windows; readonly energy: [number, number] };

/** Shows what the wild creature means to do this turn: charge up, or its big move. */
function telegraph(arena: ArenaScene, plan: Plan): void {
  const charging = plan.kind === 'charge';
  const big = plan.kind === 'move' && plan.big;
  arena.setMark(1, charging ? 'charge' : big ? 'alert' : null);
  arena.setAura(1, charging ? ENERGY_COLOUR : big ? ALERT_COLOUR : null);
}

/** Your cheapest damaging move, for the counter after a perfect dodge. */
function counterSlot(battle: ProtoBattle): number {
  const moves = battle.fighters[0].moves;
  let best = 0;
  moves.forEach((move, slot) => {
    if (movePower(move) > 0 && (movePower(moves[best] ?? '') === 0 || slotCost(battle, 0, slot) < slotCost(battle, 0, best))) best = slot;
  });
  return best;
}

/** Plays one attack and its faint. Returns true when it ended the battle. */
async function land(turn: Turn, result: ReturnType<typeof strike>, shielded = false, quick = false): Promise<boolean> {
  if (!result) return false;
  turn.log.strike(turn.battle, result);
  await turn.arena.playAttack({ side: result.side, move: result.move, quick, land: () => ({ strike: result, shielded }) });
  if (!result.fainted) return false;
  await turn.arena.playFaint(result.side === 0 ? 1 : 0);
  turn.arena.crown(result.side);
  return true;
}

async function yourAttack(turn: Turn, slot: number, enemyBraced: boolean): Promise<boolean> {
  const { battle, arena } = turn;
  let multiplier = (enemyBraced ? BRACE : 1) * bigBonus(battle, 0, slot);
  if (movePower(moveOf(battle, 0, slot)) > 0) {
    const judgement = await timedTap(arena, 'aim', turn.windows);
    arena.showJudgement(judgement, 'aim');
    await pause(JUDGED_PAUSE_MS);
    multiplier *= AIM[judgement];
  }
  return land(turn, strike(battle, 0, slot, multiplier));
}

async function theirAttack(turn: Turn, slot: number, youBraced: boolean): Promise<boolean> {
  const { battle, arena } = turn;
  const brace = (youBraced ? BRACE : 1) * bigBonus(battle, 1, slot);
  if (movePower(moveOf(battle, 1, slot)) === 0) {
    arena.endWindUp(1);
    return land(turn, strike(battle, 1, slot));
  }
  arena.windUp(1, turn.windows.ringMs);
  const judgement = await timedTap(arena, 'shield', turn.windows);
  arena.endWindUp(1);
  if (judgement === 'perfect') {
    await land(turn, dodgedStrike(battle, 1, slot));
    await pause(GAP_MS);
    return land(turn, strike(battle, 0, counterSlot(battle), COUNTER), false, true);
  }
  if (judgement === 'good') arena.showJudgement('good', 'shield');
  return land(turn, strike(battle, 1, slot, (judgement === 'good' ? 0.5 : 1) * brace), judgement === 'good');
}

function pay(turn: Turn, side: Side, plan: Plan): void {
  if (plan.kind !== 'move') return;
  turn.energy[side] = addEnergy(turn.energy[side], -slotCost(turn.battle, side, plan.slot));
  turn.arena.setEnergy(side, turn.energy[side]);
}

/** One turn: both charges first, then the attacks in speed order, then energy for both. */
async function playActiveTurn(turn: Turn, mine: Plan, theirs: Plan): Promise<void> {
  const { battle, arena, energy } = turn;
  pay(turn, 0, mine);
  pay(turn, 1, theirs);
  if (theirs.kind === 'charge') arena.setMark(1, null);
  const charges = ([0, 1] as const).filter((side) => (side === 0 ? mine : theirs).kind === 'charge');
  await Promise.all(
    charges.map(async (side) => {
      energy[side] = addEnergy(energy[side], CHARGE_GAIN);
      arena.setEnergy(side, energy[side]);
      await arena.playCharge(side);
    }),
  );
  if (theirs.kind === 'charge') arena.setAura(1, null);
  const order = turnOrder(battle);
  // Each attack waits for the one before it, so a faint can end the turn early.
  const act = async (at: number): Promise<boolean> => {
    const side = order[at];
    if (side === undefined) return false;
    const plan = side === 0 ? mine : theirs;
    if (plan.kind === 'move') {
      if (at > 0) await pause(GAP_MS);
      const over = side === 0 ? await yourAttack(turn, plan.slot, theirs.kind === 'charge') : await theirAttack(turn, plan.slot, mine.kind === 'charge');
      if (over || battle.winner !== null) return true;
    }
    return act(at + 1);
  };
  if (await act(0)) return;
  arena.setAura(0, null);
  energy[0] = addEnergy(energy[0], TURN_GAIN);
  energy[1] = addEnergy(energy[1], TURN_GAIN);
  arena.setEnergy(0, energy[0]);
  arena.setEnergy(1, energy[1]);
  if (endTurn(battle)) {
    arena.setWeather(null);
    turn.log.line('battle.weatherEnded');
  }
}

export async function mountActive(root: HTMLElement, options: ActiveOptions): Promise<void> {
  const battle = newBattle(options.seed, options.settings.gap);
  const energy: [number, number] = [ENERGY_START, ENERGY_START];
  const { game, arena, log, bottom } = await mountStage(root, { ...options, layout: 'duel', energy: true, controls: 'buttons five' });
  arena.show(battle, energy);
  const windows = options.settings.easier ? easierWindows(ACTIVE_WINDOWS) : ACTIVE_WINDOWS;
  const turn: Turn = { battle, arena, log, windows, energy };
  let plan = enemyPlan(battle, energy[1]);
  telegraph(arena, plan);
  let busy = false;
  const pick = async (choice: number | 'charge') => {
    if (busy || battle.winner !== null) return;
    if (choice !== 'charge' && slotCost(battle, 0, choice) > energy[0]) return;
    busy = true;
    controls.setBusy(true);
    charge.element.disabled = true;
    document.body.dataset.turn = 'playing';
    if (choice === 'charge') arena.setAura(0, ENERGY_COLOUR);
    await playActiveTurn(turn, choice === 'charge' ? { kind: 'charge' } : { kind: 'move', slot: choice, big: false }, plan);
    busy = false;
    const over = battle.winner !== null;
    document.body.dataset.turn = over ? 'over' : 'idle';
    controls.setBusy(over);
    charge.element.disabled = over;
    controls.setEnergy(energy[0]);
    if (over) return;
    plan = enemyPlan(battle, energy[1]);
    telegraph(arena, plan);
  };
  const controls = moveButtons(battle, options.language, (slot) => void pick(slot), { energy: true });
  const charge = actionButton('charge', 'Charge', () => void pick('charge'));
  controls.element.append(charge.element);
  controls.setEnergy(energy[0]);
  bottom.append(controls.element);
  document.body.dataset.turn = 'idle';
  Object.assign(window, { __prototype: { game, battle, arena, energy, plan: () => plan } });
}
