import { battleCreature, createRng, damageOf, effectivenessOf, type BattleCreature, type Effectiveness, type FieldEffect, type FieldWeather, type Rng } from '@nebotok/core';
import { CONTENT } from '../battle-content.ts';

/**
 * A local stand-in for the server's battle, for the battle-feel prototype only: one creature a side,
 * real species, moves, stats, type chart and damage (`damageOf` from core), with a seeded RNG. It adds
 * things the real rules do not have: a 1 in 10 critical hit (1.5x), a damage multiplier the timed
 * variants pass in, a dodge that takes the whole hit, a level gap for the wild side, and bigger health
 * pools for the live duel.
 */

export type Side = 0 | 1;

export type ProtoBattle = {
  readonly seed: number;
  readonly fighters: [BattleCreature, BattleCreature];
  weather: FieldWeather | null;
  turn: number;
  winner: Side | null;
  readonly rng: Rng;
};

export type Strike = {
  readonly side: Side;
  readonly move: string;
  readonly moveType: string;
  readonly missed: boolean;
  readonly damage: number;
  readonly effectiveness: Effectiveness;
  readonly field: FieldEffect;
  readonly critical: boolean;
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly maxHp: number;
  readonly fainted: boolean;
  /** The weather this move called up, or null. */
  readonly weather: string | null;
  /** True when the target dodged the whole hit. */
  readonly dodged: boolean;
};

export type Advantage = 'strong' | 'weak' | 'normal';

const CRIT_ONE_IN = 10;
const CRIT_PERCENT = 150;

/** The weather types in a ring, each strong against the next, read from the type chart. */
export function weatherCycle(): string[] {
  const ids = [...CONTENT.weather.keys()];
  const first = ids[0];
  if (first === undefined) return [];
  const ring = [first];
  let next = CONTENT.weather.get(first)?.strongAgainst[0];
  while (next !== undefined && !ring.includes(next) && ring.length < ids.length) {
    ring.push(next);
    next = CONTENT.weather.get(next)?.strongAgainst[0];
  }
  return ring.length === ids.length ? ring : ids;
}

/** The pair of species, their level and the starting weather a seed gives. Variant 0 uses it too. */
export function setupOf(seed: number): { species: [string, string]; level: number; weather: string | null } {
  const rng = createRng(`prototype-setup:${seed}`);
  const pool = [...CONTENT.species.keys()].toSorted();
  const mine = pool.splice(rng.int(0, pool.length - 1), 1)[0] ?? '';
  const theirs = pool[rng.int(0, pool.length - 1)] ?? '';
  const types = [...CONTENT.weather.keys()];
  const weather = rng.int(1, 10) <= 7 ? rng.pick(types) : null;
  return { species: [mine, theirs], level: rng.int(10, 16), weather };
}

/** The wild creature's level is the seed's level plus `gap`; `hpScale` multiplies both health pools. */
export function newBattle(seed: number, gap = 0, hpScale = 1): ProtoBattle {
  const setup = setupOf(seed);
  const make = (side: Side): BattleCreature => {
    const species = CONTENT.species.get(setup.species[side]);
    if (!species) throw new Error(`no species ${setup.species[side]}`);
    const made = battleCreature(side === 0 ? 'a1' : 'b1', species, Math.max(1, setup.level + (side === 1 ? gap : 0)));
    const hp = Math.round(made.maxHp * hpScale);
    return { ...made, hp, maxHp: hp };
  };
  return { seed, fighters: [make(0), make(1)], weather: setup.weather ? { type: setup.weather, turnsLeft: null } : null, turn: 0, winner: null, rng: createRng(`prototype-battle:${seed}`) };
}

export function advantageOf(battle: ProtoBattle, side: Side, move: string): Advantage {
  const known = CONTENT.moves.get(move);
  if (!known || known.power === 0) return 'normal';
  return effectivenessOf(CONTENT, known.type, battle.fighters[side === 0 ? 1 : 0].type);
}

