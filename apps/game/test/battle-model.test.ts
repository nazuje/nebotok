import { describe, expect, it } from 'vitest';
import { createBattleModel, menuFor, resultLines } from '../src/battle-model.ts';
import { playbackMs, playback } from '../src/battle-playback.ts';
import { progress, turn, wildBattle } from './support/battle-messages.ts';

const move = (slot: number) => ({ kind: 'move', slot }) as const;
const LATER = 1_000_000;

describe('the battle menu', () => {
  it('offers the active creature’s moves, running, and no treat while the wild creature is fresh', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 30 });
    expect(menuFor(started.payload.battle)).toEqual({ moves: ['heat-shimmer', 'sun-ray', 'storm-tap', 'sun-call'], team: false, treat: false, run: true });
  });

  it('offers the team only when another creature can battle', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }, { species: 'puddlepip', level: 5 }, { species: 'snowsnoot', level: 5, hp: 0 }], { species: 'pinwhirl', level: 3 });
    expect(menuFor(started.payload.battle).team).toBe(true);
    const { started: alone } = wildBattle([{ species: 'glowbun', level: 5 }, { species: 'snowsnoot', level: 5, hp: 0 }], { species: 'pinwhirl', level: 3 });
    expect(menuFor(alone.payload.battle).team).toBe(false);
  });

  it('follows canTreat and canRun, and offers only a treat or running once the wild creature faints', () => {
    const { battle, started } = wildBattle([{ species: 'boltkit', level: 100 }], { species: 'puddlepip', level: 3 });
    expect(menuFor({ ...started.payload.battle, canTreat: true }).treat).toBe(true);
    expect(menuFor({ ...started.payload.battle, canRun: false }).run).toBe(false);
    const { payload } = turn(battle, move(0), move(0));
    expect(payload.battle.phase).toBe('befriend');
    expect(menuFor(payload.battle)).toEqual({ moves: [], team: false, treat: true, run: true });
  });

  it('shows only the team when the active creature fainted, and nothing once the battle is over', () => {
    const { battle } = wildBattle([{ species: 'glowbun', level: 2 }, { species: 'puddlepip', level: 2 }], { species: 'boltkit', level: 60 });
    const { payload } = turn(battle, move(0), move(0));
    expect(payload.battle.mustSwap).toBe(true);
    expect(menuFor(payload.battle)).toEqual({ moves: [], team: true, treat: false, run: false });
    const ran = turn(battle, { kind: 'switch', to: 1 });
    const over = turn(battle, { kind: 'run' });
    expect(ran.payload.battle.mustSwap).toBe(false);
    expect(menuFor(over.payload.battle)).toEqual({ moves: [], team: false, treat: false, run: false });
  });
});

