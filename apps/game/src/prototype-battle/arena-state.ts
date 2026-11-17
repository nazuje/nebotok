import { createRng, type BattleCreature, type Effectiveness, type Move, type Rng } from '@nebotok/core';
import { CONTENT } from '../battle-content.ts';
import { ARENA, KITS, PLAYER_SPECIES, STORM, archetypeOf, creatureAt, moveFor, stormRadius, walkCap, type AbilityKind, type AbilitySpec, type Archetype } from './arena-kits.ts';

/** The state of an arena battle: plain data the rules step and the scene draws. */

export type Side = 0 | 1;
export type Action = 'a0' | 'a1' | 'a2' | 'dash' | 'treat' | 'swap';
/** One tick of a side's input: a steer from −1 to 1 on each axis, an optional facing (bots only), and the buttons pressed. */
export type Intent = { readonly mx: number; readonly my: number; readonly face: number | null; readonly actions: readonly Action[] };
export const IDLE: Intent = { mx: 0, my: 0, face: null, actions: [] };

export type Windup = { readonly slot: number; readonly start: number; readonly until: number; readonly ax: number; readonly ay: number; readonly reach: number };

export type Fighter = {
  readonly side: Side;
  readonly creature: BattleCreature;
  readonly archetype: Archetype;
  readonly kit: readonly AbilitySpec[];
  readonly moves: readonly Move[];
  readonly cap: number;
  readonly maxHp: number;
  hp: number;
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  face: number;
  steering: boolean;
  /** True for a person's input: aim help turns abilities towards the other creature. Bots aim for themselves. */
  aimHelp: boolean;
  /** The tick each ability is ready again. */
  ready: number[];
  dashReady: number;
  dashUntil: number;
  dashX: number;
  dashY: number;
  lungeUntil: number;
  lungeX: number;
  lungeY: number;
  lungeHit: boolean;
  slowUntil: number;
  slow: number;
  rootUntil: number;
  shieldUntil: number;
  knockedUntil: number;
  windup: Windup | null;
  fallAt: number | null;
};

export type Shot = { readonly id: number; readonly side: Side; readonly slot: number; readonly treat: boolean; x: number; y: number; px: number; py: number; readonly vx: number; readonly vy: number; readonly radius: number; readonly until: number };
export type ZoneKind = 'wall' | 'puddle' | 'freeze' | 'sun';
export type Zone = {
  readonly id: number;
  readonly side: Side;
  readonly slot: number;
  readonly kind: ZoneKind;
  x: number;
  y: number;
  px: number;
  py: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly dirX: number;
  readonly dirY: number;
  readonly radius: number;
  readonly start: number;
  readonly armAt: number;
  readonly until: number;
  touched: boolean;
  nextPulse: number;
};
export type TreatState = { state: 'hand' | 'flying' | 'ground' | 'away'; x: number; y: number; until: number };
export type Storm = { radius: number; from: number; to: number; step: number; shrinkAt: number };
export type How = 'knockout' | 'ringout' | 'befriend' | 'time';
export type Outcome = { readonly winner: Side; readonly how: How; readonly tick: number };

export type ArenaEvent =
  | { readonly kind: 'hit'; readonly side: Side; readonly x: number; readonly y: number; readonly damage: number; readonly effectiveness: Effectiveness; readonly knock: number; readonly source: AbilityKind | 'reflect' }
  | { readonly kind: 'heal'; readonly side: Side; readonly amount: number }
  | { readonly kind: 'block'; readonly side: Side }
  | { readonly kind: 'cast'; readonly side: Side; readonly slot: number; readonly ability: AbilityKind }
  | { readonly kind: 'windup'; readonly side: Side; readonly slot: number }
  | { readonly kind: 'dash' | 'fall' | 'faint' | 'root'; readonly side: Side }
  | { readonly kind: 'bump'; readonly side: Side; readonly x: number; readonly y: number; readonly knock: number }
  | { readonly kind: 'befriend' }
  | { readonly kind: 'treat'; readonly what: 'throw' | 'land' | 'pick' | 'gone' }
  | { readonly kind: 'storm'; readonly what: 'warn' | 'shrink' }
  | { readonly kind: 'swap'; readonly from: number; readonly to: number };

