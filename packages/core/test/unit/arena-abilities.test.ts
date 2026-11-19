import { describe, expect, it } from 'vitest';
import {
  ARENA_IDLE,
  abilityOf,
  aimOf,
  arenaStart,
  arenaStep,
  battleCreature,
  damageOf,
  fanOf,
  inCone,
  isqrt,
  knockFor,
  rngFromState,
  type ArenaEvent,
  type ArenaFighter,
  type ArenaInputs,
  type ArenaState,
  type Body,
} from '../../src/index.ts';
import { arenaContent as content } from '../support/arena-content.ts';
import { fighter, loadoutWith, stick } from '../support/arena-fighters.ts';

const rules = content.arena;
const UNIT = 256;

const ready = (body: Body, x: number): Body => ({ ...body, x, y: 0, cooldowns: [0, 0, 0] });
const speciesOf = (body: Body) => content.species.get(body.species)!;
const opposite = (value: number) => (value === 0 ? 0 : -value);

/** A fight with side 1 standing `apart` units to the right of side 0, both facing each other, every button ready. */
function face(first: ArenaFighter, second: ArenaFighter, apart = 150, change: (state: ArenaState) => ArenaState = (state) => state): ArenaState {
  const state = arenaStart({ seed: 'arena-abilities', fighters: [first, second] }, content);
  const half = (apart * UNIT) / 2;
  return change({ ...state, bodies: [ready(state.bodies[0], -half), ready(state.bodies[1], half)] });
}

const withBody = (state: ArenaState, side: 0 | 1, body: Partial<Body>): ArenaState => {
  const bodies: [Body, Body] = [state.bodies[0], state.bodies[1]];
  bodies[side] = { ...bodies[side], ...body };
  return { ...state, bodies };
};

function hold(state: ArenaState, inputs: ArenaInputs, ticks: number): { state: ArenaState; events: ArenaEvent[] } {
  const events: ArenaEvent[] = [];
  let now = state;
  for (let tick = 0; tick < ticks && !now.outcome; tick += 1) {
    const step = arenaStep(now, inputs, content);
    now = step.state;
    events.push(...step.events);
  }
  return { state: now, events };
}

const hitsOf = (events: readonly ArenaEvent[]) => events.flatMap((event) => (event.kind === 'hit' ? [event] : []));
const pressing = (button: 0 | 1 | 2): ArenaInputs => [stick(null, button), ARENA_IDLE];

/** The damage one hit of `move` deals, its shape's share of a full hit of `damage`. */
function share(move: string, damage: number): number {
  const ability = abilityOf(move, content);
  return Math.max(1, Math.trunc((damage * ('sharePercent' in ability ? ability.sharePercent : 100)) / 100));
}

/** The damage `damageOf` gives a full hit of `move` from side 0 on side 1 in `weather`, with the step's roll. */
function expectedDamage(state: ArenaState, move: string, weather: string | null): number {
  const [a, b] = state.bodies;
  const roll = rngFromState(state.rng).int(content.rules.minRollPercent, 100);
  const field = weather === null ? null : { type: weather, turnsLeft: null };
  return damageOf(content, battleCreature(a.id, speciesOf(a), a.level), battleCreature(b.id, speciesOf(b), b.level), content.moves.get(move)!, field, roll).damage;
}

