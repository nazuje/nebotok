import { ARENA, AIM_ASSIST, EASIER, TREAT, WALL_THICKNESS, ZONE_PULSE, ZONE_PULSE_SHARE, hitDamage, knockFor, ticks, type AbilitySpec } from './arena-kits.ts';
import { fighterOf, healthShare, other, type ArenaState, type Fighter, type Zone } from './arena-state.ts';

/** What each ability does when cast, and how hits, shields, shots and zones play out each tick. */

type Aim = { readonly x: number; readonly y: number; readonly reach: number };

const angleGap = (a: number, b: number): number => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
export const alive = (fighter: Fighter): boolean => fighter.hp > 0 && fighter.fallAt === null;

/**
 * Where an ability goes: the facing, or straight at the other creature when it is within the aim
 * help's angle. `reach` is how far a thrown puddle or freeze circle lands: the other creature's
 * distance when aimed at it, else the ability's own.
 */
export function aimOf(state: ArenaState, caster: Fighter, ability: AbilitySpec | null): Aim {
  const target = fighterOf(state, other(caster.side));
  const dx = target.x - caster.x;
  const dy = target.y - caster.y;
  const distance = Math.hypot(dx, dy);
  const reach = Math.max(120, Math.min(420, distance));
  if (!caster.aimHelp) return { x: Math.cos(caster.face), y: Math.sin(caster.face), reach };
  if (distance > 0 && distance < 900 && angleGap(Math.atan2(dy, dx), caster.face) <= AIM_ASSIST) return { x: dx / distance, y: dy / distance, reach };
  return { x: Math.cos(caster.face), y: Math.sin(caster.face), reach: ability?.reach ?? 0 };
}

/** Whether the other creature is within the aim help's angle, for the aim arrow. */
export function aimLocked(state: ArenaState, caster: Fighter): boolean {
  const target = fighterOf(state, other(caster.side));
  const dx = target.x - caster.x;
  const dy = target.y - caster.y;
  return caster.aimHelp && Math.hypot(dx, dy) < 900 && angleGap(Math.atan2(dy, dx), caster.face) <= AIM_ASSIST;
}

function knock(target: Fighter, dx: number, dy: number, speed: number, tick: number): void {
  const length = Math.hypot(dx, dy) || 1;
  target.vx += (dx / length) * speed;
  target.vy += (dy / length) * speed;
  const total = Math.hypot(target.vx, target.vy);
  if (total > ARENA.topSpeed) {
    target.vx *= ARENA.topSpeed / total;
    target.vy *= ARENA.topSpeed / total;
  }
  target.knockedUntil = tick + ARENA.knockedTicks;
}

/** Damage from `attacker`'s ability in `slot` to `target`, `share` of a full hit, pushed along (dx, dy). A shield takes it instead and throws part back. */
export function strike(state: ArenaState, attacker: Fighter, target: Fighter, hit: { slot: number; share: number; dx: number; dy: number }): void {
  const ability = attacker.kit[hit.slot];
  const move = attacker.moves[hit.slot];
  if (!ability || !move || !alive(target) || state.outcome) return;
  const roll = state.rng.int(85, 100);
  const { damage, effectiveness } = hitDamage(attacker.creature, target.creature, move, roll, hit.share);
  const taken = target.side === 0 && state.options.easier ? Math.max(1, Math.round(damage * EASIER.damageTaken)) : damage;
  if (target.shieldUntil > state.tick) {
    const shield = target.kit[1];
    target.shieldUntil = 0;
    state.events.push({ kind: 'block', side: target.side });
    const back = Math.max(1, Math.round(taken * (shield?.effect ?? 0)));
    hurt(state, attacker, back, 'normal', 'reflect');
    knock(attacker, attacker.x - target.x, attacker.y - target.y, knockFor(shield?.knock ?? 0, healthShare(attacker)), state.tick);
    return;
  }
  const speed = knockFor(ability.knock, healthShare(target));
  if (ability.knock > 0) knock(target, hit.dx, hit.dy, speed, state.tick);
  hurt(state, target, taken, effectiveness, ability.kind, speed);
}

function hurt(state: ArenaState, target: Fighter, damage: number, effectiveness: 'strong' | 'weak' | 'normal', source: AbilitySpec['kind'] | 'reflect', speed = 0): void {
  target.hp = Math.max(0, target.hp - damage);
  state.events.push({ kind: 'hit', side: target.side, x: target.x, y: target.y, damage, effectiveness, knock: speed, source });
  if (target.hp > 0 || state.outcome) return;
  state.events.push({ kind: 'faint', side: target.side });
  state.outcome = { winner: other(target.side), how: 'knockout', tick: state.tick };
}

function addZone(state: ArenaState, caster: Fighter, slot: number, fields: Pick<Zone, 'kind' | 'x' | 'y' | 'dirX' | 'dirY' | 'radius' | 'armAt' | 'until'>): void {
  state.zones.push({ id: state.nextId, side: caster.side, slot, ...fields, px: fields.x, py: fields.y, fromX: caster.x, fromY: caster.y, start: state.tick, touched: false, nextPulse: state.tick + ZONE_PULSE });
  state.nextId += 1;
}