describe('the battle model', () => {
  it('plays a turn from the view before it, then shows the menu under the line it ended on', () => {
    const model = createBattleModel();
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    expect(model.battle(0)?.playing).toBe(true);
    expect(model.battle(0)?.panel).toBeNull();
    expect(model.battle(LATER)?.panel).toBe('menu');
    const next = turn(battle, move(0), move(0));
    model.receive(next, LATER);
    const steps = playback(started.payload.battle, next.payload.battle, next.payload.events);
    const firstHit = steps.find((step) => step.event.kind === 'hit');
    expect(model.battle(LATER)?.shown.hp).toEqual(steps[1]?.shown.hp);
    expect(firstHit).toBeDefined();
    const after = model.battle(LATER + playbackMs(steps));
    expect(after?.playing).toBe(false);
    expect(after?.shown.hp.a1).toBe(next.payload.battle.team.creatures[0]?.hp);
  });

  it('jumps to the end of a turn when tapped', () => {
    const model = createBattleModel();
    const { started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 }, 'sun');
    model.receive(started, 0);
    model.skip();
    expect(model.battle(1)?.playing).toBe(false);
    expect(model.battle(1)?.line?.id).toBe('battle.weather');
  });

  it('draws a reconnection’s view at once, with nothing to animate', () => {
    const model = createBattleModel();
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    turn(battle, move(0), move(0));
    const missed = turn(battle, move(0), move(0));
    model.receive({ type: 'battle.view', payload: { battle: missed.payload.battle } }, 0);
    const shown = model.battle(0);
    expect(shown?.playing).toBe(false);
    expect(shown?.view).toBe(missed.payload.battle);
    expect(shown?.shown.hp.b1).toBe(missed.payload.battle.opponent.creatures[0]?.hp);
    expect(started.payload.battle.id).toBe(missed.payload.battle.id);
  });

  it('waits after a choice until the server answers, a refusal included', () => {
    const model = createBattleModel();
    const { started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    model.sent();
    expect(model.battle(LATER)?.waiting).toBe(true);
    model.receive({ type: 'refused', payload: { request: 'battle.move', reason: 'notNow' } }, LATER);
    expect(model.battle(LATER)?.waiting).toBe(false);
  });

  it('opens the team or the treats only while the menu allows them', () => {
    const model = createBattleModel();
    const { started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    model.pick('treats');
    expect(model.battle(LATER)?.panel).toBe('menu');
    model.pick('team');
    expect(model.battle(LATER)?.panel).toBe('menu');
  });

  it('forces the team picker and its line when the active creature faints', () => {
    const model = createBattleModel();
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 2 }, { species: 'puddlepip', level: 2 }], { species: 'boltkit', level: 60 });
    model.receive(started, 0);
    model.receive(turn(battle, move(0), move(0)), 0);
    const state = model.battle(LATER);
    expect(state?.panel).toBe('team');
    expect(state?.line?.id).toBe('battle.chooseNext');
  });

  it('keeps progress and storage, and shows the result only once its turn has played', () => {
    const model = createBattleModel();
    model.receive(progress([{ species: 'glowbun', level: 5 }]), 0);
    expect(model.progress()?.needsStarter).toBe(false);
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    const last = turn(battle, { kind: 'run' });
    model.receive(last, LATER);
    model.receive({ type: 'battle.result', payload: { battle: 'battle-1', outcome: { winner: null, reason: 'ran' }, rewards: [], woke: null } }, LATER);
    expect(model.battle(LATER)?.panel).toBeNull();
    expect(model.battle(LATER * 2)?.panel).toBe('result');
    model.close();
    expect(model.battle(LATER * 2)).toBeNull();
  });
});

describe('the result lines', () => {
  const { started } = wildBattle([{ species: 'glowbun', level: 5 }, { species: 'puddlepip', level: 5 }], { species: 'pinwhirl', level: 3 });
  const view = started.payload.battle;

  it('names a befriended creature and where it went', () => {
    const lines = resultLines({ battle: view.id, outcome: { winner: 0, reason: 'befriended' }, rewards: [], woke: null }, { battle: view.id, species: 'pinwhirl', placedIn: 'storage' }, view);
    expect(lines).toEqual([{ id: 'battle.befriendedStored', species: 'pinwhirl' }]);
  });

  it('gives experience per creature and a level up only when the level rose', () => {
    const lines = resultLines({ battle: view.id, outcome: { winner: 0, reason: 'fainted' }, rewards: [{ index: 0, xp: 22, level: 6 }, { index: 1, xp: 22, level: 5 }], woke: null }, null, view);
    expect(lines).toEqual([
      { id: 'battle.won' },
      { id: 'battle.xp', creature: 'a1', xp: 22 },
      { id: 'battle.levelUp', creature: 'a1', level: 6 },
      { id: 'battle.xp', creature: 'a2', xp: 22 },
    ]);
  });

  it('says the team wakes at the shrine after it all fainted', () => {
    const lines = resultLines({ battle: view.id, outcome: { winner: 1, reason: 'fainted' }, rewards: [], woke: { map: 'post-island', shrine: null } }, null, view);
    expect(lines).toEqual([{ id: 'battle.teamFainted' }]);
  });
});
