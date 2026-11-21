import { ONE, div, directionVector, lengthOf, limitSpeed, percentOf, permilleOf, speedPerSecond, speedPerTick, toSubunits } from './fixed.ts';
import type { ArenaIslandRules, ArenaRules } from '../content.ts';
import { finishWindup, isBusy, landInstants, landLunges, press } from './abilities.ts';
import { block, giveHeals, healthPermille, knockFor, settlePulls } from './hits.ts';
import type { ArenaContent } from './rules.ts';
import { ARENA_SIDES, inGrace, type ArenaEvent, type ArenaInput, type ArenaInputs, type ArenaOutcome, type ArenaState, type ArenaStepResult, type Body, type BodyStatus, type Side } from './state.ts';
import { stepStorm } from './storm.ts';
import { stepShots, stepZones } from './things.ts';
import { settleWeather, weatherTickDown } from './weather.ts';
import type { MovingBody, Working } from './working.ts';

/**
 * One fixed step of an arena fight, in the order of docs/arena.md "The step": timers tick down,
 * then storm, steer and act (side 0, then side 1), move, collide, the top speed, shots, zones,
 * edge and ending. Pure and whole-number: the same state and inputs give the same next state on
 * every engine, and the rules are point-symmetric, so a mirrored fight ends exactly mirrored.
 */

/** Steering is this strong while tumbling, and while winding up. */
const TUMBLE_STEER_PERCENT = 30;
const WINDUP_STEER_PERCENT = 40;
/** Overlapping bodies share this much of their closing speed. */
const SHOVE_PERCENT = 70;
/** A dash bumps the other body only when they close faster than this, in arena units a second. */
const BUMP_CLOSING = 300;
/** The lip: walking and dashing stop this share of a body inside the edge. */
const LIP_PERCENT = 35;
/** A lunge lands when the bodies are this many arena units from touching. */
const LUNGE_REACH = 14;

const down = (ticks: number): number => Math.max(0, ticks - 1);

function statusDown(status: BodyStatus): BodyStatus {
  if (status.slowTicks === 0 && status.rootTicks === 0 && status.shieldTicks === 0) return status;
  const slowTicks = down(status.slowTicks);
  const shieldTicks = down(status.shieldTicks);
  return {
    slowPercent: slowTicks > 0 ? status.slowPercent : 100,
    slowTicks,
    rootTicks: down(status.rootTicks),
    shieldTicks,
    shieldMove: shieldTicks > 0 ? status.shieldMove : null,
    reflectPercent: shieldTicks > 0 ? status.reflectPercent : 0,
    shieldKnock: shieldTicks > 0 ? status.shieldKnock : 0,
  };
}

function tickDown(body: Body): MovingBody {
  const [quick, special, ultimate] = body.cooldowns;
  const { windup, lunge } = body;
  return {
    ...body,
    dashTicks: down(body.dashTicks),
    dashCooldown: down(body.dashCooldown),
    knockedTicks: down(body.knockedTicks),
    cooldowns: quick + special + ultimate === 0 ? body.cooldowns : [down(quick), down(special), down(ultimate)],
    status: statusDown(body.status),
    windup: windup && { ...windup, ticks: down(windup.ticks) },
    lunge: lunge && lunge.ticks > 1 ? { ...lunge, ticks: lunge.ticks - 1 } : null,
    ...(body.graceTicks === undefined ? {} : { graceTicks: down(body.graceTicks) }),
  };
}

function steer(body: MovingBody, input: ArenaInput): void {
  if (body.out || input.dir === null || body.lunge) return;
  body.facing = input.dir;
}

function dash(body: MovingBody, side: Side, input: ArenaInput, rules: ArenaRules, events: ArenaEvent[]): void {
  if (!input.dash || isBusy(body) || body.dashCooldown > 0) return;
  body.dashDir = input.dir ?? body.facing;
  body.dashTicks = rules.dash.ticks;
  body.dashCooldown = rules.dash.cooldownTicks;
  events.push({ kind: 'dashed', side, dir: body.dashDir });
}

