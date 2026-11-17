import { createRng, type Rng } from '@nebotok/core';
import { alive } from './arena-abilities.ts';
import { ARENA, type Archetype } from './arena-kits.ts';
import { fighterOf, healthShare, other, type Action, type ArenaState, type Fighter, type Intent, type Side } from './arena-state.ts';

/**
 * The wild creature's mind, also used (with a sharper skill) as the bot that plays your side when
 * measuring. It keeps its kit's favourite range and strafes, stays off the rim, leads its shots,
 * dashes aside from some shots and wind-ups, and saves its big abilities for a good moment.
 */

export type Skill = {
  /** Ticks between rethinking where to walk. */
  readonly think: number;
  /** Chance of dashing aside from a dangerous shot or wind-up. */
  readonly dodge: number;
  /** Largest aim error, radians. */
  readonly aimError: number;
  /** How much of the target's movement it leads its shots by, 0 to 1. */
  readonly lead: number;
  /** Ticks it waits after an ability before the next. */
  readonly react: number;
  /** Chance per tick of starting a ready second or third ability when the moment is right. */
  readonly eager: number;
};

export const WILD_SKILL: Skill = { think: 10, dodge: 0.35, aimError: 0.14, lead: 0.5, react: 14, eager: 0.04 };
export const WILD_EASIER: Skill = { think: 16, dodge: 0.15, aimError: 0.24, lead: 0.2, react: 26, eager: 0.025 };
/** The measuring bot: a quick, steady player who dodges half the time. */
export const BOT_SKILL: Skill = { think: 8, dodge: 0.5, aimError: 0.08, lead: 0.6, react: 10, eager: 0.05 };

/** The range each kit likes to fight at. */
const RANGE: Readonly<Record<Archetype, number>> = { gale: 330, rain: 420, sun: 150 };
const EDGE_MARGIN = 180;

export type Brain = { readonly side: Side; readonly rng: Rng; readonly skill: Skill; strafe: number; nextThink: number; mx: number; my: number; waitUntil: number; readonly seen: Set<number>; dodgeAt: number; dodgeX: number; dodgeY: number };

export function createBrain(side: Side, seed: number, skill: Skill): Brain {
  return { side, rng: createRng(`arena-brain:${side}:${seed}`), skill, strafe: 1, nextThink: 60, mx: 0, my: 0, waitUntil: 60, seen: new Set(), dodgeAt: -1, dodgeX: 0, dodgeY: 0 };
}

const unit = (x: number, y: number): { x: number; y: number } => {
  const length = Math.hypot(x, y);
  return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
};

/** Where to walk: towards its range, round the target, away from the rim and out of enemy zones. */
function plan(state: ArenaState, brain: Brain, me: Fighter, target: Fighter): void {
  const { rng } = brain;
  if (rng.next() < 0.15) brain.strafe = -brain.strafe;
  const dx = target.x - me.x;
  const dy = target.y - me.y;
  const distance = Math.hypot(dx, dy) || 1;
  const want = RANGE[me.archetype];
  const radial = distance > want + 60 ? 1 : distance < want - 60 ? -1 : 0;
  let x = (dx / distance) * radial - (dy / distance) * brain.strafe * 0.8;
  let y = (dy / distance) * radial + (dx / distance) * brain.strafe * 0.8;
  const fromCentre = Math.hypot(me.x, me.y);
  const room = state.storm.radius - EDGE_MARGIN;
  if (fromCentre > room) {
    const push = Math.min(3, (fromCentre - room) / 60);
    x -= (me.x / fromCentre) * push;
    y -= (me.y / fromCentre) * push;
  }
  for (const zone of state.zones) {
    if (zone.side === me.side || zone.kind === 'wall') continue;
    const zx = me.x - zone.x;
    const zy = me.y - zone.y;
    const away = Math.hypot(zx, zy);
    if (away < zone.radius + ARENA.body) {
      x += (zx / (away || 1)) * 2;
      y += (zy / (away || 1)) * 2;
    }
  }
  const way = unit(x, y);
  brain.mx = way.x;
  brain.my = way.y;
}

/** The dash direction that dodges something coming along (vx, vy): sideways, towards the middle. */
function sidestep(me: Fighter, vx: number, vy: number): { x: number; y: number } {
  const way = unit(-vy, vx);
  const toward = way.x * -me.x + way.y * -me.y;
  return toward >= 0 ? way : { x: -way.x, y: -way.y };
}

