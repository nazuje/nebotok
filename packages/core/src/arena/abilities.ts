import type { z } from 'zod';
import type { ArenaKind, ArenaShape } from '../arena-shapes.ts';
import type { ARENA_SHAPE_NUMBERS, ArenaRules, Move } from '../content.ts';
import { ONE, TICKS_PER_SECOND, abs, directionVector, div, isqrt, lengthOf, percentOf, sineOf, speedPerTick, toSubunits, turn } from './fixed.ts';
import { shieldBody, strike } from './hits.ts';
import type { ArenaContent } from './rules.ts';
import { isGentle, otherSide, type Body, type Button, type RefusedReason, type Side } from './state.ts';
import { callWeather } from './weather.ts';
import { nextIdOf, type Aim, type InstantHit, type MovingBody, type MovingThing, type Working } from './working.ts';

/**
 * The three buttons: a press, the wind-up of the computer's creature, and one cast function per
 * shape (docs/arena.md, "The 13 shapes"). A move's numbers are its shape's defaults from
 * arena.json with its own `arena` block on top.
 */

type ShapeNumbers = { readonly [Shape in ArenaShape]: z.infer<(typeof ARENA_SHAPE_NUMBERS)[Shape]> };

/** A move as the arena uses it: its shape's numbers with the move's own on top, its kind and cooldown. */
export type AbilityOf<Shape extends ArenaShape> = Readonly<ShapeNumbers[Shape]> & {
  readonly shape: Shape;
  readonly kind: ArenaKind;
  readonly cooldownTicks: number;
  readonly move: Move;
};
export type Ability = { readonly [Shape in ArenaShape]: AbilityOf<Shape> }[ArenaShape];

/** The numbers a move's `arena` block sets, leaving out the ones it leaves to its shape. */
type Defined<Block> = { readonly [Key in keyof Block]?: Exclude<Block[Key], undefined> };
function ownNumbers<Block extends object>(block: Block): Defined<Block> {
  return Object.fromEntries(Object.entries(block).filter(([, value]) => value !== undefined)) as Defined<Block>;
}