describe('arena hits', () => {
  it('knocks 0.45 times the shape knock at full health and 2.0 times at 10% health', () => {
    const lunger = fighter('pinwhirl', { level: 20, loadout: loadoutWith('gale-wallop') });
    const full = face(lunger, fighter('glaciyak', { level: 20 }), 110);
    const [fullHit] = hitsOf(hold(full, pressing(1), 3).events);
    expect(fullHit?.knock).toBe(517);
    const tenth = Math.trunc(full.bodies[1].maxHealth / 10);
    const worn = withBody(full, 1, { health: tenth });
    const [wornHit] = hitsOf(hold(worn, pressing(1), 3).events);
    // 1150 × (45% + 175% × 90% lost) is 2328; a tenth rounded down has lost a little more.
    expect(wornHit?.knock).toBe(knockFor(1150, Math.trunc((tenth * 1000) / full.bodies[1].maxHealth), rules.island));
    expect(knockFor(1150, 100, rules.island)).toBe(2328);
  });

  it.each([
    ['no weather', null, 'strong'],
    ['rain, which boosts rain', 'rain', 'strong'],
    ['sun, which weakens rain', 'sun', 'strong'],
  ] as const)('deals core damageOf in %s', (_label, weather, effectiveness) => {
    const caster = fighter('puddlepip', { level: 20, loadout: loadoutWith('drip-drop') });
    const state = face(caster, fighter('glowbun', { level: 20 }), 200, (start) => ({ ...start, weather: weather && { type: weather, ticks: 900 } }));
    const [hit] = hitsOf(hold(state, pressing(0), 30).events);
    expect(hit).toMatchObject({ move: 'drip-drop', effectiveness, damage: expectedDamage(state, 'drip-drop', weather) });
  });

  it('deals a weak hit as damageOf does, and a shape share of it', () => {
    const caster = fighter('glowbun', { level: 20, loadout: loadoutWith('heat-shimmer', 'noon-blaze') });
    const state = face(caster, fighter('puddlepip', { level: 20 }), 120);
    const [cone] = hitsOf(hold(state, pressing(0), 1).events);
    expect(cone).toMatchObject({ effectiveness: 'weak', damage: share('heat-shimmer', expectedDamage(state, 'heat-shimmer', null)) });
    const zone = hitsOf(hold(state, pressing(2), 31).events).find((hit) => hit.move === 'noon-blaze');
    const sunny = withBody({ ...state, weather: { type: 'sun', ticks: 600 } }, 0, {});
    expect(zone?.damage).toBe(share('noon-blaze', expectedDamage(sunny, 'noon-blaze', 'sun')));
  });

  it('takes 70% of the damage with the turtle setting', () => {
    const caster = fighter('puddlepip', { level: 20, loadout: loadoutWith('drip-drop') });
    const normal = face(caster, fighter('glowbun', { level: 20 }), 200);
    const turtle = face(caster, fighter('glowbun', { level: 20, turtle: true }), 200);
    const [plain] = hitsOf(hold(normal, pressing(0), 30).events);
    const [shelled] = hitsOf(hold(turtle, pressing(0), 30).events);
    expect(shelled?.damage).toBe(Math.max(1, Math.trunc((plain!.damage * 70) / 100)));
  });

  it('knocks out a creature at 0 health, and the time limit goes to the larger share of health', () => {
    const caster = fighter('puddlepip', { level: 20, loadout: loadoutWith('drip-drop') });
    const nearlyOut = face(caster, fighter('glowbun', { level: 20 }), 200, (state) => withBody(state, 1, { health: 1 }));
    const knocked = hold(nearlyOut, pressing(0), 30);
    expect(knocked.events).toContainEqual({ kind: 'fainted', side: 1 });
    expect(knocked.state.outcome).toMatchObject({ winner: 0, how: 'knockout' });
    const late = face(fighter('glowbun'), fighter('glaciyak'), 300, (state) => ({ ...state, tick: rules.island.limitTicks - 1 }));
    const worn = withBody(late, 0, { health: late.bodies[0].maxHealth - 1 });
    expect(arenaStep(worn, [ARENA_IDLE, ARENA_IDLE], content).state.outcome).toEqual({ winner: 1, how: 'timeUp', tick: rules.island.limitTicks });
    expect(arenaStep(late, [ARENA_IDLE, ARENA_IDLE], content).state.outcome).toEqual({ winner: null, how: 'timeUp', tick: rules.island.limitTicks });
  });
});

