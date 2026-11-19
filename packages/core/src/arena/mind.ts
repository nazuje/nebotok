import { ARENA_KINDS, type ArenaShape } from '../arena-shapes.ts';
import type { ArenaMindName, ArenaMindSkill, ArenaRules } from '../content.ts';
import { buttonUnlocked, learnedBy } from '../loadout.ts';
import { createRng, type Rng } from '../rng.ts';
import { abilityOf, isBusy, type Ability } from './abilities.ts';
import { DIRECTION_VECTORS, ONE, TICKS_PER_SECOND, abs, div, directionVector, lengthOf, percentOf, sineOf, speedPerTick, toSubunits, turn, unitOf } from './fixed.ts';
import { healthPermille } from './hits.ts';
import type { ArenaContent } from './rules.ts';
import { ARENA_BUTTONS, ARENA_IDLE, arenaStart, otherSide, type ArenaInput, type ArenaInputs, type ArenaLoadout, type ArenaSetup, type ArenaState, type ArenaStepResult, type Body, type Button, type Side } from './state.ts';
import { arenaStep } from './step.ts';
import { stormRadius } from './storm.ts';

/**
 * The computer's mind in an arena fight (docs/arena.md, "Minds"): a whole-number port of the
 * prototype's `arena-ai.ts`. It keeps its favourite range and circles the other creature, stays off
 * the edge and out of the other side's puddles and zones, leads its shots, dashes aside from some
 * shots and wind-ups, and saves its special and ultimate for a good moment. How well it plays is a
 * skill from arena.json `minds`.
 */

/** What a mind remembers between ticks: one per creature it plays, made by `createBrain`, changed by `wildInput`. */
export type Brain = {
  readonly skill: ArenaMindSkill;
  /** Which way it circles the other creature: 1 or -1. */
  strafe: number;
  /** The tick it next chooses where to walk, and the direction it chose. */
  nextThink: number;
  walk: number | null;
  /** No ability before this tick. */
  waitUntil: number;
  /** The other side's shots it has already judged, and whether it has judged the other's wind-up and lunge. */
  seen: number[];
  windupSeen: boolean;
  lungeSeen: boolean;
  /** A dash aside it plans, from this tick, in this direction. */
  dodgeAt: number | null;
  dodgeDir: number;
};

/** A mind watches for the first second before it walks or acts. */
const START_TICKS = 60;
/** The chance, each time it chooses where to walk, that it turns to circle the other way. */
const STRAFE_FLIP_PERCENT = 15;
/** It walks closer or further only when it is more than this far from its range (arena units). */
const RANGE_SLACK = 60;
/** How strongly it circles, against walking in or out. */
const STRAFE_PERCENT = 80;
/** Past its edge margin it is pushed inwards by one more every this many units, up to `EDGE_PUSH_MOST`. */
const EDGE_PUSH_UNITS = 60;
const EDGE_PUSH_MOST = 3;
/** How strongly it walks out of the other side's puddles, freezes, marks and zones. */
const ZONE_PUSH = 2;
/** It dodges what would reach it within this many ticks, passing within a body, the threat's size and this slack (units). */
const DODGE_LOOK_TICKS = 30;
const DODGE_SLACK = 12;
/** A wind-up is judged as a shot this fast and this big; a lunge as its drive and this size. */
const WINDUP_THREAT_SPEED = 900;
const WINDUP_THREAT_SIZE = 60;
const LUNGE_THREAT_SIZE = 10;
/** It dodges a wind-up this many ticks before it ends. */
const WINDUP_DODGE_EARLY = 10;
/** The chance a tick of using a ready quick move with the other creature in reach. */
const QUICK_PERCENT = 35;
/** A shot is in reach within this share of its flight; a cone within its radius and this share of a body. */
const SHOT_REACH_PERCENT = 90;
const CONE_BODY_PERCENT = 60;
/** A wall is worth rolling at a creature within this share of how far it rolls. */
const WALL_REACH_PERCENT = 80;
/** A shield goes up with an enemy shot within `THREAT_NEAR` units, or the other creature within `SHIELD_NEAR`. */
const THREAT_NEAR = 300;
const SHIELD_NEAR = 260;
/** A healing zone is also worth it below this share of health, with the other creature within `HEAL_NEAR` units. */
const HEAL_BELOW_PERMILLE = 500;
const HEAL_NEAR = 400;

