import { createRng } from '@nebotok/core';
import { ATTACK_LEAD_MS, type Landed } from './prototype-arena.ts';
import { ENERGY_START, addEnergy, bestAffordable, bigBonus, bigSlot, slotCost } from './prototype-energy.ts';
import { dodgedStrike, moveOf, movePower, newBattle, strike, type ProtoBattle } from './prototype-sim.ts';

/**
 * Variant 5, "Live duel": the rules of a real-time battle with no turns, apart from any drawing so a
 * bot can play it fast (`simulateLive`). Times are page milliseconds; the easier setting stretches
 * every rule time by 1 / speed.
 */

export type LiveTuning = {
  /** Game speed: 1, or 0.75 when easier. */
  readonly speed: number;
  /** How long before the hit a dodge counts as perfect, and how long it protects at all (half damage). */
  readonly perfectMs: number;
  readonly goodMs: number;
  /** From the wild creature's "!" to its hit, at speed 1. */
  readonly windupMs: number;
};

export const LIVE_NORMAL: LiveTuning = { speed: 1, perfectMs: 250, goodMs: 500, windupMs: 700 };
export const LIVE_EASIER: LiveTuning = { speed: 0.75, perfectMs: 350, goodMs: 750, windupMs: 1_000 };

export const LIVE = {
  /** Health pools are this many times the real ones, so a duel lasts about half a minute. */
  hpScale: 9,
  regenPerSecond: 1,
  dodgeCooldownMs: 1_500,
  /** A perfect dodge makes your next hit this much stronger. */
  empowered: 1.3,
  /** The wild creature rests a random time in this range between attacks. */
  restMs: [600, 1_600],
  firstAttackMs: 2_500,
  weatherMs: 15_000,
} as const;

/** Each move's cooldown at speed 1, by what it costs; calling weather takes longest. */
const COOLDOWN_MS: Readonly<Record<number, number>> = { 0: 2_200, 2: 3_000, 3: 3_500, 5: 5_000, 6: 5_500 };
const WEATHER_COOLDOWN_MS = 6_000;
const cooldownOf = (battle: ProtoBattle, slot: number): number => (movePower(moveOf(battle, 0, slot)) === 0 ? WEATHER_COOLDOWN_MS : (COOLDOWN_MS[slotCost(battle, 0, slot)] ?? 3_000));
/** A dodge this long after the planned hit still counts, for a hit drawn a frame late. */
const LATE_MS = 80;

export type WindUp = { readonly slot: number; readonly move: string; readonly start: number; readonly impact: number };
export type DodgeResult = 'perfect' | 'good' | 'none';

export class LiveDuel {
  readonly battle: ProtoBattle;
  readonly tuning: LiveTuning;
  readonly energy: [number, number] = [ENERGY_START, ENERGY_START];
  readonly readyAt: number[];
  empowered = false;
  windup: WindUp | null = null;
  lastDodge: DodgeResult = 'none';
  private dodgeAt: number | null = null;
  private dodgeReadyAt = 0;
  private nextEnemyAt: number;
  private weatherUntil: number | null = null;
  private last: number;

  constructor(battle: ProtoBattle, tuning: LiveTuning, now: number) {
    this.battle = battle;
    this.tuning = tuning;
    this.readyAt = battle.fighters[0].moves.map(() => now);
    this.nextEnemyAt = now + this.scaled(LIVE.firstAttackMs);
    this.last = now;
  }

  scaled(ms: number): number {
    return ms / this.tuning.speed;
  }

  /** Moves time on: energy comes in, weather runs out, and the wild creature may start an attack. */
  tick(now: number): { windup: WindUp | null; weatherEnded: boolean } {
    const dt = Math.max(0, now - this.last);
    this.last = now;
    if (this.battle.winner !== null) return { windup: null, weatherEnded: false };
    const gain = (dt / 1000) * LIVE.regenPerSecond * this.tuning.speed;
    this.energy[0] = addEnergy(this.energy[0], gain);
    this.energy[1] = addEnergy(this.energy[1], gain);
    let weatherEnded = false;
    if (this.weatherUntil !== null && now >= this.weatherUntil) {
      this.weatherUntil = null;
      this.battle.weather = null;
      weatherEnded = true;
    }
    if (this.windup !== null || now < this.nextEnemyAt) return { windup: null, weatherEnded };
    const slot = this.enemyChoice();
    const move = moveOf(this.battle, 1, slot);
    this.energy[1] = addEnergy(this.energy[1], -slotCost(this.battle, 1, slot));
    this.windup = { slot, move, start: now, impact: now + this.scaled(this.tuning.windupMs) };
    return { windup: this.windup, weatherEnded };
  }

  /** Mostly its big move once it can pay, now and then a weather call, otherwise its best affordable hit. */
  private enemyChoice(): number {
    const { battle } = this;
    const energy = this.energy[1];
    const big = bigSlot(battle, 1);
    const roll = battle.rng.int(1, 100);
    if (big !== null && energy >= slotCost(battle, 1, big) && roll <= 60) return big;
    const weather = battle.fighters[1].moves.findIndex((move) => movePower(move) === 0);
    if (weather >= 0 && roll > 92 && energy >= slotCost(battle, 1, weather) && battle.weather?.type !== battle.fighters[1].type) return weather;
    return bestAffordable(battle, 1, energy, big);
  }

  /** What is left of a move's cooldown, 1 just used to 0 ready. */
  cooldownLeft(slot: number, now: number): number {
    const left = (this.readyAt[slot] ?? now) - now;
    return left <= 0 ? 0 : left / this.scaled(cooldownOf(this.battle, slot));
  }