/** Looks for a shot, lunge or wind-up about to hit, and maybe plans a dash aside. */
function watch(state: ArenaState, brain: Brain, me: Fighter, target: Fighter): void {
  const threats: { id: number; vx: number; vy: number; x: number; y: number; reach: number }[] = [];
  for (const shot of state.shots) if (shot.side !== me.side && !shot.treat) threats.push({ id: shot.id, vx: shot.vx, vy: shot.vy, x: shot.x, y: shot.y, reach: shot.radius });
  if (target.windup) threats.push({ id: -target.windup.start - 1, vx: target.windup.ax * 900, vy: target.windup.ay * 900, x: target.x, y: target.y, reach: 60 });
  if (target.lungeUntil > state.tick) threats.push({ id: -1_000_000 - target.lungeUntil, vx: target.lungeX * 1350, vy: target.lungeY * 1350, x: target.x, y: target.y, reach: 10 });
  for (const threat of threats) {
    if (brain.seen.has(threat.id)) continue;
    const rx = me.x - threat.x;
    const ry = me.y - threat.y;
    const speed2 = threat.vx * threat.vx + threat.vy * threat.vy || 1;
    const time = (rx * threat.vx + ry * threat.vy) / speed2;
    if (time < 0 || time > 0.5) continue;
    const miss = Math.hypot(rx - threat.vx * time, ry - threat.vy * time);
    if (miss > ARENA.body + threat.reach + 12) continue;
    brain.seen.add(threat.id);
    if (brain.rng.next() >= brain.skill.dodge || me.dashReady > state.tick) continue;
    const way = sidestep(me, threat.vx, threat.vy);
    const windup = target.windup;
    brain.dodgeAt = threat.id < 0 && windup && threat.id > -1_000_000 ? windup.until - 10 : state.tick;
    brain.dodgeX = way.x;
    brain.dodgeY = way.y;
  }
}

/** Whether now is a good moment for the second or third ability. */
function goodMoment(me: Fighter, target: Fighter, slot: number, distance: number, threatened: boolean): boolean {
  const kind = me.kit[slot]?.kind;
  if (kind === 'lunge') return distance < 420;
  if (kind === 'wall') return distance < 520;
  if (kind === 'puddle') return distance < 460;
  if (kind === 'freeze') return distance < 380 && target.rootUntil === 0;
  if (kind === 'shield') return threatened || distance < 260;
  if (kind === 'zone') return distance < 230 || (healthShare(me) < 0.5 && distance < 400);
  return false;
}

function inRange(me: Fighter, distance: number): boolean {
  const basic = me.kit[0];
  if (!basic) return false;
  return basic.kind === 'cone' ? distance < basic.radius + ARENA.body * 0.6 : distance < basic.reach * 0.9;
}

function choose(state: ArenaState, brain: Brain, me: Fighter, target: Fighter, distance: number): Action[] {
  if (state.tick < brain.waitUntil || me.windup || !alive(target)) return [];
  const threatened = state.shots.some((shot) => shot.side !== me.side && Math.hypot(shot.x - me.x, shot.y - me.y) < 300);
  for (const slot of [2, 1]) {
    if (slot >= state.options.abilities || state.tick < (me.ready[slot] ?? 0)) continue;
    if (goodMoment(me, target, slot, distance, threatened) && brain.rng.next() < brain.skill.eager) return [slot === 2 ? 'a2' : 'a1'];
  }
  if (state.tick >= (me.ready[0] ?? 0) && inRange(me, distance) && brain.rng.next() < 0.35) return ['a0'];
  return [];
}

function aimAt(brain: Brain, me: Fighter, target: Fighter): number {
  const basic = me.kit[0];
  const speed = basic?.kind === 'bolt' ? basic.speed : 0;
  const distance = Math.hypot(target.x - me.x, target.y - me.y);
  const time = speed > 0 ? (distance / speed) * brain.skill.lead : 0;
  const x = target.x + target.vx * time - me.x;
  const y = target.y + target.vy * time - me.y;
  return Math.atan2(y, x) + (brain.rng.next() * 2 - 1) * brain.skill.aimError;
}

/** One tick of the mind's input. */
export function think(state: ArenaState, brain: Brain): Intent {
  const me = fighterOf(state, brain.side);
  const target = fighterOf(state, other(brain.side));
  if (!alive(me)) return { mx: 0, my: 0, face: null, actions: [] };
  if (state.tick >= brain.nextThink) {
    brain.nextThink = state.tick + brain.skill.think;
    plan(state, brain, me, target);
  }
  watch(state, brain, me, target);
  if (brain.dodgeAt >= 0 && state.tick >= brain.dodgeAt) {
    brain.dodgeAt = -1;
    return { mx: brain.dodgeX, my: brain.dodgeY, face: null, actions: ['dash'] };
  }
  const distance = Math.hypot(target.x - me.x, target.y - me.y);
  const actions = choose(state, brain, me, target, distance);
  if (actions.length > 0) brain.waitUntil = state.tick + Math.round(brain.skill.react * (0.5 + brain.rng.next()));
  return { mx: brain.mx, my: brain.my, face: aimAt(brain, me, target), actions };
}