const SHOTS: ReadonlySet<ArenaShape> = new Set(['bolt', 'spray', 'snare']);
/** The other side's things that a mind walks out of. */
const LINGERING: ReadonlySet<ArenaShape> = new Set(['puddle', 'freeze', 'strike', 'zone']);

/** A new mind of skill `name`. */
export function createBrain(name: ArenaMindName, rules: ArenaRules): Brain {
  return { skill: rules.minds.skills[name], strafe: 1, nextThink: START_TICKS, walk: null, waitUntil: START_TICKS, seen: [], windupSeen: false, lungeSeen: false, dodgeAt: null, dodgeDir: 0 };
}

/** The wild creature's mind: the gentler one against a player with the turtle setting on. */
export const wildMindFor = (turtle: boolean): ArenaMindName => (turtle ? 'WILD_EASIER' : 'WILD');

/** The direction, 0 to 15, closest to the vector (x, y), or null for the zero vector. Ties go to the lower index. */
export function directionOf(x: number, y: number): number | null {
  if (x === 0 && y === 0) return null;
  let best = 0;
  let bestDot = -Infinity;
  DIRECTION_VECTORS.forEach(([dx, dy], index) => {
    const dot = dx * x + dy * y;
    if (dot > bestDot) {
      best = index;
      bestDot = dot;
    }
  });
  return best;
}

/** The island's edge as a mind sees it: while the storm warns or shrinks, the edge it shrinks to. */
function edgeOf(state: ArenaState, rules: ArenaRules): number {
  const { phase, step } = state.storm;
  return phase === 'warning' || phase === 'shrinking' ? Math.min(state.radius, stormRadius(step + 1, rules)) : state.radius;
}

/** The distance it likes to fight at (1/256 units), by the shape of its first move, button 1's. */
function rangeOf(body: Body, content: ArenaContent): number {
  const id = body.loadout.find((move) => move !== null) ?? null;
  return id === null ? 0 : toSubunits(content.arena.minds.ranges[abilityOf(id, content).shape]);
}

/** Chooses where to walk: towards its range and round the other creature, away from the edge and out of the other side's zones. */
function plan(state: ArenaState, side: Side, brain: Brain, rng: Rng, content: ArenaContent): void {
  const rules = content.arena;
  if (rng.int(0, 99) < STRAFE_FLIP_PERCENT) brain.strafe = -brain.strafe;
  const me = state.bodies[side];
  const target = state.bodies[otherSide(side)];
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const distance = lengthOf(dx, dy);
  const [ux, uy] = unitOf(dx, dy) ?? directionVector(me.facing);
  const want = rangeOf(me, content);
  const slack = toSubunits(RANGE_SLACK);
  const radial = distance > want + slack ? 1 : distance < want - slack ? -1 : 0;
  const circle = percentOf(brain.strafe * ONE, STRAFE_PERCENT);
  let x = ux * radial - div(uy * circle, ONE);
  let y = uy * radial + div(ux * circle, ONE);
  const fromCentre = lengthOf(me.x, me.y);
  const room = edgeOf(state, rules) - toSubunits(rules.minds.edgeMargin);
  if (fromCentre > 0 && fromCentre > room) {
    const push = Math.min(EDGE_PUSH_MOST * ONE, div((fromCentre - room) * ONE, toSubunits(EDGE_PUSH_UNITS)));
    x -= div(me.x * push, fromCentre);
    y -= div(me.y * push, fromCentre);
  }
  const size = toSubunits(rules.island.body);
  for (const thing of state.things) {
    if (thing.side === side || !LINGERING.has(thing.shape)) continue;
    if (lengthOf(me.x - thing.x, me.y - thing.y) >= thing.radius + size) continue;
    const away = unitOf(me.x - thing.x, me.y - thing.y);
    if (!away) continue;
    x += ZONE_PUSH * away[0];
    y += ZONE_PUSH * away[1];
  }
  brain.walk = directionOf(x, y);
}

