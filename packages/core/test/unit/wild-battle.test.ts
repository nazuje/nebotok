import { describe, expect, it } from 'vitest';
import {
  BattleError,
  battleStep,
  canOfferTreat,
  createRng,
  isLegalAction,
  legalActions,
  startBattle,
  type BattleAction,
  type BattleContent,
  type BattleSetup,
  type BattleState,
} from '../../src/index.ts';
import { battleContent, withBefriending } from '../support/battle-content.ts';

type Creature = BattleSetup['sides'][number]['creatures'][number];
const wildBattle = (team: readonly Creature[], wild: Creature, content: BattleContent = battleContent) =>
  startBattle({ sides: [{ creatures: [...team] }, { creatures: [wild] }], weather: null, wild: true }, content);
const move = (slot: number): BattleAction => ({ kind: 'move', slot });
const RUN: BattleAction = { kind: 'run' };
const treat = (item = 'plain-treat'): BattleAction => ({ kind: 'treat', item });
const always = withBefriending({ minPercent: 100, maxPercent: 100 });
const never = withBefriending({ basePercent: 0, tiredPercent: 0, favouritePercent: 0, likedPercent: 0, minPercent: 0, maxPercent: 1 });

/** A strong creature knocks a weak wild one out with one hit, which opens the befriend phase. */
function beaten(content: BattleContent = battleContent): BattleState {
  const { state } = wildBattle([{ species: 'boltkit', level: 100 }], { species: 'puddlepip', level: 3 }, content);
  return battleStep(state, [move(0), move(0)], createRng(1), content).state;
}

describe('starting a wild battle', () => {
  it('opens a treat window at the share of health the rules give', () => {
    const { state } = wildBattle([{ species: 'glowbun', level: 10 }], { species: 'puddlepip', level: 8 });
    const wildMaxHp = state.sides[1].creatures[0]!.maxHp;
    expect(state.wild).toEqual({ treatHp: Math.floor((wildMaxHp * battleContent.befriending.windowPercent) / 100) });
    expect(canOfferTreat(state, 0)).toBe(false);
  });

  it('brings each team creature with the health and moves the save gives, and starts with the first that can battle', () => {
    const { state } = wildBattle(
      [
        { species: 'glowbun', level: 10, hp: 0 },
        { species: 'puddlepip', level: 10, hp: 7, moves: ['rain-tap', 'gale-tap'] },
      ],
      { species: 'pinwhirl', level: 5 },
    );
    expect(state.sides[0].active).toBe(1);
    expect(state.sides[0].creatures.map((creature) => creature.hp)).toEqual([0, 7]);
    expect(state.sides[0].creatures[1]!.moves).toEqual(['rain-tap', 'gale-tap']);
    expect(legalActions(state, 0)).toEqual([move(0), move(1), RUN]);
  });

  it('keeps the wild key out of a battle between two teams, so older replays keep their hashes', () => {
    const { state } = startBattle({ sides: [{ creatures: [{ species: 'glowbun', level: 10 }] }, { creatures: [{ species: 'puddlepip', level: 10 }] }], weather: null }, battleContent);
    expect('wild' in state).toBe(false);
    expect(legalActions(state, 0).some((action) => action.kind === 'run')).toBe(false);
    expect(isLegalAction(state, 0, treat())).toBe(false);
  });

  it('refuses a wild battle with more than one wild creature, or a team that cannot battle', () => {
    expect(() => startBattle({ sides: [{ creatures: [{ species: 'glowbun', level: 5 }] }, { creatures: [{ species: 'puddlepip', level: 5 }, { species: 'pinwhirl', level: 5 }] }], weather: null, wild: true }, battleContent)).toThrow(/one wild creature/);
    expect(() => wildBattle([{ species: 'glowbun', level: 5, hp: 0 }], { species: 'puddlepip', level: 5 })).toThrow(BattleError);
  });
});

