import { mapFromRows } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/battle-link.ts';
import { createBattleModel, menuFor, resultLines } from '../src/battle-model.ts';
import { QUICK_TAP_MS, TAP_GRACE_MS, playbackMs, playback } from '../src/battle-playback.ts';
import { progress, turn, wildBattle } from './support/battle-messages.ts';

const move = (slot: number) => ({ kind: 'move', slot }) as const;
const LATER = 1_000_000;
/** Every line ten characters long, so each holds the screen the same time. */
const TEN = () => 10;

describe('the battle menu', () => {
  it('offers the active creature’s moves, running, and no treat while the wild creature is fresh', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 30 });
    expect(menuFor(started.payload.battle, true)).toEqual({ moves: ['heat-shimmer', 'sun-ray', 'storm-tap', 'sun-call'], team: false, treat: false, treatReason: 'battle.treatLater', run: true });
  });

  it('offers the team only when another creature can battle', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }, { species: 'puddlepip', level: 5 }, { species: 'snowsnoot', level: 5, hp: 0 }], { species: 'pinwhirl', level: 3 });
    expect(menuFor(started.payload.battle, true).team).toBe(true);
    const { started: alone } = wildBattle([{ species: 'glowbun', level: 5 }, { species: 'snowsnoot', level: 5, hp: 0 }], { species: 'pinwhirl', level: 3 });
    expect(menuFor(alone.payload.battle, true).team).toBe(false);
  });

  it('follows canTreat and canRun, and offers only a treat or leaving once the wild creature faints', () => {
    const { battle, started } = wildBattle([{ species: 'boltkit', level: 100 }], { species: 'puddlepip', level: 3 });
    expect(menuFor({ ...started.payload.battle, canTreat: true }, true)).toMatchObject({ treat: true, treatReason: null });
    expect(menuFor({ ...started.payload.battle, canRun: false }, true).run).toBe(false);
    const { payload } = turn(battle, move(0), move(0));
    expect(payload.battle.phase).toBe('befriend');
    expect(menuFor(payload.battle, true)).toEqual({ moves: [], team: false, treat: true, treatReason: null, run: true });
  });

  it('says why a treat cannot be offered: the wild creature is not tired yet, or there are no treats', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 30 });
    expect(menuFor(started.payload.battle, true).treatReason).toBe('battle.treatLater');
    expect(menuFor({ ...started.payload.battle, canTreat: true }, false)).toMatchObject({ treat: false, treatReason: 'battle.noTreats' });
  });

  it('counts only treats the player still has', () => {
    const model = createBattleModel(TEN);
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 3 });
    model.receive({ ...started, payload: { ...started.payload, battle: { ...started.payload.battle, canTreat: true } } }, 0);
    expect(model.battle(LATER)?.menu.treatReason).toBeNull();
    model.receive(progress([{ species: 'glowbun', level: 5 }], [{ item: 'plain-treat', count: 0 }]), LATER);
    expect(model.battle(LATER)?.menu).toMatchObject({ treat: false, treatReason: 'battle.noTreats' });
    model.receive(progress([{ species: 'glowbun', level: 5 }], [{ item: 'plain-treat', count: 2 }]), LATER);
    expect(model.battle(LATER)?.menu).toMatchObject({ treat: true, treatReason: null });
  });

  it('shows only the team when the active creature fainted, and nothing once the battle is over', () => {
    const { battle } = wildBattle([{ species: 'glowbun', level: 2 }, { species: 'puddlepip', level: 2 }], { species: 'boltkit', level: 60 });
    const { payload } = turn(battle, move(0), move(0));
    expect(payload.battle.mustSwap).toBe(true);
    expect(menuFor(payload.battle, true)).toEqual({ moves: [], team: true, treat: false, treatReason: null, run: false });
    const ran = turn(battle, { kind: 'switch', to: 1 });
    const over = turn(battle, { kind: 'run' });
    expect(ran.payload.battle.mustSwap).toBe(false);
    expect(menuFor(over.payload.battle, true)).toEqual({ moves: [], team: false, treat: false, treatReason: null, run: false });
  });
});