/** Whether the body can dash on the next step. */
const canDash = (body: Body): boolean => !isBusy(body) && body.dashCooldown <= 1;

/** The dash direction that steps aside from something coming along (vx, vy): sideways, towards the centre. */
function sidestep(me: Body, vx: number, vy: number): number {
  const towardCentre = -vy * -me.x + vx * -me.y;
  const sign = towardCentre >= 0 ? 1 : -1;
  return directionOf(-vy * sign, vx * sign) ?? me.facing;
}

type Threat = { readonly x: number; readonly y: number; readonly vx: number; readonly vy: number; readonly size: number; readonly windup: boolean; readonly see: () => void };

/** The other side's shots, wind-up and lunge that the mind has not judged yet. */
function threatsTo(state: ArenaState, side: Side, brain: Brain): Threat[] {
  const target = state.bodies[otherSide(side)];
  const shots = state.things.filter((thing) => thing.side !== side && SHOTS.has(thing.shape));
  brain.seen = brain.seen.filter((id) => shots.some((thing) => thing.id === id));
  if (!target.windup) brain.windupSeen = false;
  if (!target.lunge) brain.lungeSeen = false;
  const threats: Threat[] = shots
    .filter((thing) => !brain.seen.includes(thing.id))
    .map((thing) => ({ x: thing.x, y: thing.y, vx: thing.vx, vy: thing.vy, size: thing.radius, windup: false, see: () => brain.seen.push(thing.id) }));
  if (target.windup && !brain.windupSeen) {
    const speed = speedPerTick(WINDUP_THREAT_SPEED);
    const see = () => {
      brain.windupSeen = true;
    };
    threats.push({ x: target.x, y: target.y, vx: div(target.windup.x * speed, ONE), vy: div(target.windup.y * speed, ONE), size: toSubunits(WINDUP_THREAT_SIZE), windup: true, see });
  }
  if (target.lunge && !brain.lungeSeen) {
    const see = () => {
      brain.lungeSeen = true;
    };
    threats.push({ x: target.x, y: target.y, vx: target.lunge.vx, vy: target.lunge.vy, size: toSubunits(LUNGE_THREAT_SIZE), windup: false, see });
  }
  return threats;
}

/** Looks for a shot, lunge or wind-up about to hit, judges each once, and maybe plans a dash aside. */
function watch(state: ArenaState, side: Side, brain: Brain, rng: Rng, content: ArenaContent): void {
  const me = state.bodies[side];
  const target = state.bodies[otherSide(side)];
  const size = toSubunits(content.arena.island.body);
  for (const threat of threatsTo(state, side, brain)) {
    const rx = me.x - threat.x;
    const ry = me.y - threat.y;
    const speed2 = threat.vx * threat.vx + threat.vy * threat.vy;
    if (speed2 === 0) continue;
    const ticks = div(rx * threat.vx + ry * threat.vy, speed2);
    if (ticks < 0 || ticks > DODGE_LOOK_TICKS) continue;
    if (lengthOf(rx - threat.vx * ticks, ry - threat.vy * ticks) > size + threat.size + toSubunits(DODGE_SLACK)) continue;
    threat.see();
    if (rng.int(0, 99) >= brain.skill.dodgePercent || !canDash(me)) continue;
    brain.dodgeDir = sidestep(me, threat.vx, threat.vy);
    brain.dodgeAt = threat.windup && target.windup ? state.tick + Math.max(0, target.windup.ticks - WINDUP_DODGE_EARLY) : state.tick;
  }
}