describe('running', () => {
  it('ends the battle before the wild creature acts, with no winner', () => {
    const { state } = wildBattle([{ species: 'glowbun', level: 10 }], { species: 'pinwhirl', level: 40 });
    const { state: after, events } = battleStep(state, [RUN, move(0)], createRng(1), battleContent);
    expect(events).toEqual([
      { kind: 'turnStarted', turn: 1 },
      { kind: 'ran', side: 0 },
      { kind: 'ended', winner: null, reason: 'ran' },
    ]);
    expect(after.outcome).toEqual({ winner: null, reason: 'ran' });
    expect(legalActions(state, 1).some((action) => action.kind === 'run')).toBe(false);
  });
});

describe('befriending', () => {
  it('lets the player offer a treat or leave once the wild creature faints', () => {
    const state = beaten();
    expect(state.phase).toBe('befriend');
    expect(canOfferTreat(state, 0)).toBe(true);
    expect(canOfferTreat(state, 1)).toBe(false);
    expect(legalActions(state, 0)).toEqual([RUN]);
    expect(legalActions(state, 1)).toEqual([]);
    const left = battleStep(state, [RUN, null], createRng(1), battleContent);
    expect(left.state.outcome).toEqual({ winner: 0, reason: 'fainted' });
  });

  it('ends as befriended when the treat is accepted', () => {
    const state = beaten(always);
    const { state: after, events } = battleStep(state, [treat('rain-treat'), null], createRng(1), always);
    expect(events).toEqual([
      { kind: 'treatOffered', side: 0, item: 'rain-treat', target: 'b1', chance: 100, accepted: true },
      { kind: 'ended', winner: 0, reason: 'befriended' },
    ]);
    expect(after.outcome).toEqual({ winner: 0, reason: 'befriended' });
  });

  it('ends as an ordinary win when a fainted creature refuses', () => {
    const { state, events } = battleStep(beaten(never), [treat(), null], createRng(1), never);
    expect(events[0]).toMatchObject({ kind: 'treatOffered', accepted: false, chance: 0 });
    expect(state.outcome).toEqual({ winner: 0, reason: 'fainted' });
  });

  it('opens the treat window while a worn-down wild creature is still up', () => {
    const { state } = wildBattle([{ species: 'glowbun', level: 10 }], { species: 'pinwhirl', level: 10, hp: 1 }, always);
    expect(canOfferTreat(state, 0)).toBe(true);
    const accepted = battleStep(state, [treat(), move(0)], createRng(1), always);
    expect(accepted.events.some((event) => event.kind === 'used')).toBe(false);
    expect(accepted.state.outcome).toEqual({ winner: 0, reason: 'befriended' });
    const refused = battleStep(wildBattle([{ species: 'glowbun', level: 10 }], { species: 'pinwhirl', level: 10, hp: 1 }, never).state, [treat(), move(0)], createRng(1), never);
    expect(refused.events.map((event) => event.kind).slice(0, 3)).toEqual(['turnStarted', 'treatOffered', 'used']);
  });

  it('refuses a treat at full health, a treat that is not one, and a treat from the wild side', () => {
    const { state } = wildBattle([{ species: 'glowbun', level: 10 }], { species: 'pinwhirl', level: 10 });
    expect(() => battleStep(state, [treat(), move(0)], createRng(1), battleContent)).toThrow(BattleError);
    expect(() => battleStep(beaten(), [treat('rain-tap'), null], createRng(1), battleContent)).toThrow(/not a treat/);
    expect(isLegalAction(beaten(), 1, treat())).toBe(false);
  });

  it('gives the wild creature the win when the whole team faints', () => {
    let { state } = wildBattle([{ species: 'puddlepip', level: 2 }], { species: 'boltkit', level: 80 });
    const rng = createRng(4);
    for (let step = 0; step < 20 && state.phase === 'choose'; step += 1) state = battleStep(state, [move(0), move(0)], rng, battleContent).state;
    expect(state.outcome).toEqual({ winner: 1, reason: 'fainted' });
  });
});
