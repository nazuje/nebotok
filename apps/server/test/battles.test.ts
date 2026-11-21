import {
  MAX_TEAM,
  PLAYER_SIDE,
  STORAGE_LIMIT,
  arenaWildSetup,
  emptyProgress,
  fightContentOf,
  fightStart,
  maxHpOf,
  newCreature,
  wildLoadout,
  type BattleAction,
  type FightCreature,
  type Progress,
  type WildFight,
  type WildResult,
} from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { abandonBattle, beginBattle, commitStep, nextStep, planRequest, playStep, settleBattle, settleFight, storageRefusal, wildSlipPercent, type LiveBattle } from '../src/battles.ts';
import { loadWorld } from '../src/world.ts';

const world = loadWorld();
const content = world.battle;
const zone = world.encounters.get('post-meadow')!;
const WILD = { species: 'drizzlesnail', level: 3 } as const;

const progressWith = (progress: Partial<Progress>): Progress => ({ ...emptyProgress(), ...progress });
const begin = (progress: Progress, seed = 7): LiveBattle => beginBattle({ id: 'battle-1', seed, zone, wild: WILD, team: progress.team, content, now: 1_000 }).battle;

/** Plays the first legal move each step until the battle is over or leaves `choose`. */
function playOut(battle: LiveBattle, until: (battle: LiveBattle) => boolean = (live) => live.state.phase === 'over'): LiveBattle {
  for (let step = 0; !until(battle); step += 1) {
    if (step > 100) throw new Error('the battle did not end');
    const action: BattleAction = battle.state.phase === 'befriend' ? { kind: 'run' } : { kind: 'move', slot: 0 };
    playStep(battle, action, content);
  }
  return battle;
}

describe('wild creatures', () => {
  it('slip less the higher their level, and never from level 15', () => {
    expect([1, 5, 10, 14, 15, 40].map(wildSlipPercent)).toEqual([28, 20, 10, 2, 0, 0]);
  });

  it('play the same battle from the same seed, and another from another', () => {
    const progress = progressWith({ team: [newCreature('glowbun', 6, content)] });
    const events = (seed: number) => playOut(begin(progress, seed)).events;
    expect(events(42)).toEqual(events(42));
    // A short battle can play out the same from two seeds, so another seed is looked for among a few.
    expect([43, 44, 45, 46, 47].some((seed) => JSON.stringify(events(seed)) !== JSON.stringify(events(42)))).toBe(true);
  });
});

describe('planning a request', () => {
  const progress = progressWith({ team: [newCreature('glowbun', 6, content)], inventory: [{ item: 'plain-treat', count: 1 }, { item: 'gale-treat', count: 1 }] });

  it('allows a legal move and refuses one the creature does not know', () => {
    const { state } = begin(progressWith({ team: [{ ...newCreature('glowbun', 6, content), moves: ['sun-tap'] }] }));
    expect(planRequest({ kind: 'move', slot: 0 }, state, progress, content)).toEqual({ ok: true, action: { kind: 'move', slot: 0 }, progress });
    expect(planRequest({ kind: 'move', slot: 3 }, state, progress, content)).toEqual({ ok: false, reason: 'notNow' });
    expect(planRequest({ kind: 'switch', index: 1 }, state, progress, content)).toEqual({ ok: false, reason: 'notNow' });
  });

  it('refuses a treat while the wild creature is still too lively to take one', () => {
    expect(content.befriending.windowPercent).toBeLessThan(100);
    expect(planRequest({ kind: 'treat', itemId: 'plain-treat' }, begin(progress).state, progress, content)).toEqual({ ok: false, reason: 'notNow' });
  });

  it('uses up an offered treat, and refuses a missing one, or one without room', () => {
    const open = { ...content, befriending: { ...content.befriending, windowPercent: 100 } };
    const { state } = beginBattle({ id: 'battle-1', seed: 7, zone, wild: WILD, team: progress.team, content: open, now: 1_000 }).battle;
    const planned = planRequest({ kind: 'treat', itemId: 'plain-treat' }, state, progress, open);
    expect(planned).toEqual({ ok: true, action: { kind: 'treat', item: 'plain-treat' }, progress: { ...progress, inventory: [{ item: 'gale-treat', count: 1 }] } });
    expect(planRequest({ kind: 'treat', itemId: 'sun-treat' }, state, progress, open)).toEqual({ ok: false, reason: 'noItem' });
    const crowded = { ...progress, team: Array.from({ length: MAX_TEAM }, () => newCreature('glowbun', 1, content)), storage: Array.from({ length: STORAGE_LIMIT }, () => newCreature('glowbun', 1, content)) };
    expect(planRequest({ kind: 'treat', itemId: 'plain-treat' }, state, crowded, open)).toEqual({ ok: false, reason: 'full' });
  });
});