/** Whether `button` would cast on the next step: unlocked, with a move, and cooled down. */
function ready(body: Body, button: Button, rules: ArenaRules): boolean {
  return body.level >= rules.buttons[button] && body.loadout[button] !== null && body.cooldowns[button] <= 1;
}

type Moment = { readonly me: Body; readonly target: Body; readonly distance: number; readonly threatened: boolean; readonly state: ArenaState; readonly size: number };

/** Whether `ability` would reach the other creature, or otherwise suits this moment. */
function suits(ability: Ability, { me, target, distance, threatened, state, size }: Moment): boolean {
  const units = toSubunits;
  switch (ability.shape) {
    case 'bolt':
    case 'spray':
    case 'snare':
      return distance < percentOf(units(ability.reach), SHOT_REACH_PERCENT);
    case 'cone':
      return distance < units(ability.radius) + percentOf(size, CONE_BODY_PERCENT);
    case 'burst':
      return distance < units(ability.radius) + size;
    case 'lunge':
      return distance < units(div(ability.speed * ability.ticks, TICKS_PER_SECOND)) + 2 * size;
    case 'wall':
      return distance < percentOf(units(div(ability.speed * ability.ticks, TICKS_PER_SECOND)), WALL_REACH_PERCENT);
    case 'puddle':
      return abs(distance - units(ability.reach)) < units(ability.radius) + percentOf(size, 30);
    case 'freeze':
      return target.status.rootTicks === 0 && abs(distance - units(ability.reach)) < units(ability.radius) + div(size, 2);
    case 'strike': {
      const near = units(ability.reach - ability.radius) - size;
      const far = units(ability.reach + (ability.count - 1) * ability.spacing + ability.radius) + size;
      return distance > near && distance < far;
    }
    case 'shield':
      return threatened || distance < units(SHIELD_NEAR);
    case 'zone':
      return distance < units(ability.radius) + div(size, 2) || (ability.healPercent > 0 && healthPermille(me) < HEAL_BELOW_PERMILLE && distance < units(HEAL_NEAR));
    case 'weather':
      return state.weather?.type !== (ability.move.setsWeather ?? ability.move.type);
  }
}

/** The button to press now, if any: a special or ultimate at a good moment, else the quick move in reach. */
function choose(state: ArenaState, side: Side, brain: Brain, rng: Rng, content: ArenaContent): Button | null {
  const me = state.bodies[side];
  const target = state.bodies[otherSide(side)];
  if (state.tick < brain.waitUntil || isBusy(me) || target.out || target.health === 0) return null;
  const rules = content.arena;
  const near = toSubunits(THREAT_NEAR);
  const threatened = state.things.some((thing) => thing.side !== side && SHOTS.has(thing.shape) && lengthOf(thing.x - me.x, thing.y - me.y) < near);
  const moment: Moment = { me, target, distance: lengthOf(target.x - me.x, target.y - me.y), threatened, state, size: toSubunits(rules.island.body) };
  const abilityOn = (button: Button): Ability | null => {
    const id = me.loadout[button];
    return id === null || id === undefined || !ready(me, button, rules) ? null : abilityOf(id, content);
  };
  for (const button of [2, 1] as const) {
    const ability = abilityOn(button);
    if (ability && suits(ability, moment) && rng.int(0, 999) < brain.skill.eagerPermille) return button;
  }
  const quick = abilityOn(0);
  return quick && suits(quick, moment) && rng.int(0, 99) < QUICK_PERCENT ? 0 : null;
}