/** Casts a finished wind-up, then dashes and presses. */
function act(work: Working, side: Side, input: ArenaInput): void {
  const body = work.bodies[side];
  if (body.out) return;
  finishWindup(work, side);
  dash(body, side, input, work.content.arena, work.events);
  if (input.press !== null) press(work, side, input.press);
}

/** Walking with friction: the stick pushes towards the walk cap, and letting go plants the feet. */
function walk(body: MovingBody, input: ArenaInput, island: ArenaIslandRules): void {
  const friction = island.frictionPermille;
  const before = lengthOf(body.vx, body.vy);
  const tumbling = body.knockedTicks > 0;
  const cap = body.status.slowTicks > 0 ? percentOf(body.walkCap, body.status.slowPercent) : body.walkCap;
  if (input.dir !== null) {
    // At steady speed the push and the friction cancel exactly at the walk cap.
    const push = div(cap * (1000 - friction), friction);
    const tumbled = tumbling ? percentOf(push, TUMBLE_STEER_PERCENT) : push;
    const accel = body.windup ? percentOf(tumbled, WINDUP_STEER_PERCENT) : tumbled;
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
  limitSpeed(body, Math.max(cap, permilleOf(before, friction)));
}

/** Walks, or holds a lunge's or a dash's drive; a rooted body stands still. */
function move(body: MovingBody, input: ArenaInput, rules: ArenaRules): void {
  if (body.out) return;
  if (body.status.rootTicks > 0) {
    body.vx = 0;
    body.vy = 0;
    return;
  }
  if (body.lunge) {
    body.vx = body.lunge.vx;
    body.vy = body.lunge.vy;
  } else if (body.dashTicks > 0) {
    const [dx, dy] = directionVector(body.dashDir);
    const speed = speedPerTick(rules.dash.speed);
    body.vx = div(dx * speed, ONE);
    body.vy = div(dy * speed, ONE);
  } else walk(body, input, rules.island);
  body.x += body.vx;
  body.y += body.vy;
}

function bump(work: Working, dasher: MovingBody, side: Side, nx: number, ny: number): void {
  const { island } = work.content.arena;
  const target = work.bodies[side];
  if (inGrace(target)) return;
  const knock = knockFor(island.bumpKnock, work.healthAtStart[side], island);
  const speed = speedPerTick(knock);
  dasher.dashTicks = 0;
  target.vx += div(nx * speed, ONE);
  target.vy += div(ny * speed, ONE);
  target.knockedTicks = island.knockedTicks;
  work.events.push({ kind: 'bumped', side, knock, x: div(dasher.x + target.x, 2), y: div(dasher.y + target.y, 2) });
}

/**
 * Lunges within reach land; touching bodies meet any shield, push apart along the line between
 * their centres, and a dash into the other bumps it.
 */
function collide(work: Working): void {
  const [a, b] = work.bodies;
  if (a.out || b.out) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = lengthOf(dx, dy);
  const reach = 2 * toSubunits(work.content.arena.island.body);
  if (distance < reach + toSubunits(LUNGE_REACH)) landLunges(work);
  if (distance >= reach) return;
  const shielded = ARENA_SIDES.filter((side) => work.bodies[side].status.shieldTicks > 0);
  for (const side of shielded) block(work, side, 0);
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
  if (aDashing) bump(work, a, 1, nx, ny);
  if (bDashing) bump(work, b, 0, -nx, -ny);
}

/** At or above half its health a body is steady: the lip holds it even while it tumbles, so no knock carries it off. */
const isSteady = (body: Body): boolean => 2 * body.health >= body.maxHealth;

/**
 * The lip holds walkers, dashers and lungers back, and steady bodies even while they tumble, so
 * only a knock carries a body below half its health over; one more than a body past the edge
 * falls. A steady body gets that far only when the storm's edge passes it, not by its own motion
 * outwards, so the storm still drops a body at any health.
 */
function edge(body: MovingBody, side: Side, radius: number, island: ArenaIslandRules, events: ArenaEvent[]): void {
  if (body.out) return;
  const distance = lengthOf(body.x, body.y);
  const size = toSubunits(island.body);
  const steady = isSteady(body);
  const ox = distance > 0 ? div(body.x * ONE, distance) : 0;
  const oy = distance > 0 ? div(body.y * ONE, distance) : 0;
  const outward = div(body.vx * ox + body.vy * oy, ONE);
  if (distance > radius + size && !(steady && outward > 0)) {
    body.out = true;
    events.push({ kind: 'ringOut', side });
    return;
  }
  const lip = radius - percentOf(size, LIP_PERCENT);
  const teetering = distance > lip && distance > 0;
  if (teetering && !body.teetering) events.push({ kind: 'teeter', side });
  body.teetering = teetering;
  if (!teetering || (body.knockedTicks > 0 && !steady) || outward <= 0) return;
  body.vx -= div(ox * outward, ONE);
  body.vy -= div(oy * outward, ONE);
  // Back onto the lip as well, or a held stick would creep a little further out every tick.
  body.dashTicks = 0;
  body.lunge = null;
  body.x = div(ox * lip, ONE);
  body.y = div(oy * lip, ONE);
}

const isDown = (body: Body): boolean => body.out || body.health === 0;

/**
 * A knockout or a ring-out ends the fight, both sides at once a draw. At the time limit the larger
 * share of health left wins, an equal share a draw.
 */
function ending(bodies: readonly [Body, Body], tick: number, island: ArenaIslandRules): ArenaOutcome | null {
  const [first, second] = bodies;
  if (isDown(first) || isDown(second)) {
    const winner = isDown(first) && isDown(second) ? null : isDown(first) ? 1 : 0;
    return { winner, how: first.out || second.out ? 'ringOut' : 'knockout', tick };
  }
  if (tick < island.limitTicks) return null;
  const ahead = first.health * second.maxHealth - second.health * first.maxHealth;
  return { winner: ahead > 0 ? 0 : ahead < 0 ? 1 : null, how: 'timeUp', tick };
}

/** Moves the fight on one tick with each side's input. A finished fight steps no further. */
export function arenaStep(state: ArenaState, inputs: ArenaInputs, content: ArenaContent): ArenaStepResult {
  if (state.outcome) return { state, events: [] };
  const rules = content.arena;
  const { island } = rules;
  const tick = state.tick + 1;
  const work: Working = {
    tick,
    content,
    bodies: [tickDown(state.bodies[0]), tickDown(state.bodies[1])],
    things: state.things.map((thing) => ({ ...thing })),
    nextId: state.nextId,
    weather: state.weather,
    events: [],
    healthAtStart: [healthPermille(state.bodies[0]), healthPermille(state.bodies[1])],
    instants: [],
    weatherCalls: [],
    heals: [],
    pulls: [],
    rng: state.rng,
    roll: null,
  };
  const { bodies, events } = work;
  weatherTickDown(work);
  const { radius, storm } = stepStorm(tick, state.radius, state.storm, rules, events);
  for (const side of ARENA_SIDES) {
    steer(bodies[side], inputs[side]);
    act(work, side, inputs[side]);
  }
  settleWeather(work);
  landInstants(work);
  for (const side of ARENA_SIDES) move(bodies[side], inputs[side], rules);
  collide(work);
  const top = speedPerTick(island.topSpeed);
  for (const body of bodies) limitSpeed(body, top);
  stepShots(work);
  settlePulls(work);
  stepZones(work);
  giveHeals(work);
  for (const body of bodies) limitSpeed(body, top);
  for (const side of ARENA_SIDES) edge(bodies[side], side, radius, island, events);
  const next: ArenaState = { tick, rng: work.rng, radius, storm, bodies, things: work.things, nextId: work.nextId, weather: work.weather, outcome: ending(bodies, tick, island) };
  return { state: next, events };
}

/** A body's speed in whole arena units a second, for tests and logs. */
export const bodySpeed = (body: Body): number => speedPerSecond(lengthOf(body.vx, body.vy));
