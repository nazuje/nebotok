import { ONE, div, directionVector, lengthOf, percentOf, permilleOf, speedPerSecond, speedPerTick, toSubunits } from './fixed.ts';
import type { ArenaIslandRules, ArenaRules } from '../content.ts';
import type { ArenaContent } from './rules.ts';
import { ARENA_SIDES, type ArenaEvent, type ArenaInput, type ArenaInputs, type ArenaOutcome, type ArenaState, type ArenaStepResult, type Body, type Side } from './state.ts';
import { stepStorm } from './storm.ts';

/**
 * One fixed step of an arena fight, in the order of docs/arena.md "The step": timers tick down,
 * then storm, steer and act (side 0, then side 1), move, collide, the top speed, edge and ending.
 * Pure and whole-number: the same state and inputs give the same next state on every engine, and
 * the rules are point-symmetric, so a mirrored fight ends exactly mirrored.
 */

type MovingBody = { -readonly [Key in keyof Body]: Body[Key] };

/** Steering is this strong while tumbling. */
const TUMBLE_STEER_PERCENT = 30;
/** Overlapping bodies share this much of their closing speed. */
const SHOVE_PERCENT = 70;
/** A dash bumps the other body only when they close faster than this, in arena units a second. */
const BUMP_CLOSING = 300;
/** The lip: walking and dashing stop this share of a body inside the edge. */
const LIP_PERCENT = 35;
/** Bodies carry no health yet, so every knock is a full-health knock. */
const FULL_HEALTH_PERMILLE = 1000;

/**
 * Knock speed in arena units a second for a body with `healthLeftPermille` of its health:
 * `base × (knockBasePercent + knockLostPercent × share of health lost)`.
 */
export function knockFor(base: number, healthLeftPermille: number, island: ArenaIslandRules): number {
  const lost = 1000 - Math.max(0, Math.min(1000, healthLeftPermille));
  return div(base * (island.knockBasePercent * 1000 + island.knockLostPercent * lost), 100_000);
}

function tickDown(body: Body): MovingBody {
  return {
    ...body,
    dashTicks: Math.max(0, body.dashTicks - 1),
    dashCooldown: Math.max(0, body.dashCooldown - 1),
    knockedTicks: Math.max(0, body.knockedTicks - 1),
  };
}

/** Scales the body's velocity down to at most `limit` (1/256 arena units a tick). */
function limitSpeed(body: MovingBody, limit: number): void {
  const speed = lengthOf(body.vx, body.vy);
  if (speed <= limit) return;
  // Dividing by one more than the rounded-down length keeps the result at or under the limit.
  body.vx = div(body.vx * limit, speed + 1);
  body.vy = div(body.vy * limit, speed + 1);
}

function steer(body: MovingBody, input: ArenaInput): void {
  if (body.out || input.dir === null) return;
  body.facing = input.dir;
}

function act(body: MovingBody, side: Side, input: ArenaInput, rules: ArenaRules, events: ArenaEvent[]): void {
  if (body.out || !input.dash || body.dashCooldown > 0) return;
  body.dashDir = input.dir ?? body.facing;
  body.dashTicks = rules.dash.ticks;
  body.dashCooldown = rules.dash.cooldownTicks;
  events.push({ kind: 'dashed', side, dir: body.dashDir });
}

/** Walking with friction: the stick pushes towards the walk cap, and letting go plants the feet. */
function walk(body: MovingBody, input: ArenaInput, island: ArenaIslandRules): void {
  const friction = island.frictionPermille;
  const before = lengthOf(body.vx, body.vy);
  const tumbling = body.knockedTicks > 0;
  if (input.dir !== null) {
    // At steady speed the push and the friction cancel exactly at the walk cap.
    const push = div(body.walkCap * (1000 - friction), friction);
    const accel = tumbling ? percentOf(push, TUMBLE_STEER_PERCENT) : push;
    const [dx, dy] = directionVector(input.dir);
    body.vx += div(dx * accel, ONE);
    body.vy += div(dy * accel, ONE);
  }
  body.vx = permilleOf(body.vx, friction);
  body.vy = permilleOf(body.vy, friction);
  if (input.dir === null && !tumbling) {
    body.vx = permilleOf(body.vx, island.plantedPermille);
    body.vy = permilleOf(body.vy, island.plantedPermille);
  }
  limitSpeed(body, Math.max(body.walkCap, permilleOf(before, friction)));
}

function move(body: MovingBody, input: ArenaInput, rules: ArenaRules): void {
  if (body.out) return;
  if (body.dashTicks > 0) {
    const [dx, dy] = directionVector(body.dashDir);
    const speed = speedPerTick(rules.dash.speed);
    body.vx = div(dx * speed, ONE);
    body.vy = div(dy * speed, ONE);
  } else walk(body, input, rules.island);
  body.x += body.vx;
  body.y += body.vy;
}

