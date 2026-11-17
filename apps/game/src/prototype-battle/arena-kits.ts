import { battleCreature, damageOf, type BattleCreature, type Effectiveness, type Move } from '@nebotok/core';
import { CONTENT } from '../battle-content.ts';

/**
 * Variant 6, "Arena": the numbers and the creature kits of a free-moving real-time battle on a round
 * floating island. Distances are arena units (the island starts 520 across its radius, a creature's
 * body is 46), speeds are units a second, and times are ticks of a fixed 60 Hz step.
 */

export const TICK_HZ = 60;
export const DT = 1 / TICK_HZ;
export const ticks = (seconds: number): number => Math.round(seconds * TICK_HZ);

export const ARENA = {
  radius: 520,
  body: 46,
  /** Speed kept each tick, and the extra brake when a creature stops steering (from the sumo game). */
  friction: 0.901,
  planted: 0.756,
  /** Walking top speed is `walkBase + walkPerSpeed × the species' base speed`: 385 to 517. */
  walkBase: 330,
  walkPerSpeed: 2.2,
  dashSpeed: 1_100,
  dashTicks: 12,
  dashCooldown: ticks(3),
  swapCooldown: ticks(5),
  topSpeed: 1_800,
  /** After a knock a creature tumbles this long: it steers weakly and the edge does not catch it. */
  knockedTicks: 22,
  /** Knockback grows as health falls: ×fullHealthKnock when full, up to ×(fullHealthKnock + lowHealthKnock) when nearly out. */
  fullHealthKnock: 0.45,
  lowHealthKnock: 1.75,
  /** Second and third abilities start the battle cooling down, so the first seconds are walking and basics. */
  openingCooldown: [0, ticks(3), ticks(12)],
  /** A dash that runs into the other creature shoves it this hard, with no damage. */
  bumpKnock: 700,
  /** Health pools are this many times the real ones, so a fight lasts long enough to move about in. */
  hpScale: 7,
  /** The wild creature's wind-up before its second and third abilities. */
  windup: ticks(0.6),
  limit: ticks(180),
} as const;

export const STORM = {
  firstAt: ticks(20),
  every: ticks(10),
  warn: ticks(2),
  shrink: ticks(0.5),
  /** Each of the first five steps takes a tenth of the start radius (half gone at 60 s), then a twentieth down to a quarter. */
  bigSteps: 5,
  bigStep: 0.1,
  smallStep: 0.05,
  floor: 0.25,
} as const;

export const TREAT = { share: 0.3, speed: 800, range: 560, radius: 26, groundTicks: ticks(5), againTicks: ticks(2) } as const;

/** What the easier setting changes for the wild creature, and the damage you take. */
export const EASIER = { walk: 0.8, windup: 1.5, cooldown: 1.3, damageTaken: 0.7 } as const;

export type Archetype = 'gale' | 'rain' | 'sun';
export type AbilityKind = 'bolt' | 'lunge' | 'wall' | 'puddle' | 'freeze' | 'cone' | 'shield' | 'zone';

/**
 * One ability. Fields an ability does not use are 0. `power` picks the creature's own move of that
 * power and type from content, whose damage (core `damageOf`) the ability deals.
 */
export type AbilitySpec = {
  readonly kind: AbilityKind;
  readonly cooldown: number;
  readonly power: number;
  /** Knockback speed given to the target, before the low-health bonus. */
  readonly knock: number;
  /** Shot, lunge or wall speed. */
  readonly speed: number;
  /** Shot radius, zone radius, wall half-width or cone length. */
  readonly radius: number;
  /** Shot range, throw distance, or cone half-angle in radians. */
  readonly reach: number;
  /** Lunge drive, wall, puddle, sun zone or shield life, or how long a freeze roots. */
  readonly ticks: number;
  /** Ticks before a zone works: the puddle's flight, the freeze circle forming. */
  readonly arm: number;
  /** Puddle slow factor, shield reflect share, or sun zone heal share per pulse. */
  readonly effect: number;
};

const spec = (fields: Partial<AbilitySpec> & Pick<AbilitySpec, 'kind' | 'cooldown' | 'power'>): AbilitySpec => ({ knock: 0, speed: 0, radius: 0, reach: 0, ticks: 0, arm: 0, effect: 0, ...fields });