describe('arena buttons', () => {
  it('refuses a locked, an empty, a cooling and a busy button', () => {
    const young = arenaStart({ seed: 'locked', fighters: [fighter('glowbun', { level: 6, loadout: loadoutWith('heat-shimmer', 'sun-ray') }), fighter('baskit')] }, content);
    expect(arenaStep(young, pressing(1), content).events).toContainEqual({ kind: 'refused', side: 0, button: 1, reason: 'locked' });
    const state = face(fighter('glowbun', { level: 20, loadout: loadoutWith('heat-shimmer') }), fighter('baskit'), 300);
    expect(arenaStep(state, pressing(1), content).events).toEqual([{ kind: 'refused', side: 0, button: 1, reason: 'empty' }]);
    const cast = arenaStep(state, pressing(0), content);
    expect(cast.events).toContainEqual({ kind: 'cast', side: 0, button: 0, move: 'heat-shimmer', shape: 'cone' });
    expect(arenaStep(cast.state, pressing(0), content).events).toEqual([{ kind: 'refused', side: 0, button: 0, reason: 'cooling' }]);
    const rooted = withBody(state, 0, { status: { ...state.bodies[0].status, rootTicks: 10 } });
    expect(arenaStep(rooted, pressing(0), content).events).toEqual([{ kind: 'refused', side: 0, button: 0, reason: 'busy' }]);
  });

  it('cools a button down for its move cooldown', () => {
    const state = face(fighter('glowbun', { level: 20, loadout: loadoutWith('heat-shimmer') }), fighter('baskit'), 300);
    const cast = arenaStep(state, pressing(0), content).state;
    expect(cast.bodies[0].cooldowns[0]).toBe(abilityOf('heat-shimmer', content).cooldownTicks);
    const waited = hold(cast, [ARENA_IDLE, ARENA_IDLE], 53).state;
    expect(arenaStep(waited, pressing(0), content).events).toContainEqual({ kind: 'cast', side: 0, button: 0, move: 'heat-shimmer', shape: 'cone' });
  });

  it('winds a computer creature up before a special, and more gently against a turtle', () => {
    const computer = fighter('pinwhirl', { level: 20, loadout: loadoutWith('twirl'), computer: true });
    const plain = arenaStep(face(computer, fighter('baskit'), 300), pressing(1), content);
    expect(plain.events).toEqual([{ kind: 'windup', side: 0, button: 1, move: 'twirl', ticks: 36 }]);
    expect(plain.state.bodies[0].cooldowns[1]).toBe(360);
    const gentle = arenaStep(face(computer, fighter('baskit', { turtle: true }), 300), pressing(1), content);
    expect(gentle.events).toEqual([{ kind: 'windup', side: 0, button: 1, move: 'twirl', ticks: 54 }]);
    expect(gentle.state.bodies[0].cooldowns[1]).toBe(468);
    const cast = hold(plain.state, [ARENA_IDLE, ARENA_IDLE], 36).events.filter((event) => event.kind === 'cast');
    expect(cast).toEqual([{ kind: 'cast', side: 0, button: 1, move: 'twirl', shape: 'burst' }]);
  });

  it('casts a player creature at once, with no wind-up', () => {
    const player = fighter('pinwhirl', { level: 20, loadout: loadoutWith('twirl') });
    expect(arenaStep(face(player, fighter('baskit'), 300), pressing(1), content).events).toEqual([{ kind: 'cast', side: 0, button: 1, move: 'twirl', shape: 'burst' }]);
  });
});

