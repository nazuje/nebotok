import { battleCreature, damageOf } from '../battle/damage.ts';
import type { BattleCreature, Effectiveness } from '../battle/state.ts';
import type { ArenaIslandRules } from '../content.ts';
import { ONE, div, lengthOf, percentOf, speedPerTick, toSubunits, unitOf } from './fixed.ts';
import type { ArenaContent } from './rules.ts';
import { inGrace, otherSide, type Body, type Side } from './state.ts';
import { rollOf, type Working } from './working.ts';

/**
 * Hits, knocks, status effects and heals: what abilities do to bodies. A hit's damage is core
 * `damageOf`, the same maths as turn battles with the island's weather, times the shape's share.
 */

/** A slowed body stays slowed this long after it leaves a puddle or a slowing zone. */
export const SLOW_HOLD_TICKS = 12;

/**
 * Knock speed in arena units a second for a body with `healthLeftPermille` of its health:
 * `base × (knockBasePercent + knockLostPercent × share of health lost)`.
 */
export function knockFor(base: number, healthLeftPermille: number, island: ArenaIslandRules): number {
  const lost = 1000 - Math.max(0, Math.min(1000, healthLeftPermille));
  return div(base * (island.knockBasePercent * 1000 + island.knockLostPercent * lost), 100_000);
}

export const healthPermille = (body: Body): number => div(body.health * 1000, body.maxHealth);

export function creatureOf(body: Body, content: ArenaContent): BattleCreature {
  const species = content.species.get(body.species);
  if (!species) throw new RangeError(`arena: no species "${body.species}"`);
  return battleCreature(body.id, species, body.level);
}

/** One hit of `by`'s move on the other body: `sharePercent` of a full hit, knocked `knock` along (dx, dy). */
export type Hit = {
  readonly by: Side;
  readonly move: string;
  readonly sharePercent: number;
  readonly knock: number;
  readonly dx: number;
  readonly dy: number;
};

/**
 * Pushes the body on `side` along (dx, dy) with `base` knock, grown by the health it had lost at
 * the start of the step, and starts its tumble. Returns the knock in arena units a second. The
 * step holds every body to the top speed once all hits have landed.
 */
export function knockBody(work: Working, side: Side, base: number, dx: number, dy: number): number {
  if (base <= 0) return 0;
  const { island } = work.content.arena;
  const body = work.bodies[side];
  const knock = knockFor(base, work.healthAtStart[side], island);
  const unit = unitOf(dx, dy);
  if (unit) {
    const speed = speedPerTick(knock);
    body.vx += div(unit[0] * speed, ONE);
    body.vy += div(unit[1] * speed, ONE);
  }
  body.knockedTicks = island.knockedTicks;
  return knock;
}

/** Takes `damage` from the body on `side` (less with the turtle setting), never below 0, and says so. */
function hurt(work: Working, side: Side, by: Side, move: string, damage: number, effectiveness: Effectiveness, knock: number): void {
  const body = work.bodies[side];
  const easier = work.content.arena.easier.damageTakenPercent;
  const taken = damage > 0 && body.turtle ? Math.max(1, percentOf(damage, easier)) : damage;
  const before = body.health;
  body.health = Math.max(0, before - taken);
  work.events.push({ kind: 'hit', side, by, move, damage: taken, health: body.health, effectiveness, knock, x: body.x, y: body.y });
  if (before > 0 && body.health === 0) work.events.push({ kind: 'fainted', side });
}

/**
 * The shield on `side` takes a hit (or a touch) instead: it ends, throws `reflectPercent` of the
 * hit's `damage` back and knocks the other body away.
 */
export function block(work: Working, side: Side, damage: number): void {
  const body = work.bodies[side];
  const by = otherSide(side);
  const other = work.bodies[by];
  const { shieldMove, reflectPercent, shieldKnock } = body.status;
  body.status = { ...body.status, shieldTicks: 0, shieldMove: null, reflectPercent: 0, shieldKnock: 0 };
  work.events.push({ kind: 'blocked', side, by });
  if (shieldMove === null || inGrace(other)) return;
  const knock = knockBody(work, by, shieldKnock, other.x - body.x, other.y - body.y);
  const back = damage > 0 && reflectPercent > 0 ? Math.max(1, percentOf(damage, reflectPercent)) : 0;
  hurt(work, by, side, shieldMove, back, 'normal', knock);
}

