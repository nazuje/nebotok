import { aimOf, alive, cast, stepShots, strike, stepTreat, stepZones, throwTreat } from './arena-abilities.ts';
import { ARENA, DT, EASIER, STORM, knockFor, stormRadius } from './arena-kits.ts';
import { healthShare, other, you, type Action, type ArenaState, type Fighter, type Intent } from './arena-state.ts';

/**
 * One fixed 60 Hz step of an arena battle: the storm, both sides' input, walking, dashing and
 * knockback, bumps, shots, zones, the island's edge and the end. Pure: it reads the seeded RNG in
 * the state and nothing else, so a bot can play thousands of battles without drawing a frame.
 */

const WALK_ACCEL = (1 - ARENA.friction) / ARENA.friction;
const EDGE_LIP = 0.35;

function stepStorm(state: ArenaState): void {
  const { storm, tick } = state;
  if (tick === storm.shrinkAt - STORM.warn) state.events.push({ kind: 'storm', what: 'warn' });
  if (tick < storm.shrinkAt) return;
  const progress = Math.min(1, (tick - storm.shrinkAt) / STORM.shrink);
  storm.radius = storm.from + (storm.to - storm.from) * progress;
  if (tick === storm.shrinkAt) state.events.push({ kind: 'storm', what: 'shrink' });
  if (progress < 1) return;
  storm.step += 1;
  storm.from = storm.to;
  storm.to = stormRadius(storm.step + 1);
  storm.shrinkAt = storm.to < storm.from ? storm.shrinkAt + STORM.every : Number.POSITIVE_INFINITY;
}

const cooldownScale = (state: ArenaState, fighter: Fighter): number => (fighter.side === 1 && state.options.easier ? EASIER.cooldown : 1);
const windupTicks = (state: ArenaState): number => Math.round(ARENA.windup * (state.options.easier ? EASIER.windup : 1));
const busy = (state: ArenaState, fighter: Fighter): boolean => !alive(fighter) || fighter.windup !== null || fighter.lungeUntil > state.tick || fighter.rootUntil > state.tick;

function useAbility(state: ArenaState, fighter: Fighter, slot: number): void {
  const ability = fighter.kit[slot];
  const { tick } = state;
  if (!ability || slot >= state.options.abilities || busy(state, fighter) || tick < (fighter.ready[slot] ?? 0)) return;
  fighter.ready[slot] = tick + Math.round(ability.cooldown * cooldownScale(state, fighter));
  const aim = aimOf(state, fighter, ability);
  if (fighter.side === 1 && slot > 0) {
    fighter.windup = { slot, start: tick, until: tick + windupTicks(state), ax: aim.x, ay: aim.y, reach: aim.reach };
    state.events.push({ kind: 'windup', side: 1, slot });
    return;
  }
  cast(state, fighter, slot, aim);
}

function dash(state: ArenaState, fighter: Fighter, intent: Intent): void {
  if (busy(state, fighter) || state.tick < fighter.dashReady) return;
  const pull = Math.hypot(intent.mx, intent.my);
  fighter.dashX = pull > 0 ? intent.mx / pull : Math.cos(fighter.face);
  fighter.dashY = pull > 0 ? intent.my / pull : Math.sin(fighter.face);
  fighter.dashUntil = state.tick + ARENA.dashTicks;
  fighter.dashReady = state.tick + ARENA.dashCooldown;
  state.events.push({ kind: 'dash', side: fighter.side });
}

function swap(state: ArenaState): void {
  const from = you(state);
  if (state.tick < state.swapReady || state.team.length < 2 || busy(state, from) || from.dashUntil > state.tick) return;
  const to = (state.active + 1) % state.team.length;
  const next = state.team[to];
  if (!next || next.hp <= 0) return;
  Object.assign(next, { x: from.x, y: from.y, px: from.px, py: from.py, vx: from.vx, vy: from.vy, face: from.face, knockedUntil: from.knockedUntil, slowUntil: from.slowUntil, slow: from.slow });
  from.shieldUntil = 0;
  state.active = to;
  state.swapReady = state.tick + ARENA.swapCooldown;
  state.events.push({ kind: 'swap', from: state.team.indexOf(from), to });
}