describe('playing a step', () => {
  it('changes nothing, random numbers included, when the step throws', () => {
    const battle = begin(progressWith({ team: [newCreature('glowbun', 6, content)] }));
    const before = { state: battle.state, events: battle.events.length, battleRng: battle.battleRng.state(), wildRng: battle.wildRng.state() };
    expect(() => playStep(battle, { kind: 'switch', to: 5 }, content)).toThrow(/cannot/);
    expect({ state: battle.state, events: battle.events.length, battleRng: battle.battleRng.state(), wildRng: battle.wildRng.state() }).toEqual(before);
    expect(battle.state).toBe(before.state);
  });

  it('applies a step only when committed', () => {
    const battle = begin(progressWith({ team: [newCreature('glowbun', 6, content)] }));
    const before = battle.state;
    const step = nextStep(battle, { kind: 'move', slot: 0 }, content);
    expect(battle.state).toBe(before);
    commitStep(battle, step);
    expect(battle.state).toBe(step.state);
    expect(battle.events.slice(-step.events.length)).toEqual(step.events);
  });
});

describe('ending a battle', () => {
  it('ends an abandoned battle as a run, or as a win once the wild creature fainted', () => {
    const progress = progressWith({ team: [newCreature('glowbun', 60, content)] });
    const early = begin(progress);
    expect(abandonBattle(early)).toEqual([{ kind: 'ran', side: PLAYER_SIDE }, { kind: 'ended', winner: null, reason: 'ran' }]);
    expect(early.state).toMatchObject({ phase: 'over', outcome: { winner: null, reason: 'ran' } });

    const beaten = playOut(begin(progress), (live) => live.state.phase === 'befriend');
    abandonBattle(beaten);
    expect(beaten.state.outcome).toEqual({ winner: PLAYER_SIDE, reason: 'fainted' });
    expect(settleBattle(progress, beaten, content).rewards).toEqual([expect.objectContaining({ index: 0 })]);
  });

  it('keeps the health a lost battle left, and says the team fainted', () => {
    const progress = progressWith({ team: [{ ...newCreature('glowbun', 1, content), hp: 1 }] });
    const settled = settleBattle(progress, playOut(begin(progress)), content);
    expect(settled).toMatchObject({ rewards: [], befriended: null, fainted: true });
    expect(settled.progress.team[0]?.hp).toBe(0);
  });

  it('gives no experience for a run', () => {
    const progress = progressWith({ team: [newCreature('glowbun', 6, content)] });
    const battle = begin(progress);
    playStep(battle, { kind: 'run' }, content);
    expect(settleBattle(progress, battle, content)).toEqual({ progress, rewards: [], learned: [], offers: [], befriended: null, fainted: false });
  });
});

describe('settling a wild arena fight', () => {
  const fightContent = fightContentOf(content);
  const progress = progressWith({ team: [newCreature('glowbun', 6, content), { ...newCreature('puddlepip', 6, content), hp: 3 }, { ...newCreature('pinwhirl', 6, content), hp: 0 }] });
  const started = fightStart(
    arenaWildSetup({ seed: 1, team: progress.team, wild: WILD, wildLoadout: wildLoadout(WILD.species, WILD.level, fightContent), turtle: false, inventory: [], content }),
    fightContent,
  ) as WildFight;
  const ended = (result: WildResult, team: (creature: FightCreature) => Partial<FightCreature>): WildFight => {
    const fight = structuredClone(started);
    for (const creature of fight.team) Object.assign(creature, { fought: true }, team(creature));
    return { ...fight, outcome: { result, tick: 90 } };
  };
  const full = progress.team.map((creature) => maxHpOf(creature, content));

  it('rests the whole team to full health after a loss, and still wakes the player at the shrine when every creature was knocked out', () => {
    const knockedOut = settleFight(progress, ended('lost', () => ({ health: 0 })), content);
    expect(knockedOut.progress.team.map((creature) => creature.hp)).toEqual(full);
    expect(knockedOut).toMatchObject({ rewards: [], fainted: true });
    const rungOut = settleFight(progress, ended('lost', (creature) => (creature.place === 0 ? { health: 0 } : { health: 7, out: true })), content);
    expect(rungOut.progress.team.map((creature) => creature.hp)).toEqual(full);
    expect(rungOut).toMatchObject({ rewards: [], fainted: false });
  });

  it('keeps the health a won fight left', () => {
    const won = settleFight(progress, ended('won', () => ({ health: 7 })), content);
    expect(won.progress.team.map((creature) => creature.hp)).toEqual([1, 1, 0]);
  });
});

describe('storage refusals', () => {
  it('say full only when the side a creature goes to has no room', () => {
    const full = progressWith({ team: Array.from({ length: MAX_TEAM }, () => newCreature('glowbun', 1, content)) });
    expect(storageRefusal(full, null, 0)).toBe('full');
    expect(storageRefusal(full, 7, null)).toBe('invalid');
    expect(storageRefusal(progressWith({}), 0, 0)).toBe('invalid');
  });
});
