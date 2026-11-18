import { ONE, abs, div, percentOf, toSubunits } from './fixed.ts';
import { abilityOf, flightTicks, within, type AbilityOf, type Ability } from './abilities.ts';
import { pullBody, rootBody, slowBody, strike } from './hits.ts';
import { otherSide } from './state.ts';
import { nextIdOf, type MovingThing, type Working } from './working.ts';

/**
 * Shots fly and hit; zones, walls and marks arm, pulse and end. Things go in the order they were
 * made, and a thing is gone once its ticks reach 0.
 */

/** A puddle slows a body whose centre is within its radius plus this share of a body; a freeze or a zone's pulse, this share. */
const PUDDLE_BODY_PERCENT = 30;
const FREEZE_BODY_PERCENT = 50;

const isShot = (thing: MovingThing): boolean => thing.shape === 'bolt' || thing.shape === 'spray' || thing.shape === 'snare';

/** A shield sends a shot back: it turns round, flies its whole flight again, and is the shield's side's now. */
function reflect(work: Working, thing: MovingThing, ability: Ability): void {
  const side = otherSide(thing.side);
  thing.side = side;
  thing.vx = -thing.vx;
  thing.vy = -thing.vy;
  thing.dx = -thing.dx;
  thing.dy = -thing.dy;
  thing.ticks = ability.shape === 'bolt' || ability.shape === 'spray' || ability.shape === 'snare' ? flightTicks(ability.reach, ability.speed) : 1;
  thing.id = nextIdOf(work);
  work.events.push({ kind: 'reflected', side, thing: thing.id });
}

/** A shot that touches the other body hits it: a snare also roots or pulls. */
function landShot(work: Working, thing: MovingThing, ability: Ability): void {
  if (ability.shape !== 'bolt' && ability.shape !== 'spray' && ability.shape !== 'snare') return;
  const hit = { by: thing.side, move: thing.move, sharePercent: ability.sharePercent, knock: ability.knock, dx: thing.vx, dy: thing.vy };
  if (!strike(work, hit) || ability.shape !== 'snare') return;
  const side = otherSide(thing.side);
  rootBody(work, side, ability.rootTicks);
  pullBody(work, side, ability.pull);
}

/** Moves a shot on. Returns whether it is still flying, and whether a shield sent it back. */
function flyShot(work: Working, thing: MovingThing): 'flying' | 'reflected' | 'spent' {
  thing.x += thing.vx;
  thing.y += thing.vy;
  const side = otherSide(thing.side);
  const target = work.bodies[side];
  const touching = !target.out && within(target.x - thing.x, target.y - thing.y, toSubunits(work.content.arena.island.body) + thing.radius);
  if (touching) {
    const ability = abilityOf(thing.move, work.content);
    if (target.status.shieldTicks > 0) {
      reflect(work, thing, ability);
      return 'reflected';
    }
    landShot(work, thing, ability);
    thing.ticks = 0;
    return 'spent';
  }
  thing.ticks -= 1;
  return thing.ticks > 0 ? 'flying' : 'spent';
}

/** Every shot flies a tick. A reflected shot goes to the end of the list with its new id, so the list stays in id order. */
export function stepShots(work: Working): void {
  const kept: MovingThing[] = [];
  const reflected: MovingThing[] = [];
  for (const thing of work.things) {
    if (!isShot(thing)) {
      kept.push(thing);
      continue;
    }
    const flight = flyShot(work, thing);
    if (flight === 'flying') kept.push(thing);
    else if (flight === 'reflected') reflected.push(thing);
  }
  work.things = [...kept, ...reflected];
}

/** Whether a point is on a wall: within its thickness along its roll, and its half-width across. */
function onWall(wall: MovingThing, x: number, y: number, along: number, across: number): boolean {
  const rx = x - wall.x;
  const ry = y - wall.y;
  return abs(div(rx * wall.dx + ry * wall.dy, ONE)) <= along && abs(div(ry * wall.dx - rx * wall.dy, ONE)) <= across;
}