function act(state: ArenaState, fighter: Fighter, action: Action, intent: Intent): void {
  if (action === 'dash') dash(state, fighter, intent);
  else if (action === 'treat' && fighter.side === 0 && !busy(state, fighter)) throwTreat(state, fighter, aimOf(state, fighter, null));
  else if (action !== 'swap') useAbility(state, fighter, Number(action.slice(1)));
}

function steer(state: ArenaState, fighter: Fighter, intent: Intent): void {
  const length = Math.hypot(intent.mx, intent.my);
  fighter.steering = length > 0.01 && alive(fighter) && fighter.rootUntil <= state.tick;
  fighter.aimHelp = intent.face === null;
  if (intent.face !== null) fighter.face = intent.face;
  else if (fighter.steering && fighter.lungeUntil <= state.tick) fighter.face = Math.atan2(intent.my, intent.mx);
  const windup = fighter.windup;
  if (windup && state.tick >= windup.until) {
    fighter.windup = null;
    cast(state, fighter, windup.slot, { x: windup.ax, y: windup.ay, reach: windup.reach });
  }
}

/** Walking with friction, or the drive of a dash or lunge. */
function move(state: ArenaState, fighter: Fighter, intent: Intent): void {
  const { tick } = state;
  const open = Math.hypot(fighter.vx, fighter.vy);
  if (fighter.lungeUntil > tick) {
    const ability = fighter.kit[1];
    fighter.vx = fighter.lungeX * (ability?.speed ?? 0);
    fighter.vy = fighter.lungeY * (ability?.speed ?? 0);
  } else if (fighter.dashUntil > tick && fighter.rootUntil <= tick) {
    fighter.vx = fighter.dashX * ARENA.dashSpeed;
    fighter.vy = fighter.dashY * ARENA.dashSpeed;
  } else walk(state, fighter, intent, open);
  if (fighter.rootUntil > tick) {
    fighter.vx = 0;
    fighter.vy = 0;
  }
  fighter.px = fighter.x;
  fighter.py = fighter.y;
  fighter.x += fighter.vx * DT;
  fighter.y += fighter.vy * DT;
}

function walk(state: ArenaState, fighter: Fighter, intent: Intent, open: number): void {
  const { tick } = state;
  const slowed = fighter.slowUntil > tick ? fighter.slow : 1;
  const easier = fighter.side === 1 && state.options.easier ? EASIER.walk : 1;
  const cap = fighter.cap * slowed * easier;
  const knocked = fighter.knockedUntil > tick;
  let accel = cap * WALK_ACCEL * (knocked ? 0.3 : 1) * (fighter.windup ? 0.4 : 1);
  if (!fighter.steering) accel = 0;
  const length = Math.hypot(intent.mx, intent.my) || 1;
  fighter.vx = (fighter.vx + (intent.mx / length) * accel) * ARENA.friction;
  fighter.vy = (fighter.vy + (intent.my / length) * accel) * ARENA.friction;
  if (!fighter.steering && !knocked) {
    fighter.vx *= ARENA.planted;
    fighter.vy *= ARENA.planted;
  }
  const speed = Math.hypot(fighter.vx, fighter.vy);
  const allowed = Math.max(cap, open * ARENA.friction);
  if (speed > allowed) {
    fighter.vx *= allowed / speed;
    fighter.vy *= allowed / speed;
  }
}

/**
 * The island's edge. With ring-out on, walking and dashing stop at the lip, so only a knock can
 * carry a creature over, and one fully past the edge falls. With it off, the edge is a wall.
 */
