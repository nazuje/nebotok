import { describe, expect, it } from 'vitest';
import {
  BattleError,
  battleCreature,
  battleStep,
  createRng,
  damageOf,
  effectivenessOf,
  isLegalAction,
  legalActions,
  startBattle,
  type BattleAction,
  type BattleContent,
  type BattleEvent,
  type BattleState,
} from '../../src/index.ts';
import { battleContent, withRules } from '../support/battle-content.ts';

const team = (...creatures: readonly (readonly [string, number])[]) => ({ creatures: creatures.map(([species, level]) => ({ species, level })) });
type Team = ReturnType<typeof team>;
const start = (a: Team, b: Team, weather: string | null = null, content: BattleContent = battleContent): BattleState => startBattle({ sides: [a, b], weather }, content).state;
const move = (slot: number): BattleAction => ({ kind: 'move', slot });
const switchTo = (to: number): BattleAction => ({ kind: 'switch', to });
const usedBy = (events: readonly BattleEvent[]) => events.flatMap((event) => (event.kind === 'used' ? [event.side] : []));

function creature(species: string, level: number) {
  const entry = battleContent.species.get(species);
  if (!entry) throw new Error(`no ${species}`);
  return battleCreature('a1', entry, level);
}

/** Plays the same pair of actions every turn until `until` says stop or the battle ends. */
function repeat(state: BattleState, actions: readonly [BattleAction, BattleAction], turns: number, content: BattleContent = battleContent, seed = 1) {
  const rng = createRng(seed);
  const events: BattleEvent[] = [];
  let now = state;
  for (let turn = 0; turn < turns && now.phase === 'choose'; turn += 1) {
    const result = battleStep(now, actions, rng, content);
    now = result.state;
    events.push(...result.events);
  }
  return { state: now, events };
}

describe('starting a battle', () => {
  it('sends out the first creature of each side at full health', () => {
    const { state, events } = startBattle({ sides: [team(['sun-blob', 30]), team(['rain-blob', 30], ['gale-blob', 30])], weather: null }, battleContent);
    expect(state.sides[1].creatures.map((entry) => entry.id)).toEqual(['b1', 'b2']);
    expect(state.sides.flatMap((side) => side.creatures).every((entry) => entry.hp === entry.maxHp && entry.hp > 0)).toBe(true);
    expect(state).toMatchObject({ phase: 'choose', turn: 0, weather: null, mustSwap: [false, false], outcome: null });
    expect(events).toEqual([
      { kind: 'switched', side: 0, from: null, to: 'a1' },
      { kind: 'switched', side: 1, from: null, to: 'b1' },
    ]);
  });

  it('starts with the battlefield weather, which lasts until a move changes it', () => {
    const { state, events } = startBattle({ sides: [team(['sun-blob', 30]), team(['rain-blob', 30])], weather: 'storm' }, battleContent);
    expect(state.weather).toEqual({ type: 'storm', turnsLeft: null });
    expect(events.at(-1)).toEqual({ kind: 'weatherStarted', weather: 'storm', turns: null });
    expect(repeat(state, [move(0), move(0)], 3).state.weather).toEqual({ type: 'storm', turnsLeft: null });
  });

  it('refuses creatures and weather the content does not have', () => {
    expect(() => start(team(['nobody', 30]), team(['rain-blob', 30]))).toThrow(BattleError);
    expect(() => start(team(['sun-blob', 30]), team(['rain-blob', 30]), 'fog')).toThrow(BattleError);
    expect(() => start(team(), team(['rain-blob', 30]))).toThrow(/>=1/);
  });
});

