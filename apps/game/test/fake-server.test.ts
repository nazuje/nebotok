import { describe, expect, it } from 'vitest';
import { STARTERS } from '../src/battle-content.ts';
import { createBattleModel, type BattleModel } from '../src/battle-model.ts';
import type { ServerMessage } from '../src/battle-link.ts';
import { FAKE_SEED, createFakeServer, type FakeScenario } from '../src/fake-server.ts';

const LATER = 1_000_000_000;

function connected(scenario: FakeScenario, seed = FAKE_SEED) {
  const fake = createFakeServer(scenario, { seed, later: (run) => run() });
  const model = createBattleModel();
  const seen: ServerMessage[] = [];
  fake.link.listen((message) => {
    seen.push(message);
    model.receive(message, 0);
  });
  fake.joined();
  return { fake, model, seen };
}

/** What the browser check does: attack with the first move until a treat is allowed, then offer plain treats. */
function play(fake: ReturnType<typeof createFakeServer>, model: BattleModel): void {
  for (let turns = 0; turns < 40; turns += 1) {
    const state = model.battle(LATER);
    if (!state || state.result) return;
    if (state.menu.treat) fake.link.send({ type: 'battle.treat', payload: { itemId: 'plain-treat' } });
    else if (state.menu.moves.length > 0) fake.link.send({ type: 'battle.move', payload: { slot: 0 } });
    else return;
  }
}

describe('the fake server', () => {
  it('asks a new player for a starter, then gives it with the starting treats', () => {
    const { fake, model } = connected('new');
    expect(model.progress()?.needsStarter).toBe(true);
    fake.stepped();
    expect(model.battle(0)).toBeNull();
    fake.link.send({ type: 'starter.choose', payload: { species: STARTERS.species[0] ?? '' } });
    expect(model.progress()?.team.map((creature) => creature.species)).toEqual([STARTERS.species[0]]);
    expect(model.progress()?.inventory).toEqual(STARTERS.items);
  });

  it('starts one wild battle on the first step, which the browser check’s play befriends', () => {
    const { fake, model, seen } = connected('new');
    fake.link.send({ type: 'starter.choose', payload: { species: STARTERS.species[0] ?? '' } });
    fake.stepped();
    expect(model.battle(0)?.view.phase).toBe('choose');
    play(fake, model);
    const state = model.battle(LATER);
    expect(state?.result?.outcome).toEqual({ winner: 0, reason: 'befriended' });
    expect(state?.befriended).toMatchObject({ species: 'pinwhirl', placedIn: 'team' });
    expect(model.progress()?.team.map((creature) => creature.species)).toEqual([STARTERS.species[0], 'pinwhirl']);
    expect(seen.map((message) => message.type).slice(-3)).toEqual(['battle.befriend', 'battle.result', 'progress']);
    model.close();
    fake.stepped();
    expect(model.battle(LATER)).toBeNull();
  });

  it('reorders the team, and refuses what is not allowed with the reason the server gives', () => {
    const { fake, model, seen } = connected('new');
    fake.link.send({ type: 'starter.choose', payload: { species: STARTERS.species[0] ?? '' } });
    fake.link.send({ type: 'battle.move', payload: { slot: 0 } });
    expect(seen.at(-1)).toEqual({ type: 'refused', payload: { request: 'battle.move', reason: 'notInBattle' } });
    fake.link.send({ type: 'storage.swap', payload: { team: 0, storage: null } });
    expect(seen.at(-1)).toMatchObject({ type: 'refused', payload: { reason: 'notAtShrine' } });
    fake.link.send({ type: 'team.reorder', payload: { order: [0] } });
    expect(model.progress()?.team).toHaveLength(1);
  });

  it('wakes a player whose whole team faints, healed', () => {
    const { fake, model } = connected('faint');
    fake.stepped();
    play(fake, model);
    const state = model.battle(LATER);
    expect(state?.result?.outcome).toEqual({ winner: 1, reason: 'fainted' });
    expect(state?.result?.woke).toEqual({ map: 'post-island', shrine: null });
    expect(model.progress()?.team[0]?.hp).toBeGreaterThan(1);
  });
});