/**
 * Lands `hit` on the other side's body, unless a shield takes it or the body is in its grace.
 * Returns whether it landed, so a shape adds its status effects only then. A body that fainted
 * earlier in the step is still hit: the fight ends with the step, and no side's hit goes first.
 */
export function strike(work: Working, hit: Hit): boolean {
  const side = otherSide(hit.by);
  const target = work.bodies[side];
  if (target.out || inGrace(target)) return false;
  const { content } = work;
  const move = content.moves.get(hit.move);
  if (!move) throw new RangeError(`arena: no move "${hit.move}"`);
  const field = work.weather ? { type: work.weather.type, turnsLeft: null } : null;
  const roll = move.power > 0 ? rollOf(work) : 100;
  const full = damageOf(content, creatureOf(work.bodies[hit.by], content), creatureOf(target, content), move, field, roll);
  const damage = move.power > 0 ? Math.max(1, percentOf(full.damage, hit.sharePercent)) : 0;
  if (target.status.shieldTicks > 0) {
    block(work, side, damage);
    return false;
  }
  const knock = knockBody(work, side, hit.knock, hit.dx, hit.dy);
  hurt(work, side, hit.by, hit.move, damage, full.effectiveness, knock);
  return true;
}

/** Slows the body on `side` to `percent` of its walk cap while it stands in a slowing zone, and a little after. */
export function slowBody(work: Working, side: Side, percent: number): void {
  if (percent >= 100) return;
  const body = work.bodies[side];
  const { status } = body;
  const starting = status.slowTicks === 0;
  body.status = { ...status, slowPercent: starting ? percent : Math.min(status.slowPercent, percent), slowTicks: Math.max(status.slowTicks, SLOW_HOLD_TICKS) };
  if (starting) work.events.push({ kind: 'status', side, status: 'slow', ticks: SLOW_HOLD_TICKS });
}

/**
 * Roots the body on `side`: it cannot walk, dash or cast for `ticks`. It stands still from its
 * next move on, so a knock in the same step lands the same before or after the root.
 */
export function rootBody(work: Working, side: Side, ticks: number): void {
  if (ticks <= 0) return;
  const body = work.bodies[side];
  body.status = { ...body.status, rootTicks: Math.max(body.status.rootTicks, ticks) };
  work.events.push({ kind: 'status', side, status: 'root', ticks });
}

/** Asks to pull the body on `side` `units` arena units towards the other body; `settlePulls` moves it. */
export function pullBody(work: Working, side: Side, units: number): void {
  if (units > 0) work.pulls.push({ side, units });
}

/**
 * Makes the step's pulls, all measured from where the bodies stand before any of them moves, and
 * never into the other body: when both are pulled, each gets half the room between them.
 */
export function settlePulls(work: Working): void {
  const [a, b] = work.bodies;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const unit = unitOf(dx, dy);
  const room = lengthOf(dx, dy) - 2 * toSubunits(work.content.arena.island.body);
  const share = work.pulls.length > 1 ? div(room, 2) : room;
  const moves = work.pulls.map(({ side, units }) => ({ side, distance: Math.min(toSubunits(units), share) }));
  work.pulls.length = 0;
  if (!unit) return;
  for (const { side, distance } of moves) {
    if (distance <= 0) continue;
    // Side 0 is pulled along the line towards side 1, side 1 the other way.
    const sign = side === 0 ? 1 : -1;
    const body = work.bodies[side];
    body.x += sign * div(unit[0] * distance, ONE);
    body.y += sign * div(unit[1] * distance, ONE);
    work.events.push({ kind: 'status', side, status: 'pull', ticks: 0 });
  }
}

/** Raises a shield on `side` for `ticks`, with its move's reflect share and knock. */
export function shieldBody(work: Working, side: Side, move: string, ticks: number, reflectPercent: number, knock: number): void {
  const body = work.bodies[side];
  body.status = { ...body.status, shieldTicks: ticks, shieldMove: move, reflectPercent, shieldKnock: knock };
  work.events.push({ kind: 'status', side, status: 'shield', ticks });
}

/** Gives the step's heals, after all its hits, so a heal and a hit in one step never depend on which came first. */
export function giveHeals(work: Working): void {
  for (const { side, amount } of work.heals) {
    const body = work.bodies[side];
    const given = Math.min(amount, body.maxHealth - body.health);
    if (body.health === 0 || body.out || given <= 0) continue;
    body.health += given;
    work.events.push({ kind: 'healed', side, amount: given, health: body.health });
  }
  work.heals.length = 0;
}