function bump(dasher: MovingBody, target: MovingBody, side: Side, nx: number, ny: number, island: ArenaIslandRules, events: ArenaEvent[]): void {
  const knock = knockFor(island.bumpKnock, FULL_HEALTH_PERMILLE, island);
  const speed = speedPerTick(knock);
  dasher.dashTicks = 0;
  target.vx += div(nx * speed, ONE);
  target.vy += div(ny * speed, ONE);
  target.knockedTicks = island.knockedTicks;
  events.push({ kind: 'bumped', side, knock, x: div(dasher.x + target.x, 2), y: div(dasher.y + target.y, 2) });
}

/** Overlapping bodies push apart along the line between their centres; a dash into the other bumps it. */
function collide(a: MovingBody, b: MovingBody, island: ArenaIslandRules, events: ArenaEvent[]): void {
  if (a.out || b.out) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = lengthOf(dx, dy);
  const reach = 2 * toSubunits(island.body);
  if (distance >= reach) return;
  // Two bodies on the same spot part along x; that choice is still point-symmetric.
  const nx = distance > 0 ? div(dx * ONE, distance) : ONE;
  const ny = distance > 0 ? div(dy * ONE, distance) : 0;
  const half = div(reach - distance, 2);
  const px = div(nx * half, ONE);
  const py = div(ny * half, ONE);
  a.x -= px;
  a.y -= py;
  b.x += px;
  b.y += py;
  const closing = div((a.vx - b.vx) * nx + (a.vy - b.vy) * ny, ONE);
  if (closing <= 0) return;
  const shove = percentOf(closing, SHOVE_PERCENT);
  const sx = div(nx * shove, ONE);
  const sy = div(ny * shove, ONE);
  a.vx -= sx;
  a.vy -= sy;
  b.vx += sx;
  b.vy += sy;
  if (closing < speedPerTick(BUMP_CLOSING)) return;
  const aDashing = a.dashTicks > 0;
  const bDashing = b.dashTicks > 0;
  if (aDashing) bump(a, b, 1, nx, ny, island, events);
  if (bDashing) bump(b, a, 0, -nx, -ny, island, events);
}

/** The lip holds walkers and dashers back, so only a knock carries a body over; one more than a body past the edge falls. */
function edge(body: MovingBody, side: Side, radius: number, island: ArenaIslandRules, events: ArenaEvent[]): void {
  if (body.out) return;
  const distance = lengthOf(body.x, body.y);
  const size = toSubunits(island.body);
  if (distance > radius + size) {
    body.out = true;
    events.push({ kind: 'ringOut', side });
    return;
  }
  const lip = radius - percentOf(size, LIP_PERCENT);
  const teetering = distance > lip && distance > 0;
  if (teetering && !body.teetering) events.push({ kind: 'teeter', side });
  body.teetering = teetering;
  if (!teetering || body.knockedTicks > 0) return;
  const ox = div(body.x * ONE, distance);
  const oy = div(body.y * ONE, distance);
  const outward = div(body.vx * ox + body.vy * oy, ONE);
  if (outward <= 0) return;
  body.vx -= div(ox * outward, ONE);
  body.vy -= div(oy * outward, ONE);
  // Back onto the lip as well, or a held stick would creep a little further out every tick.
  body.dashTicks = 0;
  body.x = div(ox * lip, ONE);
  body.y = div(oy * lip, ONE);
}

/** A ring-out ends the fight, both at once a draw; so does the time limit while bodies carry no health. */
function ending(bodies: readonly [Body, Body], tick: number, island: ArenaIslandRules): ArenaOutcome | null {
  const [first, second] = bodies;
  if (first.out || second.out) {
    const winner = first.out && second.out ? null : first.out ? 1 : 0;
    return { winner, how: 'ringOut', tick };
  }
  if (tick >= island.limitTicks) return { winner: null, how: 'timeUp', tick };
  return null;
}

/** Moves the fight on one tick with each side's input. A finished fight steps no further. */
export function arenaStep(state: ArenaState, inputs: ArenaInputs, content: ArenaContent): ArenaStepResult {
  if (state.outcome) return { state, events: [] };
  const rules = content.arena;
  const { island } = rules;
  const tick = state.tick + 1;
  const events: ArenaEvent[] = [];
  const bodies: [MovingBody, MovingBody] = [tickDown(state.bodies[0]), tickDown(state.bodies[1])];
  const { radius, storm } = stepStorm(tick, state.radius, state.storm, rules, events);
  for (const side of ARENA_SIDES) {
    steer(bodies[side], inputs[side]);
    act(bodies[side], side, inputs[side], rules, events);
  }
  for (const side of ARENA_SIDES) move(bodies[side], inputs[side], rules);
  collide(bodies[0], bodies[1], island, events);
  const top = speedPerTick(island.topSpeed);
  for (const body of bodies) limitSpeed(body, top);
  for (const side of ARENA_SIDES) edge(bodies[side], side, radius, island, events);
  return { state: { tick, rng: state.rng, radius, storm, bodies, outcome: ending(bodies, tick, island) }, events };
}

/** A body's speed in whole arena units a second, for tests and logs. */
export const bodySpeed = (body: Body): number => speedPerSecond(lengthOf(body.vx, body.vy));