export const KITS: Readonly<Record<Archetype, readonly [AbilitySpec, AbilitySpec, AbilitySpec]>> = {
  gale: [
    spec({ kind: 'bolt', cooldown: ticks(0.9), power: 50, knock: 420, speed: 900, radius: 22, reach: 560 }),
    spec({ kind: 'lunge', cooldown: ticks(6), power: 65, knock: 1_150, speed: 1_350, ticks: 14 }),
    spec({ kind: 'wall', cooldown: ticks(20), power: 100, knock: 1_250, speed: 650, radius: 190, ticks: ticks(1) }),
  ],
  rain: [
    spec({ kind: 'bolt', cooldown: ticks(1), power: 50, knock: 300, speed: 1_000, radius: 18, reach: 620 }),
    spec({ kind: 'puddle', cooldown: ticks(6), power: 65, radius: 115, reach: 300, ticks: ticks(4), arm: 18, effect: 0.45 }),
    spec({ kind: 'freeze', cooldown: ticks(20), power: 100, radius: 190, reach: 200, ticks: ticks(1.6), arm: 30 }),
  ],
  sun: [
    spec({ kind: 'cone', cooldown: ticks(0.8), power: 50, knock: 560, radius: 230, reach: 0.7 }),
    spec({ kind: 'shield', cooldown: ticks(6), power: 65, knock: 500, ticks: ticks(4), effect: 0.4 }),
    spec({ kind: 'zone', cooldown: ticks(20), power: 100, radius: 210, ticks: ticks(5), effect: 0.03 }),
  ],
};

/** The sun zone pulses this often; each pulse does this share of a full hit. */
export const ZONE_PULSE = ticks(0.5);
export const ZONE_PULSE_SHARE = 0.2;
/** Wall thickness, and the short-range aim help: within this angle of your facing, an ability aims at the wild creature. */
export const WALL_THICKNESS = 50;
export const AIM_ASSIST = (30 * Math.PI) / 180;

export const ARCHETYPE_OF: Readonly<Record<string, Archetype>> = { gale: 'gale', storm: 'gale', rain: 'rain', frost: 'rain', sun: 'sun', bloom: 'sun' };
export const archetypeOf = (type: string): Archetype => ARCHETYPE_OF[type] ?? 'gale';

/** Your three creatures, one of each kit: Pinwhirl (gale), Puddlepip (rain) and Glowbun (sun). */
export const PLAYER_SPECIES = ['pinwhirl', 'puddlepip', 'glowbun'] as const;

/** A content move of a type and power; every weather type has one at 50, 65 and 100. */
export function moveFor(type: string, power: number): Move {
  const found = [...CONTENT.moves.values()].filter((move) => move.type === type && move.power === power).toSorted((a, b) => a.id.localeCompare(b.id))[0];
  if (!found) throw new Error(`no ${type} move of power ${power}`);
  return found;
}

export function walkCap(species: string): number {
  const base = CONTENT.species.get(species)?.stats.speed ?? 60;
  return ARENA.walkBase + ARENA.walkPerSpeed * base;
}

export function creatureAt(id: string, species: string, level: number): BattleCreature {
  const known = CONTENT.species.get(species);
  if (!known) throw new Error(`no species ${species}`);
  return battleCreature(id, known, level);
}

/** A hit's damage: the move's real damage with a random roll, times `share`, at least 1. */
export function hitDamage(attacker: BattleCreature, target: BattleCreature, move: Move, roll: number, share: number): { damage: number; effectiveness: Effectiveness } {
  const { damage, effectiveness } = damageOf(CONTENT, attacker, target, move, null, roll);
  return { damage: Math.max(1, Math.round(damage * share)), effectiveness };
}

/** Knockback speed for a target with `share` of its health left. */
export const knockFor = (base: number, share: number): number => base * (ARENA.fullHealthKnock + ARENA.lowHealthKnock * (1 - Math.max(0, Math.min(1, share))));

/** The arena radius after `step` storm steps. */
export function stormRadius(step: number): number {
  const big = Math.min(step, STORM.bigSteps) * STORM.bigStep;
  const small = Math.max(0, step - STORM.bigSteps) * STORM.smallStep;
  return ARENA.radius * Math.max(STORM.floor, 1 - big - small);
}