function edge(state: ArenaState, fighter: Fighter): void {
  if (!alive(fighter)) return;
  const distance = Math.hypot(fighter.x, fighter.y) || 1;
  const ox = fighter.x / distance;
  const oy = fighter.y / distance;
  const outward = fighter.vx * ox + fighter.vy * oy;
  const radius = state.storm.radius;
  if (!state.options.ringOut) {
    const wall = radius - ARENA.body * 0.2;
    if (distance <= wall) return;
    fighter.x = ox * wall;
    fighter.y = oy * wall;
    if (outward > 0) {
      fighter.vx -= ox * outward * 1.3;
      fighter.vy -= oy * outward * 1.3;
    }
    return;
  }
  if (distance > radius + ARENA.body) {
    fall(state, fighter);
    return;
  }
  const lip = radius - ARENA.body * EDGE_LIP;
  if (distance <= lip || outward <= 0 || fighter.knockedUntil > state.tick) return;
  fighter.vx -= ox * outward;
  fighter.vy -= oy * outward;
  if (fighter.lungeUntil <= state.tick && fighter.dashUntil <= state.tick) return;
  fighter.lungeUntil = Math.min(fighter.lungeUntil, state.tick);
  fighter.dashUntil = Math.min(fighter.dashUntil, state.tick);
  fighter.x = ox * lip;
  fighter.y = oy * lip;
}

function fall(state: ArenaState, fighter: Fighter): void {
  fighter.fallAt = state.tick;
  fighter.windup = null;
  state.events.push({ kind: 'fall', side: fighter.side });
  state.outcome ??= { winner: other(fighter.side), how: 'ringout', tick: state.tick };
}

/** Bodies push apart; a dash into the other shoves it, and a lunge that reaches it lands. */
function collide(state: ArenaState, a: Fighter, b: Fighter): void {
  if (!alive(a) || !alive(b)) return;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const distance = Math.hypot(dx, dy) || 1;
  for (const [lunger, target] of [
    [a, b],
    [b, a],
  ] as const) {
    if (lunger.lungeUntil > state.tick && !lunger.lungeHit && distance < ARENA.body * 2 + 14) {
      lunger.lungeHit = true;
      lunger.lungeUntil = state.tick;
      lunger.vx *= -0.15;
      lunger.vy *= -0.15;
      strikeLunge(state, lunger, target);
    }
  }
  if (distance >= ARENA.body * 2) return;
  const nx = dx / distance;
  const ny = dy / distance;
  const overlap = ARENA.body * 2 - distance;
  a.x -= (nx * overlap) / 2;
  a.y -= (ny * overlap) / 2;
  b.x += (nx * overlap) / 2;
  b.y += (ny * overlap) / 2;
  const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
  if (closing <= 0) return;
  const shove = closing * 0.7;
  a.vx -= nx * shove;
  a.vy -= ny * shove;
  b.vx += nx * shove;
  b.vy += ny * shove;
  for (const [dasher, target, sign] of [
    [a, b, 1],
    [b, a, -1],
  ] as const) {
    if (dasher.dashUntil <= state.tick || closing < 300) continue;
    dasher.dashUntil = state.tick;
    const speed = knockFor(ARENA.bumpKnock, healthShare(target));
    target.vx += nx * sign * speed;
    target.vy += ny * sign * speed;
    target.knockedUntil = state.tick + ARENA.knockedTicks;
    state.events.push({ kind: 'bump', side: target.side, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, knock: speed });
  }
}

function strikeLunge(state: ArenaState, lunger: Fighter, target: Fighter): void {
  strike(state, lunger, target, { slot: 1, share: 1, dx: lunger.lungeX, dy: lunger.lungeY });
}

function ending(state: ArenaState): void {
  if (state.outcome || state.tick < ARENA.limit) return;
  const mine = healthShare(you(state));
  state.outcome = { winner: mine >= healthShare(state.wild) ? 0 : 1, how: 'time', tick: state.tick };
}

/** Moves the battle on one tick with each side's input. Does nothing once it has ended. */
export function stepArena(state: ArenaState, mine: Intent, theirs: Intent): void {
  state.events = [];
  if (state.outcome) return;
  state.tick += 1;
  stepStorm(state);
  if (mine.actions.includes('swap')) swap(state);
  const pairs = [
    [you(state), mine],
    [state.wild, theirs],
  ] as const;
  for (const [fighter, intent] of pairs) {
    steer(state, fighter, intent);
    for (const action of intent.actions) act(state, fighter, action, intent);
  }
  for (const [fighter, intent] of pairs) move(state, fighter, intent);
  collide(state, you(state), state.wild);
  stepShots(state);
  stepZones(state);
  for (const [fighter] of pairs) edge(state, fighter);
  stepTreat(state, you(state));
  ending(state);
}