/** Puts an ability into play along `aim`. */
export function cast(state: ArenaState, caster: Fighter, slot: number, aim: Aim): void {
  const ability = caster.kit[slot];
  if (!ability) return;
  const { tick } = state;
  state.events.push({ kind: 'cast', side: caster.side, slot, ability: ability.kind });
  const ahead = (distance: number) => ({ x: caster.x + aim.x * distance, y: caster.y + aim.y * distance });
  switch (ability.kind) {
    case 'bolt': {
      const at = ahead(ARENA.body + ability.radius);
      state.shots.push({ id: state.nextId, side: caster.side, slot, treat: false, ...at, px: at.x, py: at.y, vx: aim.x * ability.speed, vy: aim.y * ability.speed, radius: ability.radius, until: tick + ticks(ability.reach / ability.speed) });
      state.nextId += 1;
      return;
    }
    case 'lunge':
      caster.lungeUntil = tick + ability.ticks;
      caster.lungeX = aim.x;
      caster.lungeY = aim.y;
      caster.lungeHit = false;
      caster.face = Math.atan2(aim.y, aim.x);
      return;
    case 'wall':
      addZone(state, caster, slot, { kind: 'wall', ...ahead(ARENA.body + WALL_THICKNESS), dirX: aim.x, dirY: aim.y, radius: ability.radius, armAt: tick, until: tick + ability.ticks });
      return;
    case 'puddle':
      addZone(state, caster, slot, { kind: 'puddle', ...ahead(aim.reach), dirX: aim.x, dirY: aim.y, radius: ability.radius, armAt: tick + ability.arm, until: tick + ability.arm + ability.ticks });
      return;
    case 'freeze':
      addZone(state, caster, slot, { kind: 'freeze', ...ahead(aim.reach), dirX: aim.x, dirY: aim.y, radius: ability.radius, armAt: tick + ability.arm, until: tick + ability.arm + 20 });
      return;
    case 'cone':
      coneHit(state, caster, slot, aim);
      return;
    case 'shield':
      caster.shieldUntil = tick + ability.ticks;
      return;
    case 'zone':
      addZone(state, caster, slot, { kind: 'sun', x: caster.x, y: caster.y, dirX: 0, dirY: 0, radius: ability.radius, armAt: tick, until: tick + ability.ticks });
  }
}

function coneHit(state: ArenaState, caster: Fighter, slot: number, aim: Aim): void {
  const ability = caster.kit[slot];
  const target = fighterOf(state, other(caster.side));
  if (!ability || !alive(target)) return;
  const dx = target.x - caster.x;
  const dy = target.y - caster.y;
  const distance = Math.hypot(dx, dy);
  const widen = distance > 0 ? Math.asin(Math.min(1, ARENA.body / distance)) : Math.PI;
  if (distance > ability.radius + ARENA.body || angleGap(Math.atan2(dy, dx), Math.atan2(aim.y, aim.x)) > ability.reach + widen) return;
  strike(state, caster, target, { slot, share: 1, dx, dy });
}

/** Moves shots on, lands hits and treats, and drops spent shots. */
export function stepShots(state: ArenaState): void {
  const kept = [];
  for (const shot of state.shots) {
    shot.px = shot.x;
    shot.py = shot.y;
    shot.x += shot.vx / 60;
    shot.y += shot.vy / 60;
    const target = fighterOf(state, other(shot.side));
    const caster = fighterOf(state, shot.side);
    const touching = alive(target) && Math.hypot(target.x - shot.x, target.y - shot.y) < ARENA.body + shot.radius;
    if (touching && shot.treat) {
      befriend(state);
      continue;
    }
    if (touching) {
      strike(state, caster, target, { slot: shot.slot, share: 1, dx: shot.vx, dy: shot.vy });
      continue;
    }
    if (state.tick < shot.until) {
      kept.push(shot);
      continue;
    }
    if (shot.treat) landTreat(state, shot.x, shot.y);
  }
  state.shots = kept;
}

function befriend(state: ArenaState): void {
  state.treat.state = 'away';
  state.treat.until = Number.POSITIVE_INFINITY;
  state.events.push({ kind: 'befriend' });
  state.outcome ??= { winner: 0, how: 'befriend', tick: state.tick };
}

function landTreat(state: ArenaState, x: number, y: number): void {
  const { treat, tick, storm } = state;
  const onIsland = Math.hypot(x, y) < storm.radius - 10;
  treat.state = onIsland ? 'ground' : 'away';
  treat.x = x;
  treat.y = y;
  treat.until = tick + (onIsland ? TREAT.groundTicks : TREAT.againTicks);
  state.events.push({ kind: 'treat', what: onIsland ? 'land' : 'gone' });
}