  dodgeLeft(now: number): number {
    const left = this.dodgeReadyAt - now;
    return left <= 0 ? 0 : left / this.scaled(LIVE.dodgeCooldownMs);
  }

  canUse(slot: number, now: number): boolean {
    return this.battle.winner === null && this.cooldownLeft(slot, now) === 0 && this.energy[0] >= slotCost(this.battle, 0, slot);
  }

  /** Starts one of your moves: pays for it and starts its cooldown. Its hit comes later, from `landYours`. */
  use(slot: number, now: number): boolean {
    if (!this.canUse(slot, now)) return false;
    this.energy[0] = addEnergy(this.energy[0], -slotCost(this.battle, 0, slot));
    this.readyAt[slot] = now + this.scaled(cooldownOf(this.battle, slot));
    return true;
  }

  landYours(slot: number, now: number): Landed | null {
    if (this.battle.winner !== null) return null;
    const damaging = movePower(moveOf(this.battle, 0, slot)) > 0;
    const result = strike(this.battle, 0, slot, (damaging && this.empowered ? LIVE.empowered : 1) * bigBonus(this.battle, 0, slot));
    if (!result) return null;
    if (damaging && !result.missed) this.empowered = false;
    if (result.weather) this.weatherUntil = now + this.scaled(LIVE.weatherMs);
    return { strike: result, shielded: false };
  }

  dodge(now: number): boolean {
    if (this.battle.winner !== null || now < this.dodgeReadyAt) return false;
    this.dodgeAt = now;
    this.dodgeReadyAt = now + this.scaled(LIVE.dodgeCooldownMs);
    return true;
  }

  /** The wild creature's hit: judged against when it was meant to land, so a late frame never costs a dodge. */
  landTheirs(now: number): Landed | null {
    const windup = this.windup;
    if (!windup) return null;
    this.windup = null;
    this.nextEnemyAt = now + this.scaled(LIVE.restMs[0] + this.battle.rng.int(0, LIVE.restMs[1] - LIVE.restMs[0]));
    if (this.battle.winner !== null) return null;
    this.lastDodge = this.judgeDodge(windup);
    if (movePower(windup.move) === 0) this.lastDodge = 'none';
    if (this.lastDodge === 'perfect') {
      this.empowered = true;
      return { strike: dodgedStrike(this.battle, 1, windup.slot), shielded: false };
    }
    const result = strike(this.battle, 1, windup.slot, (this.lastDodge === 'good' ? 0.5 : 1) * bigBonus(this.battle, 1, windup.slot));
    if (!result) return null;
    if (result.weather) this.weatherUntil = now + this.scaled(LIVE.weatherMs);
    return { strike: result, shielded: this.lastDodge === 'good' };
  }

  private judgeDodge(windup: WindUp): DodgeResult {
    if (this.dodgeAt === null) return 'none';
    const early = windup.impact - this.dodgeAt;
    if (early < -LATE_MS || early > this.tuning.goodMs) return 'none';
    return early <= this.tuning.perfectMs ? 'perfect' : 'good';
  }
}

export type LiveRun = { readonly ms: number; readonly winner: 0 | 1 | null; readonly hpLeft: number };

/**
 * One whole live duel played by a simple bot, 50 ms at a time: it uses the dearest move it can
 * afford whenever one is ready, and dodges `dodgeShare` of the attacks, 150 ms before the hit.
 */
export function simulateLive(seed: number, gap: number, dodgeShare: number, tuning: LiveTuning = LIVE_NORMAL): LiveRun {
  const battle = newBattle(seed, gap, LIVE.hpScale);
  const duel = new LiveDuel(battle, tuning, 0);
  const bot = createRng(`prototype-live-bot:${seed}`);
  const pending: { at: number; run: () => void }[] = [];
  const order = battle.fighters[0].moves.map((_, slot) => ({ slot, cost: slotCost(battle, 0, slot) })).toSorted((a, b) => b.cost - a.cost);
  let now = 0;
  for (; now < 300_000 && battle.winner === null; now += 50) {
    const { windup } = duel.tick(now);
    if (windup) {
      if (bot.int(1, 100) <= dodgeShare * 100) pending.push({ at: windup.impact - 150, run: () => duel.dodge(windup.impact - 150) });
      pending.push({ at: windup.impact, run: () => duel.landTheirs(windup.impact) });
    }
    for (const due of pending.filter((item) => item.at <= now)) {
      pending.splice(pending.indexOf(due), 1);
      due.run();
    }
    const ready = order.find(({ slot }) => duel.canUse(slot, now));
    if (ready && duel.use(ready.slot, now)) {
      const at = now + ATTACK_LEAD_MS;
      pending.push({ at, run: () => duel.landYours(ready.slot, at) });
    }
  }
  return { ms: now, winner: battle.winner, hpLeft: battle.winner === null ? 0 : battle.fighters[battle.winner].hp / battle.fighters[battle.winner].maxHp };
}

/** Average length and your win share over `count` seeds. */
export function measureLive(count: number, gap: number, dodgeShare: number, easier = false): { averageMs: number; shortestMs: number; longestMs: number; yourWins: number } {
  const runs = Array.from({ length: count }, (_, at) => simulateLive(1000 + at, gap, dodgeShare, easier ? LIVE_EASIER : LIVE_NORMAL));
  const lengths = runs.map((run) => run.ms);
  return {
    averageMs: Math.round(lengths.reduce((sum, ms) => sum + ms, 0) / count),
    shortestMs: Math.min(...lengths),
    longestMs: Math.max(...lengths),
    yourWins: runs.filter((run) => run.winner === 0).length / count,
  };
}