describe('damage', () => {
  const attacker = creature('sun-blob', 40);
  const target = creature('gale-blob', 40);
  const sunTap = battleContent.moves.get('sun-tap')!;
  const rainTap = battleContent.moves.get('rain-tap')!;
  const hit = (into: typeof target, weather: string | null = null, used = sunTap) => damageOf(battleContent, attacker, into, used, weather ? { type: weather, turnsLeft: null } : null, 100);

  it('follows the weather chart', () => {
    expect(effectivenessOf(battleContent, 'sun', 'frost')).toBe('strong');
    expect(effectivenessOf(battleContent, 'sun', 'rain')).toBe('weak');
    expect(effectivenessOf(battleContent, 'sun', 'gale')).toBe('normal');
    const strong = hit({ ...target, type: 'frost' });
    const normal = hit(target);
    const weak = hit({ ...target, type: 'rain' });
    expect([strong.effectiveness, normal.effectiveness, weak.effectiveness]).toEqual(['strong', 'normal', 'weak']);
    expect(strong.damage).toBeGreaterThan(normal.damage);
    expect(normal.damage).toBeGreaterThan(weak.damage);
  });

  it('lets the battlefield weather boost and weaken moves', () => {
    const sunny = hit(target, 'sun');
    expect(sunny.field).toBe('boosted');
    expect(sunny.damage).toBeGreaterThan(hit(target).damage);
    const rainInSun = hit(target, 'sun', rainTap);
    expect(rainInSun.field).toBe('weakened');
    expect(rainInSun.damage).toBeLessThan(hit(target, null, rainTap).damage);
  });

  it('always does at least 1 damage with a move that has power', () => {
    const tiny = creature('rain-cube', 1);
    const huge = { ...creature('sun-cube', 100), type: 'rain' };
    expect(damageOf(battleContent, tiny, huge, rainTap, { type: 'sun', turnsLeft: null }, battleContent.rules.minRollPercent).damage).toBe(1);
  });
});