/** The move `id`'s working numbers in the arena. */
export function abilityOf(id: string, content: ArenaContent): Ability {
  const move = content.moves.get(id);
  const block = move?.arena;
  if (!move || !block) throw new RangeError(`arena: no move "${id}" with an arena block`);
  const { shapes, kinds } = content.arena;
  const own = { move, cooldownTicks: block.cooldownTicks ?? kinds[block.kind].cooldownTicks };
  switch (block.shape) {
    case 'bolt':
      return { ...shapes.bolt, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'spray':
      return { ...shapes.spray, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'cone':
      return { ...shapes.cone, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'snare':
      return { ...shapes.snare, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'lunge':
      return { ...shapes.lunge, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'burst':
      return { ...shapes.burst, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'puddle':
      return { ...shapes.puddle, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'shield':
      return { ...shapes.shield, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'strike':
      return { ...shapes.strike, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'wall':
      return { ...shapes.wall, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'freeze':
      return { ...shapes.freeze, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'zone':
      return { ...shapes.zone, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
    case 'weather':
      return { ...shapes.weather, ...ownNumbers(block), shape: block.shape, kind: block.kind, ...own };
  }
}

/** A thrown puddle or freeze aimed at the other creature lands at its distance, held to this range (arena units). */
const THROW_NEAREST = 120;
const THROW_FARTHEST = 420;
/** A lunge's rebound when it lands: it keeps this share of its drive, backwards. */
const LUNGE_REBOUND_PERCENT = 15;

/** Ticks a shot flies before it is spent. */
export const flightTicks = (reach: number, speed: number): number => Math.max(1, div(reach * TICKS_PER_SECOND, speed));

/**
 * Where an ability goes: the facing, bent straight at the other creature when it is within the
 * aim help's angle and range. The computer's creature aims for itself, with no help.
 */
export function aimOf(bodies: readonly [Body, Body], side: Side, rules: ArenaRules): Aim {
  const body = bodies[side];
  const target = bodies[otherSide(side)];
  const [fx, fy] = directionVector(body.facing);
  if (body.computer || target.out) return { x: fx, y: fy, reach: null };
  const { cosine, range } = rules.aimHelp;
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const distance = lengthOf(dx, dy);
  if (distance === 0 || distance >= toSubunits(range) || fx * dx + fy * dy < cosine * distance) return { x: fx, y: fy, reach: null };
  const reach = Math.max(toSubunits(THROW_NEAREST), Math.min(toSubunits(THROW_FARTHEST), distance));
  return { x: div(dx * ONE, distance), y: div(dy * ONE, distance), reach };
}

/** Whether a body can do nothing but wait: fallen, fainted, rooted, winding up or lunging. */
export const isBusy = (body: Body): boolean => body.out || body.health === 0 || body.status.rootTicks > 0 || body.windup !== null || body.lunge !== null;

function refusalOf(body: Body, button: Button, rules: ArenaRules): RefusedReason | null {
  if (body.level < rules.buttons[button]) return 'locked';
  if (body.loadout[button] === null) return 'empty';
  if (isBusy(body)) return 'busy';
  if (body.cooldowns[button] > 0) return 'cooling';
  return null;
}

/**
 * A press of `button`: refused while it is locked, empty, cooling or the body is busy; else its
 * cooldown starts, and it casts now, or after the wind-up for the computer's creature.
 */
export function press(work: Working, side: Side, button: Button): void {
  const body = work.bodies[side];
  const rules = work.content.arena;
  const reason = refusalOf(body, button, rules);
  const id = body.loadout[button];
  if (reason !== null || id === null) {
    work.events.push({ kind: 'refused', side, button, reason: reason ?? 'empty' });
    return;
  }
  const ability = abilityOf(id, work.content);
  const gentle = isGentle(body, work.bodies[otherSide(side)]);
  const cooldowns: [number, number, number] = [...body.cooldowns];
  cooldowns[button] = gentle ? percentOf(ability.cooldownTicks, rules.easier.cooldownPercent) : ability.cooldownTicks;
  body.cooldowns = cooldowns;
  const aim = aimOf(work.bodies, side, rules);
  const windup = body.computer ? rules.kinds[ability.kind].windupTicks : 0;
  const ticks = gentle ? percentOf(windup, rules.easier.windupPercent) : windup;
  if (ticks <= 0) {
    cast(work, side, button, ability, aim);
    return;
  }
  body.windup = { button, ticks, x: aim.x, y: aim.y, reach: aim.reach };
  work.events.push({ kind: 'windup', side, button, move: id, ticks });
}

/** Casts a wind-up whose ticks have run out, along the aim it was pressed with. */
export function finishWindup(work: Working, side: Side): void {
  const body = work.bodies[side];
  const { windup } = body;
  if (!windup || windup.ticks > 0) return;
  body.windup = null;
  const id = body.loadout[windup.button];
  if (id !== null) cast(work, side, windup.button, abilityOf(id, work.content), windup);
}

/** A point `distance` (1/256 units) from the body along the 1/4096 vector (x, y). */
const ahead = (body: MovingBody, x: number, y: number, distance: number): readonly [number, number] => [body.x + div(x * distance, ONE), body.y + div(y * distance, ONE)];

type NewThing = Pick<MovingThing, 'x' | 'y' | 'dx' | 'dy' | 'radius' | 'ticks'> & Partial<Pick<MovingThing, 'vx' | 'vy' | 'armTicks' | 'pulseTicks'>>;

function addThing(work: Working, side: Side, ability: Ability, fields: NewThing): void {
  work.things.push({ id: nextIdOf(work), side, move: ability.move.id, shape: ability.shape, vx: 0, vy: 0, armTicks: 0, pulseTicks: 0, touched: false, ...fields });
}

type ShotAbility = AbilityOf<'bolt'> | AbilityOf<'spray'> | AbilityOf<'snare'>;

/** A shot from the body's edge along the 1/4096 vector (x, y). */
function shoot(work: Working, side: Side, ability: ShotAbility, [x, y]: readonly [number, number]): void {
  const radius = toSubunits(ability.radius);
  const [sx, sy] = ahead(work.bodies[side], x, y, toSubunits(work.content.arena.island.body) + radius);
  const speed = speedPerTick(ability.speed);
  addThing(work, side, ability, { x: sx, y: sy, vx: div(x * speed, ONE), vy: div(y * speed, ONE), dx: x, dy: y, radius, ticks: flightTicks(ability.reach, ability.speed) });
}

/**
 * `count` vectors in a fan around `aim`, neighbours `spreadCosine` apart: one along the aim for an
 * odd count, the rest turned by whole and half steps to either side.
 */
export function fanOf(aim: readonly [number, number], count: number, spreadCosine: number): (readonly [number, number])[] {
  const step = [spreadCosine, sineOf(spreadCosine)] as const;
  const halfCosine = isqrt(div((ONE + spreadCosine) * ONE, 2));
  const half = [halfCosine, sineOf(halfCosine)] as const;
  return Array.from({ length: count }, (_unused, index) => {
    const halfSteps = 2 * index - (count - 1);
    const sign = halfSteps < 0 ? -1 : 1;
    let vector = halfSteps % 2 === 0 ? aim : turn(aim, half[0], sign * half[1]);
    for (let turns = 0; turns < div(abs(halfSteps), 2); turns += 1) vector = turn(vector, step[0], sign * step[1]);
    return vector;
  });
}

function lunge(work: Working, side: Side, ability: AbilityOf<'lunge'>, aim: Aim): void {
  const body = work.bodies[side];
  const speed = speedPerTick(ability.speed);
  body.lunge = { move: ability.move.id, ticks: ability.ticks, vx: div(aim.x * speed, ONE), vy: div(aim.y * speed, ONE) };
  body.dashTicks = 0;
}

/** A puddle or freeze lands at the aim help's distance, or at its reach. */
function thrown(work: Working, side: Side, ability: AbilityOf<'puddle'> | AbilityOf<'freeze'>, aim: Aim, ticks: number): void {
  const [x, y] = ahead(work.bodies[side], aim.x, aim.y, aim.reach ?? toSubunits(ability.reach));
  addThing(work, side, ability, { x, y, dx: aim.x, dy: aim.y, radius: toSubunits(ability.radius), armTicks: ability.armTicks, ticks });
}

/** `count` marks along the aim, the first at `reach` and the rest `spacing` further each. */
function marks(work: Working, side: Side, ability: AbilityOf<'strike'>, aim: Aim): void {
  for (let mark = 0; mark < ability.count; mark += 1) {
    const [x, y] = ahead(work.bodies[side], aim.x, aim.y, toSubunits(ability.reach + mark * ability.spacing));
    addThing(work, side, ability, { x, y, dx: aim.x, dy: aim.y, radius: toSubunits(ability.radius), armTicks: ability.armTicks, ticks: 1 });
  }
}

function wall(work: Working, side: Side, ability: AbilityOf<'wall'>, aim: Aim): void {
  const { island, wallThickness } = work.content.arena;
  const [x, y] = ahead(work.bodies[side], aim.x, aim.y, toSubunits(island.body + wallThickness));
  const speed = speedPerTick(ability.speed);
  addThing(work, side, ability, { x, y, vx: div(aim.x * speed, ONE), vy: div(aim.y * speed, ONE), dx: aim.x, dy: aim.y, radius: toSubunits(ability.radius), ticks: ability.ticks });
}

function zone(work: Working, side: Side, ability: AbilityOf<'zone'>, aim: Aim): void {
  const body = work.bodies[side];
  addThing(work, side, ability, { x: body.x, y: body.y, dx: aim.x, dy: aim.y, radius: toSubunits(ability.radius), ticks: ability.ticks, pulseTicks: work.content.arena.zonePulseTicks });
}

/** Puts the ability on `button` into play along `aim`. */
export function cast(work: Working, side: Side, button: Button, ability: Ability, aim: Aim): void {
  work.events.push({ kind: 'cast', side, button, move: ability.move.id, shape: ability.shape });
  const rules = work.content.arena;
  switch (ability.shape) {
    case 'bolt':
    case 'snare':
      shoot(work, side, ability, [aim.x, aim.y]);
      break;
    case 'spray':
      for (const vector of fanOf([aim.x, aim.y], ability.count, ability.spreadCosine)) shoot(work, side, ability, vector);
      break;
    case 'lunge':
      lunge(work, side, ability, aim);
      break;
    case 'puddle':
      thrown(work, side, ability, aim, ability.ticks);
      break;
    case 'freeze':
      thrown(work, side, ability, aim, 1);
      break;
    case 'shield':
      shieldBody(work, side, ability.move.id, ability.ticks, ability.reflectPercent, ability.knock);
      break;
    case 'strike':
      marks(work, side, ability, aim);
      break;
    case 'wall':
      wall(work, side, ability, aim);
      break;
    case 'zone':
      zone(work, side, ability, aim);
      break;
    case 'weather':
      callWeather(work, ability.move.setsWeather ?? ability.move.type, ability.weatherTicks);
      work.instants.push({ side, button, ability, aim });
      break;
    case 'cone':
    case 'burst':
      work.instants.push({ side, button, ability, aim });
      break;
  }
  if (ability.kind === 'ultimate' && ability.shape !== 'weather') callWeather(work, ability.move.type, rules.ultimateWeatherTicks);
}

/** Whether (dx, dy) is no longer than `reach`, all in 1/256 units. */
export const within = (dx: number, dy: number, reach: number): boolean => dx * dx + dy * dy <= reach * reach;

/**
 * Whether a body at (dx, dy) from the caster is in a cone along `aim`: within its radius plus a
 * body, and either inside the wedge or within a body of one of its edges. That is the prototype's
 * angle test widened by the body's size, as dot and cross products.
 */
export function inCone(aim: Aim, dx: number, dy: number, radius: number, halfAngleCosine: number, size: number): boolean {
  if (!within(dx, dy, radius + size)) return false;
  if (aim.x * dx + aim.y * dy >= halfAngleCosine * lengthOf(dx, dy)) return true;
  const sine = sineOf(halfAngleCosine);
  return [sine, -sine].some((edgeSine) => {
    const [ex, ey] = turn([aim.x, aim.y], halfAngleCosine, edgeSine);
    return ex * dx + ey * dy > 0 && abs(ex * dy - ey * dx) <= size * ONE;
  });
}

/** Lands a cone, burst or weather push ring on the other creature, if it reaches. */
function landInstant(work: Working, { side, ability, aim }: InstantHit): void {
  const body = work.bodies[side];
  const target = work.bodies[otherSide(side)];
  const size = toSubunits(work.content.arena.island.body);
  const dx = target.x - body.x;
  const dy = target.y - body.y;
  const hit = { by: side, move: ability.move.id, dx, dy };
  if (ability.shape === 'cone' && inCone(aim, dx, dy, toSubunits(ability.radius), ability.halfAngleCosine, size)) {
    strike(work, { ...hit, sharePercent: ability.sharePercent, knock: ability.knock });
  } else if (ability.shape === 'burst' && within(dx, dy, toSubunits(ability.radius) + size)) {
    strike(work, { ...hit, sharePercent: ability.sharePercent, knock: ability.knock });
  } else if (ability.shape === 'weather' && within(dx, dy, toSubunits(ability.radius) + size)) {
    strike(work, { ...hit, sharePercent: 100, knock: ability.knock });
  }
}

/** Lands every cast of the step that hits at once. */
export function landInstants(work: Working): void {
  for (const instant of work.instants) landInstant(work, instant);
  work.instants.length = 0;
}

/**
 * A lunge lands on touch: it ends, rebounds a little, then hits. Both lunges end before either
 * hits, so two that meet land the same whichever side goes first.
 */
export function landLunges(work: Working): void {
  const landing = ([0, 1] as const).flatMap((side) => {
    const body = work.bodies[side];
    const { lunge: drive } = body;
    if (!drive) return [];
    body.lunge = null;
    body.vx = -percentOf(body.vx, LUNGE_REBOUND_PERCENT);
    body.vy = -percentOf(body.vy, LUNGE_REBOUND_PERCENT);
    return [{ side, drive }];
  });
  for (const { side, drive } of landing) {
    const ability = abilityOf(drive.move, work.content);
    if (ability.shape === 'lunge') strike(work, { by: side, move: drive.move, sharePercent: ability.sharePercent, knock: ability.knock, dx: drive.vx, dy: drive.vy });
  }
}