/** Throws the treat along `aim`, if the wild creature is weak enough and you hold it. */
export function throwTreat(state: ArenaState, thrower: Fighter, aim: Aim): void {
  if (state.treat.state !== 'hand' || healthShare(state.wild) >= TREAT.share) return;
  const x = thrower.x + aim.x * (ARENA.body + TREAT.radius);
  const y = thrower.y + aim.y * (ARENA.body + TREAT.radius);
  state.shots.push({ id: state.nextId, side: 0, slot: -1, treat: true, x, y, px: x, py: y, vx: aim.x * TREAT.speed, vy: aim.y * TREAT.speed, radius: TREAT.radius, until: state.tick + ticks(TREAT.range / TREAT.speed) });
  state.nextId += 1;
  state.treat.state = 'flying';
  state.events.push({ kind: 'treat', what: 'throw' });
}

/** A treat on the ground waits to be picked up by walking over it, until a bird takes it; then you have another soon. */
export function stepTreat(state: ArenaState, picker: Fighter): void {
  const { treat, tick } = state;
  if (treat.state === 'ground' && Math.hypot(picker.x - treat.x, picker.y - treat.y) < ARENA.body + TREAT.radius + 10) {
    treat.state = 'hand';
    state.events.push({ kind: 'treat', what: 'pick' });
    return;
  }
  if (treat.state === 'ground' && tick >= treat.until) {
    treat.state = 'away';
    treat.until = tick + TREAT.againTicks;
    state.events.push({ kind: 'treat', what: 'gone' });
    return;
  }
  if (treat.state === 'away' && tick >= treat.until) treat.state = 'hand';
}

function stepWall(state: ArenaState, zone: Zone, caster: Fighter, target: Fighter): void {
  const ability = caster.kit[zone.slot];
  if (!ability) return;
  zone.x += (zone.dirX * ability.speed) / 60;
  zone.y += (zone.dirY * ability.speed) / 60;
  const across = (x: number, y: number) => {
    const rx = x - zone.x;
    const ry = y - zone.y;
    return { along: rx * zone.dirX + ry * zone.dirY, side: -rx * zone.dirY + ry * zone.dirX };
  };
  state.shots = state.shots.filter((shot) => {
    if (shot.side === zone.side || shot.treat) return true;
    const at = across(shot.x, shot.y);
    return Math.abs(at.along) > WALL_THICKNESS / 2 + shot.radius || Math.abs(at.side) > zone.radius + shot.radius;
  });
  if (!alive(target)) return;
  const at = across(target.x, target.y);
  if (Math.abs(at.along) > WALL_THICKNESS / 2 + ARENA.body || Math.abs(at.side) > zone.radius + ARENA.body) return;
  if (zone.touched) return;
  zone.touched = true;
  strike(state, caster, target, { slot: zone.slot, share: 1, dx: zone.dirX, dy: zone.dirY });
}

function stepPuddle(state: ArenaState, zone: Zone, caster: Fighter, target: Fighter): void {
  const ability = caster.kit[zone.slot];
  if (!ability || !alive(target) || state.tick < zone.armAt) return;
  if (Math.hypot(target.x - zone.x, target.y - zone.y) > zone.radius + ARENA.body * 0.3) return;
  target.slowUntil = state.tick + 12;
  target.slow = ability.effect;
  if (zone.touched) return;
  zone.touched = true;
  strike(state, caster, target, { slot: zone.slot, share: 1, dx: 0, dy: 0 });
}

function stepFreeze(state: ArenaState, zone: Zone, caster: Fighter, target: Fighter): void {
  const ability = caster.kit[zone.slot];
  if (!ability || zone.touched || state.tick < zone.armAt) return;
  zone.touched = true;
  if (!alive(target) || Math.hypot(target.x - zone.x, target.y - zone.y) > zone.radius + ARENA.body * 0.5) return;
  const shielded = target.shieldUntil > state.tick;
  strike(state, caster, target, { slot: zone.slot, share: 1, dx: 0, dy: 0 });
  if (shielded) return;
  target.rootUntil = state.tick + ability.ticks;
  target.vx = 0;
  target.vy = 0;
  state.events.push({ kind: 'root', side: target.side });
}

function stepSun(state: ArenaState, zone: Zone, caster: Fighter, target: Fighter): void {
  const ability = caster.kit[zone.slot];
  if (!ability || state.tick < zone.nextPulse) return;
  zone.nextPulse += ZONE_PULSE;
  if (alive(caster) && Math.hypot(caster.x - zone.x, caster.y - zone.y) < zone.radius) {
    const amount = Math.min(caster.maxHp - caster.hp, Math.round(caster.maxHp * ability.effect));
    caster.hp += amount;
    if (amount > 0) state.events.push({ kind: 'heal', side: caster.side, amount });
  }
  if (alive(target) && Math.hypot(target.x - zone.x, target.y - zone.y) < zone.radius + ARENA.body * 0.5) strike(state, caster, target, { slot: zone.slot, share: ZONE_PULSE_SHARE, dx: 0, dy: 0 });
}

const ZONE_STEPS = { wall: stepWall, puddle: stepPuddle, freeze: stepFreeze, sun: stepSun } as const;

export function stepZones(state: ArenaState): void {
  for (const zone of state.zones) {
    zone.px = zone.x;
    zone.py = zone.y;
    ZONE_STEPS[zone.kind](state, zone, fighterOf(state, zone.side), fighterOf(state, other(zone.side)));
  }
  state.zones = state.zones.filter((zone) => state.tick < zone.until);
}