export type ArenaOptions = {
  readonly seed: number;
  /** Levels the wild creature is above yours. */
  readonly gap: number;
  readonly easier: boolean;
  readonly ringOut: boolean;
  /** How many abilities each side may use, 1 to 3. */
  readonly abilities: number;
  /** Which of your three creatures starts. */
  readonly kit: number;
};

export type ArenaState = {
  tick: number;
  readonly options: ArenaOptions;
  readonly team: Fighter[];
  active: number;
  readonly wild: Fighter;
  shots: Shot[];
  zones: Zone[];
  readonly treat: TreatState;
  readonly storm: Storm;
  outcome: Outcome | null;
  events: ArenaEvent[];
  readonly rng: Rng;
  nextId: number;
  swapReady: number;
};

export const other = (side: Side): Side => (side === 0 ? 1 : 0);
export const you = (state: ArenaState): Fighter => state.team[state.active] ?? state.wild;
export const fighterOf = (state: ArenaState, side: Side): Fighter => (side === 0 ? you(state) : state.wild);
export const healthShare = (fighter: Fighter): number => fighter.hp / fighter.maxHp;

function makeFighter(side: Side, species: string, level: number, at: { x: number; y: number; face: number }): Fighter {
  const real = creatureAt(side === 0 ? 'a1' : 'b1', species, level);
  const maxHp = Math.round(real.maxHp * ARENA.hpScale);
  const creature = { ...real, hp: maxHp, maxHp };
  const archetype = archetypeOf(creature.type);
  const kit = KITS[archetype];
  return {
    side,
    creature,
    archetype,
    kit,
    moves: kit.map((ability) => moveFor(creature.type, ability.power)),
    cap: walkCap(species),
    maxHp,
    hp: maxHp,
    x: at.x,
    y: at.y,
    px: at.x,
    py: at.y,
    vx: 0,
    vy: 0,
    face: at.face,
    steering: false,
    aimHelp: true,
    ready: [...ARENA.openingCooldown],
    dashReady: 0,
    dashUntil: 0,
    dashX: 0,
    dashY: 0,
    lungeUntil: 0,
    lungeX: 0,
    lungeY: 0,
    lungeHit: false,
    slowUntil: 0,
    slow: 1,
    rootUntil: 0,
    shieldUntil: 0,
    knockedUntil: 0,
    windup: null,
    fallAt: null,
  };
}

/** The wild species and both levels a seed gives: any species of any weather, at level 10 to 16. */
export function arenaSetup(seed: number): { wild: string; level: number } {
  const rng = createRng(`arena-setup:${seed}`);
  const pool = [...CONTENT.species.keys()].toSorted();
  return { wild: rng.pick(pool), level: rng.int(10, 16) };
}

export function createArena(options: ArenaOptions): ArenaState {
  const { wild, level } = arenaSetup(options.seed);
  const start = ARENA.radius * 0.45;
  const mine = { x: 0, y: start, face: -Math.PI / 2 };
  const team = PLAYER_SPECIES.map((species) => makeFighter(0, species, level, mine));
  const firstShrink = STORM.firstAt;
  return {
    tick: 0,
    options,
    team,
    active: Math.max(0, Math.min(team.length - 1, options.kit)),
    wild: makeFighter(1, wild, Math.max(1, level + options.gap), { x: 0, y: -start, face: Math.PI / 2 }),
    shots: [],
    zones: [],
    treat: { state: 'hand', x: 0, y: 0, until: 0 },
    storm: { radius: ARENA.radius, from: ARENA.radius, to: stormRadius(1), step: 0, shrinkAt: firstShrink },
    outcome: null,
    events: [],
    rng: createRng(`arena-battle:${options.seed}`),
    nextId: 1,
    swapReady: 0,
  };
}

/** Whether the storm is warning now, and how far through its warning (0 to 1). */
export function stormWarning(state: ArenaState): number | null {
  const { storm, tick } = state;
  const from = storm.shrinkAt - STORM.warn;
  if (tick < from || tick >= storm.shrinkAt + STORM.shrink) return null;
  return Math.min(1, (tick - from) / STORM.warn);
}