/** Who acts first this turn: the faster creature, or a coin toss. */
export function turnOrder(battle: ProtoBattle): [Side, Side] {
  const [mine, theirs] = battle.fighters;
  if (mine.speed !== theirs.speed) return mine.speed > theirs.speed ? [0, 1] : [1, 0];
  return battle.rng.int(0, 1) === 0 ? [0, 1] : [1, 0];
}

/** The wild side's choice: usually its hardest-hitting move, sometimes any move. */
export function enemySlot(battle: ProtoBattle): number {
  const [target, attacker] = battle.fighters;
  const moves = attacker.moves;
  if (battle.rng.int(1, 10) <= 3) return battle.rng.int(0, moves.length - 1);
  let best = 0;
  let bestScore = -1;
  moves.forEach((id, slot) => {
    const move = CONTENT.moves.get(id);
    if (!move) return;
    const score = move.power === 0 ? 0 : damageOf(CONTENT, attacker, target, move, battle.weather, 92).damage * move.accuracy;
    if (score > bestScore) {
      best = slot;
      bestScore = score;
    }
  });
  return best;
}

export function moveOf(battle: ProtoBattle, side: Side, slot: number): string {
  return battle.fighters[side].moves[slot] ?? battle.fighters[side].moves[0] ?? '';
}

export const movePower = (move: string): number => CONTENT.moves.get(move)?.power ?? 0;

/** One creature's action, resolved now. Null when either creature has already fainted. */
export function strike(battle: ProtoBattle, side: Side, slot: number, multiplier = 1): Strike | null {
  const targetSide: Side = side === 0 ? 1 : 0;
  const attacker = battle.fighters[side];
  const target = battle.fighters[targetSide];
  if (attacker.hp === 0 || target.hp === 0) return null;
  const id = moveOf(battle, side, slot);
  const move = CONTENT.moves.get(id);
  if (!move) return null;
  const base = { side, move: id, moveType: move.type, hpBefore: target.hp, maxHp: target.maxHp, weather: null, dodged: false };
  if (battle.rng.int(1, 100) > move.accuracy) {
    return { ...base, missed: true, damage: 0, effectiveness: 'normal', field: 'none', critical: false, hpAfter: target.hp, fainted: false };
  }
  const roll = damageOf(CONTENT, attacker, target, move, battle.weather, battle.rng.int(CONTENT.rules.minRollPercent, 100));
  const critical = move.power > 0 && battle.rng.int(1, CRIT_ONE_IN) === 1;
  const damage = move.power === 0 ? 0 : Math.max(1, Math.round((roll.damage * (critical ? CRIT_PERCENT : 100) * multiplier) / 100));
  const hpAfter = Math.max(0, target.hp - damage);
  battle.fighters[targetSide] = { ...target, hp: hpAfter };
  if (hpAfter === 0) battle.winner = side;
  const weather = move.setsWeather ?? null;
  if (weather !== null) battle.weather = { type: weather, turnsLeft: CONTENT.rules.weatherTurns };
  return { ...base, missed: false, damage, effectiveness: roll.effectiveness, field: roll.field, critical, hpAfter, fainted: hpAfter === 0, weather };
}

/** A damaging move the target dodged completely: nothing changes but the record. */
export function dodgedStrike(battle: ProtoBattle, side: Side, slot: number): Strike {
  const target = battle.fighters[side === 0 ? 1 : 0];
  const id = moveOf(battle, side, slot);
  const moveType = CONTENT.moves.get(id)?.type ?? '';
  return { side, move: id, moveType, missed: true, dodged: true, damage: 0, effectiveness: 'normal', field: 'none', critical: false, hpBefore: target.hp, hpAfter: target.hp, maxHp: target.maxHp, fainted: false, weather: null };
}

/** Counts the turn and wears down called weather. Returns true when the weather just cleared. */
export function endTurn(battle: ProtoBattle): boolean {
  battle.turn += 1;
  const weather = battle.weather;
  if (!weather || weather.turnsLeft === null) return false;
  const turnsLeft = weather.turnsLeft - 1;
  battle.weather = turnsLeft > 0 ? { type: weather.type, turnsLeft } : null;
  return turnsLeft === 0;
}