describe('a turn', () => {
  it('lets the faster creature move first', () => {
    const state = start(team(['bloom-blob', 30]), team(['gale-blob', 30]));
    const { events } = battleStep(state, [move(0), move(0)], createRng(1), battleContent);
    expect(events[0]).toEqual({ kind: 'turnStarted', turn: 1 });
    expect(usedBy(events)).toEqual([1, 0]);
  });

  it('breaks a speed tie with the seeded RNG, the same way every time', () => {
    const state = start(team(['sun-blob', 50]), team(['sun-blob', 50]));
    const firsts = Array.from({ length: 20 }, (_unused, seed) => usedBy(battleStep(state, [move(0), move(0)], createRng(seed), battleContent).events)[0]);
    expect(new Set(firsts)).toEqual(new Set([0, 1]));
    const again = Array.from({ length: 20 }, (_unused, seed) => usedBy(battleStep(state, [move(0), move(0)], createRng(seed), battleContent).events)[0]);
    expect(again).toEqual(firsts);
  });

  it('resolves a switch before a move, so the new creature takes the hit', () => {
    const state = start(team(['sun-blob', 30], ['rain-cube', 30]), team(['storm-blob', 30]));
    const { state: after, events } = battleStep(state, [switchTo(1), move(0)], createRng(1), battleContent);
    expect(events[1]).toEqual({ kind: 'switched', side: 0, from: 'a1', to: 'a2' });
    expect(events.find((event) => event.kind === 'hit')).toMatchObject({ creature: 'b1', target: 'a2' });
    expect(after.sides[0].active).toBe(1);
  });

  it('never changes the state it was given', () => {
    const state = start(team(['sun-blob', 30], ['rain-cube', 30]), team(['storm-blob', 30]));
    const before = JSON.stringify(state);
    battleStep(state, [switchTo(1), move(1)], createRng(1), battleContent);
    battleStep(state, [move(2), move(0)], createRng(1), battleContent);
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe('fainting and the end', () => {
  const strong = team(['storm-blob', 100]);
  const weak = team(['rain-blob', 5], ['rain-cube', 5]);

  it('makes a side swap out a fainted creature before the next turn', () => {
    const state = start(strong, weak);
    const { state: after, events } = battleStep(state, [move(0), move(0)], createRng(1), battleContent);
    expect(events.slice(-2)).toEqual([
      { kind: 'fainted', side: 1, creature: 'b1' },
      { kind: 'mustSwap', side: 1 },
    ]);
    expect(usedBy(events)).toEqual([0]);
    expect(after).toMatchObject({ phase: 'swap', turn: 1, mustSwap: [false, true] });
    expect(legalActions(after, 0)).toEqual([]);
    expect(legalActions(after, 1)).toEqual([switchTo(1)]);
    const swapped = battleStep(after, [null, switchTo(1)], createRng(1), battleContent);
    expect(swapped.events).toEqual([{ kind: 'switched', side: 1, from: 'b1', to: 'b2' }]);
    expect(swapped.state).toMatchObject({ phase: 'choose', turn: 1, mustSwap: [false, false] });
  });

  it('ends when one side has no creature left', () => {
    let state = start(strong, weak);
    state = battleStep(state, [move(0), move(0)], createRng(1), battleContent).state;
    state = battleStep(state, [null, switchTo(1)], createRng(1), battleContent).state;
    const { state: over, events } = battleStep(state, [move(0), move(0)], createRng(1), battleContent);
    expect(over.phase).toBe('over');
    expect(over.outcome).toEqual({ winner: 0, reason: 'fainted' });
    expect(events.at(-1)).toEqual({ kind: 'ended', winner: 0, reason: 'fainted' });
    expect(legalActions(over, 0)).toEqual([]);
    expect(() => battleStep(over, [null, null], createRng(1), battleContent)).toThrow(BattleError);
  });

  it('refuses illegal actions', () => {
    const state = start(team(['sun-blob', 30], ['rain-cube', 30]), team(['storm-blob', 30]));
    expect(isLegalAction(state, 0, null)).toBe(false);
    expect(isLegalAction(state, 0, switchTo(0))).toBe(false);
    expect(isLegalAction(state, 1, switchTo(1))).toBe(false);
    expect(isLegalAction(state, 0, switchTo(1))).toBe(true);
    expect(() => battleStep(state, [null, move(0)], createRng(1), battleContent)).toThrow(BattleError);
    expect(() => battleStep(state, [switchTo(0), move(0)], createRng(1), battleContent)).toThrow(BattleError);
    const swap = battleStep(start(strong, weak), [move(0), move(0)], createRng(1), battleContent).state;
    expect(() => battleStep(swap, [null, move(0)], createRng(1), battleContent)).toThrow(BattleError);
    expect(() => battleStep(swap, [move(0), switchTo(1)], createRng(1), battleContent)).toThrow(BattleError);
    expect(() => battleStep(swap, [null, switchTo(0)], createRng(1), battleContent)).toThrow(BattleError);
  });
});

describe('weather from moves', () => {
  const calls = team(['rain-cube', 50]);

  it('lasts the turns the rules give, counting the turn it was called', () => {
    const state = start(calls, calls);
    const called = battleStep(state, [move(3), move(0)], createRng(1), battleContent);
    expect(called.events).toContainEqual({ kind: 'weatherStarted', weather: 'rain', turns: battleContent.rules.weatherTurns });
    expect(called.state.weather).toEqual({ type: 'rain', turnsLeft: battleContent.rules.weatherTurns - 1 });
    const { state: later, events } = repeat(called.state, [move(0), move(0)], battleContent.rules.weatherTurns - 1);
    expect(later.weather).toBeNull();
    expect(events.at(-1)).toEqual({ kind: 'weatherEnded', weather: 'rain' });
    expect(later.turn).toBe(battleContent.rules.weatherTurns);
  });

  it('replaces the battlefield weather', () => {
    const state = start(calls, team(['sun-cube', 50]), 'storm');
    expect(battleStep(state, [move(3), move(0)], createRng(1), battleContent).state.weather).toEqual({ type: 'rain', turnsLeft: battleContent.rules.weatherTurns - 1 });
  });
});

describe('the turn limit', () => {
  const content = withRules({ turnLimit: 10 });

  it('ends a battle nobody can finish as a draw when health is level', () => {
    const { state, events } = repeat(start(team(['rain-cube', 50]), team(['rain-cube', 50]), null, content), [move(3), move(3)], 50, content);
    expect(state).toMatchObject({ phase: 'over', turn: 10, outcome: { winner: null, reason: 'turnLimit' } });
    expect(events.at(-1)).toEqual({ kind: 'ended', winner: null, reason: 'turnLimit' });
  });

  it('gives the win to the side with more health left', () => {
    const first = battleStep(start(team(['rain-cube', 50]), team(['rain-cube', 50]), null, content), [move(3), move(0)], createRng(1), content);
    const { state } = repeat(first.state, [move(3), move(3)], 50, content);
    expect(state.outcome).toEqual({ winner: 1, reason: 'turnLimit' });
  });
});