describe('the battle model', () => {
  it('plays a turn from the view before it, then shows the menu under the line it ended on', () => {
    const model = createBattleModel(TEN);
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    expect(model.battle(0)?.playing).toBe(true);
    expect(model.battle(0)?.panel).toBeNull();
    expect(model.battle(LATER)?.panel).toBe('menu');
    const next = turn(battle, move(0), move(0));
    model.receive(next, LATER);
    const steps = playback(started.payload.battle, next.payload.battle, next.payload.events, TEN);
    const firstHit = steps.find((step) => step.event.kind === 'hit');
    expect(model.battle(LATER)?.shown.hp).toEqual(steps[1]?.shown.hp);
    expect(firstHit).toBeDefined();
    const after = model.battle(LATER + playbackMs(steps));
    expect(after?.playing).toBe(false);
    expect(after?.shown.hp.a1).toBe(next.payload.battle.team.creatures[0]?.hp);
  });

  it('moves on to the next line at a tap, but not at the end of the tap that chose the turn', () => {
    const model = createBattleModel(TEN);
    const { started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 }, 'sun');
    model.receive(started, 0);
    expect(model.battle(0)?.line?.id).toBe('battle.go');
    model.advance(TAP_GRACE_MS - 1);
    expect(model.battle(TAP_GRACE_MS - 1)?.line?.id).toBe('battle.go');
    const first = TAP_GRACE_MS;
    model.advance(first);
    expect(model.battle(first)?.line?.id).toBe('battle.wildAppeared');
    const second = first + QUICK_TAP_MS;
    model.advance(second);
    expect(model.battle(second)).toMatchObject({ playing: true, line: { id: 'battle.weather' } });
    model.advance(second + QUICK_TAP_MS);
    expect(model.battle(second + QUICK_TAP_MS)).toMatchObject({ playing: false, line: { id: 'battle.weather' } });
  });

  it('jumps to the end of the turn at a second quick tap', () => {
    const model = createBattleModel(TEN);
    const { started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 }, 'sun');
    model.receive(started, 0);
    model.advance(TAP_GRACE_MS);
    model.advance(TAP_GRACE_MS + QUICK_TAP_MS - 1);
    expect(model.battle(TAP_GRACE_MS + QUICK_TAP_MS - 1)).toMatchObject({ playing: false, line: { id: 'battle.weather' }, panel: 'menu' });
  });

  it('leaves a fainted wild creature without running away, and asks for a treat or Done until then', () => {
    const model = createBattleModel(TEN);
    const { battle, started } = wildBattle([{ species: 'boltkit', level: 100 }], { species: 'puddlepip', level: 3 });
    model.receive(started, 0);
    model.receive(turn(battle, move(0), move(0)), LATER);
    expect(model.battle(LATER * 2)).toMatchObject({ panel: 'menu', line: { id: 'battle.treatOrDone' } });
    model.receive(turn(battle, { kind: 'run' }), LATER * 2);
    const left = model.battle(LATER * 2);
    expect(left?.playing).toBe(false);
    expect(left?.line?.id).not.toBe('battle.ranAway');
  });

  it('draws a reconnection’s view at once, with nothing to animate', () => {
    const model = createBattleModel(TEN);
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
    const model = createBattleModel(TEN);
    const { started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    model.sent();
    expect(model.battle(LATER)?.waiting).toBe(true);
    model.receive({ type: 'refused', payload: { request: 'battle.move', reason: 'notNow' } }, LATER);
    expect(model.battle(LATER)?.waiting).toBe(false);
  });

  it('opens the team or the treats only while the menu allows them', () => {
    const model = createBattleModel(TEN);
    const { started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    model.pick('treats');
    expect(model.battle(LATER)?.panel).toBe('menu');
    model.pick('team');
    expect(model.battle(LATER)?.panel).toBe('menu');
  });

  it('forces the team picker and its line when the active creature faints', () => {
    const model = createBattleModel(TEN);
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 2 }, { species: 'puddlepip', level: 2 }], { species: 'boltkit', level: 60 });
    model.receive(started, 0);
    model.receive(turn(battle, move(0), move(0)), 0);
    const state = model.battle(LATER);
    expect(state?.panel).toBe('team');
    expect(state?.line?.id).toBe('battle.chooseNext');
  });

  it('keeps progress and storage, and shows the result only once its turn has played', () => {
    const model = createBattleModel(TEN);
    model.receive(progress([{ species: 'glowbun', level: 5 }]), 0);
    expect(model.progress()?.needsStarter).toBe(false);
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    model.receive(started, 0);
    const last = turn(battle, { kind: 'run' });
    model.receive(last, LATER);
    model.receive({ type: 'battle.result', payload: { battle: 'battle-1', outcome: { winner: null, reason: 'ran' }, rewards: [], learned: [], woke: null } }, LATER);
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
    const lines = resultLines({ battle: view.id, outcome: { winner: 0, reason: 'befriended' }, rewards: [], learned: [], woke: null }, { battle: view.id, species: 'pinwhirl', placedIn: 'storage' }, view);
    expect(lines).toEqual([{ id: 'battle.befriendedStored', species: 'pinwhirl' }]);
  });

  it('gives experience per creature and a level up only when the level rose', () => {
    const lines = resultLines({ battle: view.id, outcome: { winner: 0, reason: 'fainted' }, rewards: [{ index: 0, xp: 22, level: 6 }, { index: 1, xp: 22, level: 5 }], learned: [], woke: null }, null, view);
    expect(lines).toEqual([
      { id: 'battle.won' },
      { id: 'battle.xp', creature: 'a1', xp: 22 },
      { id: 'battle.levelUp', creature: 'a1', level: 6 },
      { id: 'battle.xp', creature: 'a2', xp: 22 },
    ]);
  });

  it('says which moves a creature learned straight away, after its level up', () => {
    const result = { battle: view.id, outcome: { winner: 0, reason: 'fainted' }, rewards: [{ index: 0, xp: 99, level: 8 }], learned: [{ index: 0, move: 'sun-tap' }], woke: null } as const;
    expect(resultLines(result, null, view).slice(2)).toEqual([
      { id: 'battle.levelUp', creature: 'a1', level: 8 },
      { id: 'battle.learned', creature: 'a1', move: 'sun-tap' },
    ]);
  });

  it('says the team wakes at the shrine after it all fainted', () => {
    const lines = resultLines({ battle: view.id, outcome: { winner: 1, reason: 'fainted' }, rewards: [], learned: [], woke: { map: 'post-island', shrine: null } }, null, view);
    expect(lines).toEqual([{ id: 'battle.teamFainted' }]);
  });
});