describe('arena aim and shapes', () => {
  it('bends the aim at the other creature within 30° and 900 units, for players only', () => {
    const state = face(fighter('glowbun'), fighter('baskit'), 400, (start) => withBody(start, 1, { y: 100 * UNIT }));
    const aim = aimOf(state.bodies, 0, rules);
    expect(aim.reach).toBe(isqrt((400 * UNIT) ** 2 + (100 * UNIT) ** 2));
    expect(aim.y).toBeGreaterThan(0);
    const far = face(fighter('glowbun'), fighter('baskit'), 400, (start) => withBody(start, 1, { y: 300 * UNIT }));
    expect(aimOf(far.bodies, 0, rules)).toEqual({ x: 4096, y: 0, reach: null });
    const computer = withBody(state, 0, { computer: true });
    expect(aimOf(computer.bodies, 0, rules)).toEqual({ x: 4096, y: 0, reach: null });
  });

  it('fans a spray evenly around the aim, mirrored on each side', () => {
    const fan = fanOf([4096, 0], 3, 4034);
    expect(fan[1]).toEqual([4096, 0]);
    expect(fan[0]![1]).toBe(-fan[2]![1]);
    expect(fan[0]![0]).toBe(4034);
    expect(fanOf([-4096, 0], 3, 4034)).toEqual(fan.map(([x, y]) => [opposite(x), opposite(y)]));
  });

  it('hits a body inside the cone, or just over its edge, and not one behind', () => {
    const aim = { x: 4096, y: 0, reach: null };
    const size = 46 * UNIT;
    expect(inCone(aim, 100 * UNIT, 0, 230 * UNIT, 3133, size)).toBe(true);
    expect(inCone(aim, 100 * UNIT, 100 * UNIT, 230 * UNIT, 3133, size)).toBe(true);
    expect(inCone(aim, 60 * UNIT, 150 * UNIT, 230 * UNIT, 3133, size)).toBe(false);
    expect(inCone(aim, -100 * UNIT, 0, 230 * UNIT, 3133, size)).toBe(false);
    expect(inCone(aim, 300 * UNIT, 0, 230 * UNIT, 3133, size)).toBe(false);
  });

  it('starts weather, lets it run out, and a newer weather ends it early', () => {
    const caller = fighter('baskit', { level: 20, loadout: loadoutWith('sun-call') });
    const called = arenaStep(face(caller, fighter('puddlepip', { level: 20, loadout: loadoutWith('rain-call') }), 400), pressing(2), content);
    expect(called.events).toContainEqual({ kind: 'weatherStarted', weather: 'sun', ticks: 900 });
    const ending = hold(called.state, [ARENA_IDLE, ARENA_IDLE], 900);
    expect(ending.events.filter((event) => event.kind === 'weatherEnded')).toEqual([{ kind: 'weatherEnded', weather: 'sun' }]);
    expect(ending.state.weather).toBeNull();
    const flipped = arenaStep(called.state, [ARENA_IDLE, stick(null, 2)], content);
    expect(flipped.events.filter((event) => event.kind.startsWith('weather'))).toEqual([
      { kind: 'weatherEnded', weather: 'sun' },
      { kind: 'weatherStarted', weather: 'rain', ticks: 900 },
    ]);
  });

  it('lets the longer weather win when both sides call in the same step', () => {
    const sun = fighter('baskit', { level: 20, loadout: loadoutWith('sun-call') });
    const blaze = fighter('glowbun', { level: 40, loadout: loadoutWith('noon-blaze') });
    const both = arenaStep(face(sun, { ...blaze, loadout: loadoutWith('rain-call') }, 600), [stick(null, 2), stick(null, 2)], content);
    expect(both.state.weather).toEqual({ type: 'rain', ticks: 900 });
    const ultimate = arenaStep(face(sun, blaze, 600), [stick(null, 2), stick(null, 2)], content);
    expect(ultimate.state.weather).toEqual({ type: 'sun', ticks: 900 });
  });

  it('heals the caster in its zone only after the step has hit', () => {
    const blaze = fighter('glowbun', { level: 30, loadout: loadoutWith('noon-blaze') });
    const hurt = face(blaze, fighter('baskit'), 500, (state) => withBody(state, 0, { health: 100 }));
    const { events } = hold(hurt, pressing(2), 30);
    const healed = events.filter((event) => event.kind === 'healed');
    expect(healed).toEqual([{ kind: 'healed', side: 0, amount: Math.trunc((hurt.bodies[0].maxHealth * 3) / 100), health: 100 + Math.trunc((hurt.bodies[0].maxHealth * 3) / 100) }]);
  });
});
