import { damageOf } from '@nebotok/core';
import { CONTENT } from '../battle-content.ts';
import { movePower, type ProtoBattle, type Side } from './prototype-sim.ts';

/**
 * Energy for variants 4 and 5: 0 to 10, spent on moves. A move's price follows its power among the
 * creature's own moves: the weakest is free, the strongest is its big move, which has to be saved up
 * for and hits harder than usual to be worth it.
 */

export const ENERGY_MAX = 10;
export const ENERGY_START = 4;
/** Variant 4: what every creature gains at the end of each turn, and what Charge adds on top. */
export const TURN_GAIN = 3;
export const CHARGE_GAIN = 4;
/** Charging braces: the hits you take that turn do this share of their damage. */
export const BRACE = 0.75;

/** A big move hits this many times harder than its power alone. */
export const BIG_BONUS = 1.5;

/**
 * What `move` costs a creature that knows `moves`: its weakest damaging move is free, its strongest
 * is big (5, or 6 from power 80), the ones between 2 or 3 by power, and calling weather 3.
 */
export function moveCost(move: string, moves: readonly string[]): number {
  const power = movePower(move);
  if (power === 0) return 3;
  const powers = moves.map(movePower).filter((known) => known > 0);
  const top = Math.max(...powers);
  const low = Math.min(...powers);
  if (power === top && top > low) return power >= 80 ? 6 : 5;
  if (power === low) return 0;
  return power <= 50 ? 2 : 3;
}

export const slotCost = (battle: ProtoBattle, side: Side, slot: number): number => moveCost(battle.fighters[side].moves[slot] ?? '', battle.fighters[side].moves);

/** The damage bonus for using the slot: BIG_BONUS for a big move, otherwise 1. */
export const bigBonus = (battle: ProtoBattle, side: Side, slot: number): number => (slotCost(battle, side, slot) >= 5 ? BIG_BONUS : 1);

export const addEnergy = (energy: number, gain: number): number => Math.min(ENERGY_MAX, Math.max(0, energy + gain));

/** The side's most expensive damaging move, the one worth saving up for; null when every move is cheap. */
export function bigSlot(battle: ProtoBattle, side: Side): number | null {
  let best: number | null = null;
  let bestCost = 4;
  battle.fighters[side].moves.forEach((move, slot) => {
    const cost = slotCost(battle, side, slot);
    if (movePower(move) > 0 && cost > bestCost) {
      best = slot;
      bestCost = cost;
    }
  });
  return best;
}

/** How hard a move would hit the other side right now, for the wild side's choice. */
export function expectedDamage(battle: ProtoBattle, side: Side, slot: number): number {
  const attacker = battle.fighters[side];
  const target = battle.fighters[side === 0 ? 1 : 0];
  const move = CONTENT.moves.get(attacker.moves[slot] ?? '');
  if (!move || move.power === 0) return 0;
  return (damageOf(CONTENT, attacker, target, move, battle.weather, 92).damage * move.accuracy * bigBonus(battle, side, slot)) / 100;
}

/** The affordable damaging move that hits hardest, or the free one. */
export function bestAffordable(battle: ProtoBattle, side: Side, energy: number, skip: number | null = null): number {
  let best = 0;
  let bestScore = -1;
  battle.fighters[side].moves.forEach((_, slot) => {
    if (slot === skip || slotCost(battle, side, slot) > energy) return;
    const score = expectedDamage(battle, side, slot);
    if (score > bestScore) {
      best = slot;
      bestScore = score;
    }
  });
  return best;
}

export type Plan = { readonly kind: 'charge' } | { readonly kind: 'move'; readonly slot: number; readonly big: boolean };

/**
 * Variant 4's wild side, chosen at the start of each turn and shown before you pick: it saves up
 * (Charge) for its big move now and then, and mostly uses the big move once it can pay for it.
 */
export function enemyPlan(battle: ProtoBattle, energy: number): Plan {
  const big = bigSlot(battle, 1);
  const roll = battle.rng.int(1, 100);
  if (big !== null) {
    const cost = slotCost(battle, 1, big);
    if (energy >= cost && roll <= 75) return { kind: 'move', slot: big, big: true };
    if (energy < cost && energy + TURN_GAIN < cost + 2 && roll <= 45) return { kind: 'charge' };
  }
  return { kind: 'move', slot: bestAffordable(battle, 1, energy, big), big: false };
}