describe('storage at a shrine', () => {
  const map = { ...mapFromRows('isle', ['.......']), shrines: { 'isle-shrine': { x: 3, y: 0 } } };
  const stored: ServerMessage = { type: 'storage', payload: { shrine: 'isle-shrine', storage: [] } };

  it('is kept while the courier stands in reach of the shrine, including the step it arrived from', () => {
    const model = createBattleModel(TEN);
    model.receive(stored, 0);
    // The storage message can come before the state that moves the courier onto the shrine.
    model.standingAt(map, { x: 1, y: 0 });
    model.standingAt(map, { x: 2, y: 0 });
    model.standingAt(map, { x: 3, y: 0 });
    model.standingAt(map, { x: 4, y: 0 });
    expect(model.storage()).toEqual(stored.payload);
  });

  it('is forgotten once the courier walks out of reach, until the shrine sends it again', () => {
    const model = createBattleModel(TEN);
    model.standingAt(map, { x: 6, y: 0 });
    model.receive(stored, 0);
    model.standingAt(map, { x: 4, y: 0 });
    model.standingAt(map, { x: 5, y: 0 });
    expect(model.storage()).toBeNull();
    model.standingAt(map, { x: 4, y: 0 });
    expect(model.storage()).toBeNull();
    model.receive(stored, 0);
    expect(model.storage()).toEqual(stored.payload);
  });
});