/** A wall rolls on, sweeps the other side's shots away and hits the other body once. */
function rollWall(work: Working, thing: MovingThing, ability: AbilityOf<'wall'>): void {
  thing.x += thing.vx;
  thing.y += thing.vy;
  const half = div(toSubunits(work.content.arena.wallThickness), 2);
  for (const shot of work.things) {
    if (isShot(shot) && shot.side !== thing.side && shot.ticks > 0 && onWall(thing, shot.x, shot.y, half + shot.radius, thing.radius + shot.radius)) shot.ticks = 0;
  }
  const size = toSubunits(work.content.arena.island.body);
  const target = work.bodies[otherSide(thing.side)];
  if (thing.touched || target.out || !onWall(thing, target.x, target.y, half + size, thing.radius + size)) return;
  thing.touched = true;
  strike(work, { by: thing.side, move: thing.move, sharePercent: ability.sharePercent, knock: ability.knock, dx: thing.dx, dy: thing.dy });
}

/** Whether the other body's centre is within the thing's radius plus `bodyPercent` of a body. */
function reaches(work: Working, thing: MovingThing, bodyPercent: number): boolean {
  const target = work.bodies[otherSide(thing.side)];
  const size = percentOf(toSubunits(work.content.arena.island.body), bodyPercent);
  return !target.out && within(target.x - thing.x, target.y - thing.y, thing.radius + size);
}

/** A puddle slows whoever stands in it, and hits the first time. */
function soak(work: Working, thing: MovingThing, ability: AbilityOf<'puddle'>): void {
  if (!reaches(work, thing, PUDDLE_BODY_PERCENT)) return;
  slowBody(work, otherSide(thing.side), ability.slowPercent);
  if (thing.touched) return;
  thing.touched = true;
  strike(work, { by: thing.side, move: thing.move, sharePercent: ability.sharePercent, knock: 0, dx: 0, dy: 0 });
}

/** A freeze, once formed, hits and roots whoever is inside. */
function freeze(work: Working, thing: MovingThing, ability: AbilityOf<'freeze'>): void {
  if (!reaches(work, thing, FREEZE_BODY_PERCENT)) return;
  if (strike(work, { by: thing.side, move: thing.move, sharePercent: ability.sharePercent, knock: 0, dx: 0, dy: 0 })) rootBody(work, otherSide(thing.side), ability.rootTicks);
}

/** A strike's mark lands: it hits a body within its radius and knocks it away from the mark. */
function land(work: Working, thing: MovingThing, ability: AbilityOf<'strike'>): void {
  if (!reaches(work, thing, 100)) return;
  const target = work.bodies[otherSide(thing.side)];
  const dx = target.x - thing.x;
  const dy = target.y - thing.y;
  const away = dx === 0 && dy === 0 ? [thing.dx, thing.dy] : [dx, dy];
  strike(work, { by: thing.side, move: thing.move, sharePercent: ability.sharePercent, knock: ability.knock, dx: away[0] ?? 0, dy: away[1] ?? 0 });
}

/** A zone slows whoever stands in it, if it slows; every pulse it hits them and heals its caster. */
function pulse(work: Working, thing: MovingThing, ability: AbilityOf<'zone'>): void {
  const inside = reaches(work, thing, FREEZE_BODY_PERCENT);
  if (inside) slowBody(work, otherSide(thing.side), ability.slowPercent);
  thing.pulseTicks -= 1;
  if (thing.pulseTicks > 0) return;
  thing.pulseTicks = work.content.arena.zonePulseTicks;
  const caster = work.bodies[thing.side];
  if (ability.healPercent > 0 && !caster.out && within(caster.x - thing.x, caster.y - thing.y, thing.radius)) {
    work.heals.push({ side: thing.side, amount: Math.max(1, percentOf(caster.maxHealth, ability.healPercent)) });
  }
  if (inside) strike(work, { by: thing.side, move: thing.move, sharePercent: ability.sharePercent, knock: 0, dx: 0, dy: 0 });
}

function stepZone(work: Working, thing: MovingThing): void {
  if (thing.armTicks > 0) {
    thing.armTicks -= 1;
    return;
  }
  const ability = abilityOf(thing.move, work.content);
  switch (ability.shape) {
    case 'wall':
      rollWall(work, thing, ability);
      break;
    case 'puddle':
      soak(work, thing, ability);
      break;
    case 'freeze':
      freeze(work, thing, ability);
      break;
    case 'strike':
      land(work, thing, ability);
      break;
    case 'zone':
      pulse(work, thing, ability);
      break;
    default:
      break;
  }
  thing.ticks -= 1;
}

/** Every zone, wall and mark takes its tick; then spent things, and shots a wall swept away, are gone. */
export function stepZones(work: Working): void {
  for (const thing of work.things) if (!isShot(thing)) stepZone(work, thing);
  work.things = work.things.filter((thing) => thing.ticks > 0);
}