/** The direction to face for `ability`: at the other creature, ahead of it for a shot, give or take the skill's aim error. */
function aimFor(state: ArenaState, side: Side, ability: Ability, brain: Brain, rng: Rng): number {
  const me = state.bodies[side];
  const target = state.bodies[otherSide(side)];
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const speed = ability.shape === 'bolt' || ability.shape === 'spray' || ability.shape === 'snare' ? speedPerTick(ability.speed) : 0;
  const lead = speed > 0 ? div(lengthOf(dx, dy) * brain.skill.leadPercent, speed * 100) : 0;
  const aim = unitOf(dx + target.vx * lead, dy + target.vy * lead) ?? directionVector(me.facing);
  const most = sineOf(brain.skill.aimErrorCosine);
  const sine = rng.int(-most, most);
  const [x, y] = turn(aim, sineOf(abs(sine)), sine);
  return directionOf(x, y) ?? me.facing;
}

/**
 * One tick of the computer's input for the creature on `side`. `rng` is the mind's own seeded RNG,
 * never the fight's, so the fight's rolls are the same whoever plays it. Its presses are always
 * legal: never for a locked, empty or cooling button, nor while its creature is busy.
 */
export function wildInput(state: ArenaState, side: Side, brain: Brain, rng: Rng, content: ArenaContent): ArenaInput {
  const me = state.bodies[side];
  if (state.outcome || me.out || me.health === 0) return ARENA_IDLE;
  if (state.tick >= brain.nextThink) {
    brain.nextThink = state.tick + brain.skill.thinkTicks;
    plan(state, side, brain, rng, content);
  }
  watch(state, side, brain, rng, content);
  if (brain.dodgeAt !== null && state.tick >= brain.dodgeAt) {
    brain.dodgeAt = null;
    if (canDash(me)) return { dir: brain.dodgeDir, dash: true, press: null };
  }
  const press = choose(state, side, brain, rng, content);
  const id = press === null ? null : me.loadout[press];
  if (press === null || id === null || id === undefined) return { dir: brain.walk, dash: false, press: null };
  brain.waitUntil = state.tick + div(brain.skill.reactTicks * rng.int(50, 150), 100);
  return { dir: aimFor(state, side, abilityOf(id, content), brain, rng), dash: false, press };
}

/**
 * A wild creature's loadout: for each unlocked button, its strongest learned move of that kind,
 * its own type first, then the most power, then the first learned.
 */
export function wildLoadout(species: string, level: number, content: ArenaContent): ArenaLoadout {
  const type = content.species.get(species)?.type;
  const learned = learnedBy({ species, level }, content);
  const [quick, special, ultimate] = ARENA_BUTTONS.map((button) => {
    if (!buttonUnlocked(button, level, content)) return null;
    const ranked = learned
      .flatMap((id) => {
        const move = content.moves.get(id);
        return move?.arena?.kind === ARENA_KINDS[button] ? [move] : [];
      })
      .toSorted((a, b) => Number(b.type === type) - Number(a.type === type) || b.power - a.power);
    return ranked[0]?.id ?? null;
  });
  return [quick ?? null, special ?? null, ultimate ?? null];
}

/** Sees one step of a mind fight: the state before it, what the step gave, and both minds' inputs. */
export type MindStep = (state: ArenaState, step: ArenaStepResult, inputs: ArenaInputs) => void;

/**
 * A whole fight between two minds, from `setup` to its ending: each side's mind has its own RNG,
 * seeded from the fight's seed and its side. `visit` sees every step.
 */
export function mindFight(setup: ArenaSetup, minds: readonly [ArenaMindName, ArenaMindName], content: ArenaContent, visit?: MindStep): ArenaState {
  let state = arenaStart(setup, content);
  const brains = [createBrain(minds[0], content.arena), createBrain(minds[1], content.arena)] as const;
  const rngs = [createRng(`mind:0:${setup.seed}`), createRng(`mind:1:${setup.seed}`)] as const;
  while (!state.outcome) {
    const inputs: ArenaInputs = [wildInput(state, 0, brains[0], rngs[0], content), wildInput(state, 1, brains[1], rngs[1], content)];
    const step = arenaStep(state, inputs, content);
    visit?.(state, step, inputs);
    state = step.state;
  }
  return state;
}
