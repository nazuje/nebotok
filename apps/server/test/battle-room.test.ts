import { ColyseusTestServer } from '@colyseus/testing';
import type { Room } from '@colyseus/sdk';
import {
  MAX_TEAM,
  PROTOCOL_VERSION,
  createSave,
  emptyProgress,
  maxHpOf,
  newCreature,
  xpForWin,
  xpToNextLevel,
  type BattleResult,
  type BattleUpdate,
  type BattleView,
  type BefriendResult,
  type CreatureInstance,
  type MoveOffer,
  type Point,
  type Progress,
  type ProgressMessage,
  type Refused,
  type StorageMessage,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.ts';
import { BATTLE_IDLE_MS } from '../src/battles.ts';
import { OFFER_IDLE_MS, REQUESTS_PER_SECOND, type WorldRoom } from '../src/world-room.ts';
import type { WorldState } from '../src/world-state.ts';
import type { WorldContent } from '../src/world.ts';
import { capturedLog, freePort, repeat, tempServices, until } from './helpers.ts';

// The room's clock runs ahead of the real one by `offset`, so a test can make two minutes pass.
const clock = { offset: 0 };
let temp: ReturnType<typeof tempServices>;
let colyseus: ColyseusTestServer;
let world: WorldContent;
const logged = capturedLog();

/** The one wild creature of every test zone: it loves its favourite treat and does not care for plain ones. */
const WILD = { species: 'drizzlesnail', level: 3 } as const;
const favourite = (): string => world.battle.species.get(WILD.species)!.favouriteTreat!;
const DISLIKED = 'plain-treat';

beforeAll(async () => {
  temp = tempServices(() => Date.now() + clock.offset);
  const real = temp.services.world;
  // Every step in the grass meets the same wild creature, and a treat is either always or never taken.
  world = {
    ...real,
    encounters: new Map(
      [...real.encounters].map(([id, zone]) => [id, { ...zone, encounterPercent: 100, creatures: [{ species: WILD.species, minLevel: WILD.level, maxLevel: WILD.level, weight: 1 }] }]),
    ),
    battle: {
      ...real.battle,
      befriending: { basePercent: 0, tiredPercent: 0, favouritePercent: 100, likedPercent: 0, levelPenaltyPer10Levels: 0, minPercent: 0, maxPercent: 100, windowPercent: 100 },
    },
  };
  const server = createGameServer(temp.config, logged.log, { ...temp.services, world });
  await server.listen(await freePort(), '127.0.0.1');
  colyseus = new ColyseusTestServer(server);
});
afterAll(async () => {
  await colyseus.shutdown();
  temp.dispose();
});
beforeEach(async () => {
  await colyseus.cleanup();
  temp.services.db.exec('DELETE FROM players');
  logged.lines.length = 0;
});

const map = () => world.map;
const grass = (zone: string) => map().encounterAreas.find((area) => area.zone === zone)!;
/** A tile just right of the post-meadow grass, and the grass tile next to it. */
const besideGrass = (): Point => ({ x: grass('post-meadow').x + grass('post-meadow').width, y: grass('post-meadow').y + 1 });
const intoGrass = (): Point => ({ x: grass('post-meadow').x + grass('post-meadow').width - 1, y: grass('post-meadow').y + 1 });
const shrineTile = (): Point => map().shrines['post-shrine']!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Requests are limited to REQUESTS_PER_SECOND, so the tests pace theirs. */
const PACE_MS = Math.ceil(1_000 / REQUESTS_PER_SECOND) + 20;

const strong = (level = 60): CreatureInstance => newCreature('glowbun', level, world.battle);
const weak = (): CreatureInstance => ({ ...newCreature('glowbun', 1, world.battle), hp: 1 });

type Heard = { readonly type: string; readonly payload: unknown };
type Inbox = { readonly heard: Heard[]; take<T>(type: string): Promise<T>; has(type: string): boolean };

/** Every message a room receives, in order; `take` waits for the first one of a type and removes it. */
function inbox(room: Room<unknown, WorldState>): Inbox {
  const heard: Heard[] = [];
  room.onMessage('*', (type: string | number, payload: unknown) => heard.push({ type: String(type), payload }));
  const has = (type: string) => heard.some((message) => message.type === type);
  return {
    heard,
    has,
    async take<T>(type: string): Promise<T> {
      await until(() => has(type), `a ${type} message`, Date.now() + 5_000);
      const [message] = heard.splice(
        heard.findIndex((entry) => entry.type === type),
        1,
      );
      return message!.payload as T;
    },
  };
}

/** `progress` is the one the room sends right after welcome. */
type Player = { id: number; token: string; room: Room<unknown, WorldState>; box: Inbox; progress: ProgressMessage };

async function player(name: string, progress: Partial<Progress> = {}, at: Point = besideGrass()): Promise<Player> {
  const made = await temp.services.profiles.create({ name, avatar: 'green' });
  if (!made.ok) throw new Error(made.error);
  const { id } = made.value;
  const position = { map: map().id, ...at, facing: 'left' as const };
  temp.services.progress.save(id, createSave({ name, language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position, ...emptyProgress(), ...progress }));
  const login = await temp.services.profiles.login({ profileId: id });
  if (!login.ok) throw new Error(login.error);
  colyseus.sdk.auth.token = login.value.token;
  const room = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
  room.reconnection.enabled = false;
  const box = inbox(room);
  await box.take('welcome');
  return { id, token: login.value.token, room, box, progress: await box.take<ProgressMessage>('progress') };
}

const me = ({ room }: Player) => room.state.players.get(room.sessionId);
const saved = (id: number) => temp.services.progress.load(id)?.data;
const roomOf = ({ room }: Player) => colyseus.getRoomById<WorldRoom>(room.roomId);

/** Steps into the grass; a battle starts with `battle.started`, then `progress` with the wild creature seen. */
async function meetWild(who: Player): Promise<{ started: BattleUpdate; progress: ProgressMessage }> {
  who.room.send('walk.to', intoGrass());
  const started = await who.box.take<BattleUpdate>('battle.started');
  return { started, progress: await who.box.take<ProgressMessage>('progress') };
}

/** Sends one battle request and waits for its turn. */
async function act(who: Player, type: string, payload: object): Promise<BattleUpdate> {
  await sleep(PACE_MS);
  who.room.send(type, payload);
  return who.box.take<BattleUpdate>('battle.turn');
}

/** Plays until the battle is over: `choose` picks each request from the view. */
async function fight(who: Player, view: BattleView, choose: (view: BattleView) => [string, object], steps = 0): Promise<BattleResult> {
  if (view.phase === 'over') return who.box.take<BattleResult>('battle.result');
  if (steps > 60) throw new Error('the battle did not end');
  const [type, payload] = choose(view);
  return fight(who, (await act(who, type, payload)).battle, choose, steps + 1);
}

const attackThenLeave = (view: BattleView): [string, object] => (view.phase === 'befriend' ? ['battle.run', {}] : ['battle.move', { slot: 0 }]);

describe('meeting wild creatures', () => {
  it('sends progress after welcome, starts a battle on a step into the grass, and holds the player still', async () => {
    const watcher = await player('Watching Courier', {}, { x: 20, y: 12 });
    const who = await player('Grass Courier', { team: [strong()] });
    expect(who.progress).toMatchObject({ needsStarter: false, team: [{ species: 'glowbun', level: 60 }] });

    const { started, progress } = await meetWild(who);
    expect(started.events.map((event) => event.kind)).toEqual(['switched', 'switched']);
    expect(started.battle).toMatchObject({ phase: 'choose', turn: 0, canRun: true, canTreat: true, mustSwap: false, outcome: null });
    expect(started.battle.opponent.creatures).toEqual([expect.objectContaining({ id: 'b1', ...WILD })]);
    expect(started.battle.opponent.creatures[0]).not.toHaveProperty('moves');
    expect(started.battle.team.creatures[0]).toMatchObject({ id: 'a1', species: 'glowbun', moves: strong().moves });
    expect(progress.seen).toContain(WILD.species);
    await until(() => me(who)?.inBattle === true && watcher.room.state.players.get(who.room.sessionId)?.inBattle === true, 'both to see the battle');
    await until(() => me(who)?.moving === false, 'the courier to stand');
    expect({ x: me(who)!.x, y: me(who)!.y }).toEqual(intoGrass());

    who.room.send('walk.to', besideGrass());
    who.room.send('walk.hold', { direction: 'up' });
    who.room.send('ping', { sentAt: 1 });
    await who.box.take('pong');
    await sleep(300);
    expect({ x: me(who)!.x, y: me(who)!.y, moving: me(who)!.moving }).toEqual({ ...intoGrass(), moving: false });
    expect(who.box.has('walk.refused')).toBe(false);
  });

  it('saves where a battle starts, the creature seen and the team as it was, so a restart puts the player back there', async () => {
    const who = await player('Saved Courier', { team: [strong()] });
    // On through the grass without stopping, so only the battle's start can save this step.
    who.room.send('walk.to', { x: intoGrass().x - 1, y: intoGrass().y });
    await who.box.take<BattleUpdate>('battle.started');
    expect(saved(who.id)).toMatchObject({ position: { ...intoGrass() }, seen: [WILD.species], team: [{ species: 'glowbun', hp: strong().hp }] });
  });

  it('never ambushes a player without a creature that can battle', async () => {
    const who = await player('Starterless Courier');
    expect(who.progress.needsStarter).toBe(true);
    who.room.send('walk.to', intoGrass());
    await until(() => me(who)?.x === intoGrass().x && me(who)?.moving === false, 'the walk into the grass');
    await sleep(100);
    expect(who.box.has('battle.started')).toBe(false);
  });
});

describe('winning and losing', () => {
  it('gives experience for a win, levels up, and saves it', async () => {
    const level = 30;
    const who = await player('Winning Courier', { team: [{ ...strong(level), xp: xpToNextLevel(level) - 1 }] });
    const { started } = await meetWild(who);
    const result = await fight(who, started.battle, attackThenLeave);
    expect(result).toEqual({ battle: started.battle.id, outcome: { winner: 0, reason: 'fainted' }, rewards: [{ index: 0, xp: xpForWin(WILD.level), level: level + 1 }], learned: [], woke: null });
    const progress = await who.box.take<ProgressMessage>('progress');
    expect(progress.team[0]).toMatchObject({ level: level + 1, xp: xpForWin(WILD.level) - 1 });
    await until(() => me(who)?.inBattle === false, 'the battle mark to go');
    expect(saved(who.id)?.team[0]).toMatchObject({ level: level + 1, xp: xpForWin(WILD.level) - 1 });
  });

  it('wakes a player whose whole team fainted at their last shrine, healed and with every treat', async () => {
    const inventory = [{ item: DISLIKED, count: 3 }];
    const who = await player('Fainting Courier', { team: [weak()], inventory, lastShrine: { map: map().id, shrine: 'post-shrine' } });
    const { started } = await meetWild(who);
    const result = await fight(who, started.battle, () => ['battle.move', { slot: 0 }]);
    expect(result).toMatchObject({ outcome: { winner: 1, reason: 'fainted' }, rewards: [], woke: { map: map().id, shrine: 'post-shrine' } });
    const progress = await who.box.take<ProgressMessage>('progress');
    expect(progress.team[0]?.hp).toBe(maxHpOf(weak(), world.battle));
    expect(progress.inventory).toEqual(inventory);
    await until(() => me(who)?.x === shrineTile().x && me(who)?.y === shrineTile().y && me(who)?.inBattle === false, 'the courier to wake at the shrine');
    expect(saved(who.id)).toMatchObject({ position: { ...shrineTile() }, team: [{ hp: maxHpOf(weak(), world.battle) }] });
  });

  it('wakes a player who never rested at a shrine at the spawn', async () => {
    const who = await player('Lost Courier', { team: [weak()] });
    const { started } = await meetWild(who);
    const result = await fight(who, started.battle, () => ['battle.move', { slot: 0 }]);
    expect(result.woke).toEqual({ map: map().id, shrine: null });
  });
});

describe('befriending', () => {
  it('welcomes a creature that takes its favourite treat onto the team', async () => {
    const who = await player('Friendly Courier', { team: [strong()], inventory: [{ item: favourite(), count: 1 }] });
    const { started } = await meetWild(who);
    const turn = await act(who, 'battle.treat', { itemId: favourite() });
    expect(turn.events).toContainEqual(expect.objectContaining({ kind: 'treatOffered', item: favourite(), chance: 100, accepted: true }));
    expect(turn.battle.outcome).toEqual({ winner: 0, reason: 'befriended' });
    expect(await who.box.take<BefriendResult>('battle.befriend')).toEqual({ battle: started.battle.id, species: WILD.species, placedIn: 'team' });
    expect((await who.box.take<BattleResult>('battle.result')).outcome.reason).toBe('befriended');
    const progress = await who.box.take<ProgressMessage>('progress');
    expect(progress.team.map((creature) => creature.species)).toEqual(['glowbun', WILD.species]);
    expect(progress.team[1]).toMatchObject({ level: WILD.level, xp: 0, hp: maxHpOf(WILD, world.battle) });
    expect(progress.befriended).toContain(WILD.species);
    expect(progress.inventory).toEqual([]);
    expect(saved(who.id)?.team).toHaveLength(2);
  });

  it('sends a befriended creature to storage when the team is full', async () => {
    const who = await player('Full Courier', { team: Array.from({ length: MAX_TEAM }, () => strong()), inventory: [{ item: favourite(), count: 2 }] });
    await meetWild(who);
    await act(who, 'battle.treat', { itemId: favourite() });
    expect((await who.box.take<BefriendResult>('battle.befriend')).placedIn).toBe('storage');
    expect(saved(who.id)?.storage.map((creature) => creature.species)).toEqual([WILD.species]);
  });

  it('uses up a refused treat, refuses one the player has not got, and ends the battle at a refused treat after the creature fainted', async () => {
    const who = await player('Unlucky Courier', { team: [strong()], inventory: [{ item: DISLIKED, count: 2 }] });
    await meetWild(who);
    const refusedTurn = await act(who, 'battle.treat', { itemId: DISLIKED });
    expect(refusedTurn.events).toContainEqual(expect.objectContaining({ kind: 'treatOffered', item: DISLIKED, chance: 0, accepted: false }));
    expect(refusedTurn.battle.phase).not.toBe('over');
    expect((await who.box.take<ProgressMessage>('progress')).inventory).toEqual([{ item: DISLIKED, count: 1 }]);

    await sleep(PACE_MS);
    who.room.send('battle.treat', { itemId: favourite() });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'battle.treat', reason: 'noItem' });

    const fainted = await act(who, 'battle.move', { slot: 0 });
    expect(fainted.battle).toMatchObject({ phase: 'befriend', canTreat: true, canRun: true });
    expect(fainted.events).toContainEqual({ kind: 'canBefriend', creature: 'b1' });
    const last = await act(who, 'battle.treat', { itemId: DISLIKED });
    expect(last.battle.outcome).toEqual({ winner: 0, reason: 'fainted' });
    expect((await who.box.take<BattleResult>('battle.result')).rewards).toHaveLength(1);
    expect(who.box.has('battle.befriend')).toBe(false);
    expect(saved(who.id)?.inventory).toEqual([]);
  });
});

describe('battle requests', () => {
  it('refuses what is not allowed now, and runs', async () => {
    const who = await player('Careful Courier', { team: [{ ...strong(), moves: ['sun-tap', 'sun-wallop'] }] });
    who.room.send('battle.move', { slot: 0 });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'battle.move', reason: 'notInBattle' });
    await meetWild(who);
    const requests: [string, object, Refused['reason']][] = [
      ['battle.move', { slot: 3 }, 'notNow'],
      ['battle.switch', { index: 1 }, 'notNow'],
      ['team.reorder', { order: [0] }, 'inBattle'],
      ['storage.swap', { team: 0, storage: null }, 'inBattle'],
      ['starter.choose', { species: 'puddlepip' }, 'inBattle'],
    ];
    await repeat(requests.length, async (index) => {
      const [type, payload, reason] = requests[index]!;
      await sleep(PACE_MS);
      who.room.send(type, payload);
      expect(await who.box.take<Refused>('refused')).toEqual({ request: type, reason });
    });
    const ran = await act(who, 'battle.run', {});
    expect(ran.events.map((event) => event.kind)).toEqual(['turnStarted', 'ran', 'ended']);
    expect(await who.box.take<BattleResult>('battle.result')).toMatchObject({ outcome: { winner: null, reason: 'ran' }, rewards: [], woke: null });
  });

  it(`drops battle requests beyond ${REQUESTS_PER_SECOND} a second, without disconnecting`, async () => {
    const who = await player('Hasty Courier');
    for (let sent = 0; sent < REQUESTS_PER_SECOND * 2; sent += 1) who.room.send('battle.run', {});
    who.room.send('ping', { sentAt: 1 });
    await who.box.take('pong');
    expect(who.box.heard.filter((message) => message.type === 'refused')).toHaveLength(REQUESTS_PER_SECOND);
    expect(who.room.connection.isOpen).toBe(true);
  });

  it('disconnects a client that sends a malformed battle request', async () => {
    const who = await player('Broken Courier', { team: [strong()] });
    const left = new Promise<number>((resolve) => who.room.onLeave((code) => resolve(code)));
    who.room.send('battle.move', { slot: 9 });
    expect(await left).toBe(4002);
  });
});

describe('a battle and the connection', () => {
  it('gives the battle back on reconnecting, and goes on from there', async () => {
    const who = await player('Dropping Courier', { team: [strong()] });
    const { started } = await meetWild(who);
    const { reconnectionToken } = who.room;
    await who.room.leave(false);
    const back = await colyseus.sdk.reconnect<WorldState>(reconnectionToken);
    back.reconnection.enabled = false;
    const again: Player = { ...who, room: back, box: inbox(back) };
    expect((await again.box.take<{ battle: BattleView }>('battle.view')).battle).toEqual(started.battle);
    expect((await again.box.take<ProgressMessage>('progress')).team).toHaveLength(1);
    const result = await fight(again, started.battle, attackThenLeave);
    expect(result.outcome).toEqual({ winner: 0, reason: 'fainted' });
  });

  it(`ends a battle left without input for ${BATTLE_IDLE_MS / 60_000} minutes as a run, and lets the player walk again`, async () => {
    const who = await player('Sleepy Courier', { team: [strong()] });
    await meetWild(who);
    clock.offset += BATTLE_IDLE_MS - 1_000;
    roomOf(who).checkBattles();
    await sleep(100);
    expect(who.box.has('battle.result')).toBe(false);
    clock.offset += 1_000;
    roomOf(who).checkBattles();
    const ended = await who.box.take<BattleUpdate>('battle.turn');
    expect(ended.events.map((event) => event.kind)).toEqual(['ran', 'ended']);
    expect((await who.box.take<BattleResult>('battle.result')).outcome).toEqual({ winner: null, reason: 'ran' });
    await until(() => me(who)?.inBattle === false, 'the battle mark to go');
    who.room.send('walk.to', besideGrass());
    await until(() => me(who)?.x === besideGrass().x && me(who)?.moving === false, 'the walk out of the grass');
  });

  it('ends the battle as a run when the player leaves, keeping the health the team had', async () => {
    const who = await player('Leaving Courier', { team: [{ ...strong(), hp: 5 }] });
    await meetWild(who);
    await who.room.leave();
    await until(() => !roomHasPlayer(who), 'the seat to go');
    expect(saved(who.id)?.team[0]?.hp).toBe(5);
  });
});

/** Meets a wild creature and beats it, attacking with the first move. */
async function winWith(who: Player): Promise<BattleResult> {
  const { started } = await meetWild(who);
  return fight(who, started.battle, attackThenLeave);
}

/** Answers a move offer, paced like every request. */
async function answerOffer(who: Player, offer: number, forget: number | null) {
  await sleep(PACE_MS);
  who.room.send('move.choose', { offer, forget });
}

describe('learning moves at a level up', () => {
  const level = 14;
  /** A glowbun one experience point short of level 15, where it learns sun-wallop. */
  const learner = (moves: string[]): CreatureInstance => ({ ...strong(level), xp: xpToNextLevel(level) - 1, moves });
  const FULL = ['sun-ray', 'storm-tap', 'sun-call', 'heat-shimmer'];

  it('learns a move at once while the creature knows fewer than four, and saves it', async () => {
    const who = await player('Learning Courier', { team: [learner(['sun-ray', 'sun-call'])] });
    const result = await winWith(who);
    expect(result).toMatchObject({ rewards: [{ index: 0, level: level + 1 }], learned: [{ index: 0, move: 'sun-wallop' }] });
    expect((await who.box.take<ProgressMessage>('progress')).team[0]?.moves).toEqual(['sun-ray', 'sun-call', 'sun-wallop']);
    expect(who.box.has('move.offer')).toBe(false);
    expect(saved(who.id)?.team[0]?.moves).toEqual(['sun-ray', 'sun-call', 'sun-wallop']);
  });

  it('offers the move to a creature that knows four, holds the team still, and forgets the one chosen', async () => {
    const who = await player('Choosing Courier', { team: [learner(FULL)] });
    const result = await winWith(who);
    expect(result.learned).toEqual([]);
    const offer = await who.box.take<MoveOffer>('move.offer');
    expect(offer).toEqual({ offer: expect.any(Number), index: 0, species: 'glowbun', move: 'sun-wallop', moves: FULL });
    expect((await who.box.take<ProgressMessage>('progress')).team[0]).toMatchObject({ level: level + 1, moves: FULL });

    await sleep(PACE_MS);
    who.room.send('team.reorder', { order: [0] });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'team.reorder', reason: 'notNow' });
    who.room.send('walk.to', besideGrass());
    await until(() => me(who)?.x === besideGrass().x && me(who)?.moving === false, 'the walk out of the grass');
    who.room.send('walk.to', intoGrass());
    await until(() => me(who)?.x === intoGrass().x && me(who)?.moving === false, 'the walk back into the grass');
    expect(who.box.has('battle.started')).toBe(false);

    await answerOffer(who, offer.offer + 1, 1);
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'move.choose', reason: 'invalid' });
    await answerOffer(who, offer.offer, 1);
    const learned = ['sun-ray', 'sun-wallop', 'sun-call', 'heat-shimmer'];
    expect((await who.box.take<ProgressMessage>('progress')).team[0]?.moves).toEqual(learned);
    expect(saved(who.id)?.team[0]?.moves).toEqual(learned);
    await answerOffer(who, offer.offer, 1);
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'move.choose', reason: 'notNow' });
  });

  it('keeps every move when the player skips the new one', async () => {
    const who = await player('Skipping Courier', { team: [learner(FULL)] });
    await winWith(who);
    const offer = await who.box.take<MoveOffer>('move.offer');
    await who.box.take<ProgressMessage>('progress');
    await answerOffer(who, offer.offer, null);
    expect((await who.box.take<ProgressMessage>('progress')).team[0]).toMatchObject({ level: level + 1, moves: FULL });
    expect(saved(who.id)?.team[0]).toMatchObject({ level: level + 1, moves: FULL });
    expect(who.box.has('move.offer')).toBe(false);
  });

  it('refuses an answer with no offer, and disconnects a client that names a slot past the fourth', async () => {
    const who = await player('Muddled Courier', { team: [learner(FULL)] });
    who.room.send('move.choose', { offer: 1, forget: 0 });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'move.choose', reason: 'notNow' });
    await winWith(who);
    const offer = await who.box.take<MoveOffer>('move.offer');
    const left = new Promise<number>((resolve) => who.room.onLeave((code) => resolve(code)));
    await answerOffer(who, offer.offer, 4);
    expect(await left).toBe(4002);
  });

  it(`skips an offer left unanswered for ${OFFER_IDLE_MS / 60_000} minutes, and meets wild creatures again`, async () => {
    const who = await player('Dawdling Courier', { team: [learner(FULL)] });
    await winWith(who);
    const offer = await who.box.take<MoveOffer>('move.offer');
    await who.box.take<ProgressMessage>('progress');
    clock.offset += OFFER_IDLE_MS - 1_000;
    roomOf(who).checkBattles();
    await sleep(100);
    expect(who.box.has('progress')).toBe(false);
    clock.offset += 1_000;
    roomOf(who).checkBattles();
    expect((await who.box.take<ProgressMessage>('progress')).team[0]?.moves).toEqual(FULL);
    await answerOffer(who, offer.offer, 0);
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'move.choose', reason: 'notNow' });
    who.room.send('walk.to', besideGrass());
    await until(() => me(who)?.x === besideGrass().x && me(who)?.moving === false, 'the walk out of the grass');
    await meetWild(who);
  });

  it('sends the offer again on reconnecting, and takes the answer there', async () => {
    const who = await player('Reconnecting Learner', { team: [learner(FULL)] });
    await winWith(who);
    const offer = await who.box.take<MoveOffer>('move.offer');
    const { reconnectionToken } = who.room;
    await who.room.leave(false);
    const back = await colyseus.sdk.reconnect<WorldState>(reconnectionToken);
    back.reconnection.enabled = false;
    const again: Player = { ...who, room: back, box: inbox(back) };
    await again.box.take<ProgressMessage>('progress');
    expect(await again.box.take<MoveOffer>('move.offer')).toEqual(offer);
    await answerOffer(again, offer.offer, 0);
    expect((await again.box.take<ProgressMessage>('progress')).team[0]?.moves).toEqual(['sun-wallop', 'storm-tap', 'sun-call', 'heat-shimmer']);
  });
});
const roomHasPlayer = (who: Player) => colyseus.getRoomById<WorldRoom>(who.room.roomId)?.state.players.has(who.room.sessionId) ?? false;

describe('the story, before the story server', () => {
  it('keeps a saved story, shows nobody talking, and refuses every talk request for now', async () => {
    const story = { active: [{ quest: 'first-round', step: 0, count: 0 }], done: [], flags: [] };
    const who = await player('Storied Courier', { story });
    expect(me(who)?.talking).toBe(false);
    const requests: [string, object][] = [
      ['talk.start', { npc: 'bavko' }],
      ['talk.next', { conversation: 1, choice: null }],
      ['talk.end', { conversation: 1 }],
    ];
    await repeat(requests.length, async (index) => {
      const [type, payload] = requests[index]!;
      await sleep(PACE_MS);
      who.room.send(type, payload);
      expect(await who.box.take<Refused>('refused')).toEqual({ request: type, reason: 'notNow' });
    });
    await sleep(PACE_MS);
    who.room.send('starter.choose', { species: 'puddlepip' });
    await who.box.take<ProgressMessage>('progress');
    expect(saved(who.id)?.story).toEqual(story);
  });

  it('disconnects a client that sends a malformed talk request', async () => {
    const who = await player('Chatty Courier');
    const left = new Promise<number>((resolve) => who.room.onLeave((code) => resolve(code)));
    who.room.send('talk.next', { conversation: 1, choice: 7 });
    expect(await left).toBe(4002);
  });
});

describe('starters, shrines, team and storage', () => {
  it('gives a new player the starter they choose, once', async () => {
    const who = await player('New Courier');
    expect(who.progress.needsStarter).toBe(true);
    who.room.send('starter.choose', { species: 'boltkit' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'starter.choose', reason: 'invalid' });
    await sleep(PACE_MS);
    who.room.send('starter.choose', { species: 'puddlepip' });
    const progress = await who.box.take<ProgressMessage>('progress');
    expect(progress).toMatchObject({ needsStarter: false, team: [{ species: 'puddlepip', level: world.starters.level }], inventory: world.starters.items, befriended: ['puddlepip'] });
    expect(saved(who.id)?.team).toHaveLength(1);
    await sleep(PACE_MS);
    who.room.send('starter.choose', { species: 'glowbun' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'starter.choose', reason: 'notNow' });
  });

  it('heals the team at a shrine, remembers it, and swaps with storage only there', async () => {
    const stored = newCreature('snowsnoot', 4, world.battle);
    const who = await player('Resting Courier', { team: [{ ...strong(), hp: 3 }, weak()], storage: [stored] }, { x: shrineTile().x - 3, y: shrineTile().y });
    who.room.send('storage.swap', { team: 1, storage: 0 });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'storage.swap', reason: 'notAtShrine' });

    who.room.send('walk.to', shrineTile());
    const rested = await who.box.take<ProgressMessage>('progress');
    expect(rested.lastShrine).toEqual({ map: map().id, shrine: 'post-shrine' });
    expect(rested.team.map((creature) => creature.hp)).toEqual([maxHpOf(strong(), world.battle), maxHpOf(weak(), world.battle)]);
    expect(await who.box.take<StorageMessage>('storage')).toEqual({ shrine: 'post-shrine', storage: [stored] });
    await until(() => me(who)?.x === shrineTile().x && me(who)?.moving === false, 'the courier at the shrine');
    // Resting heals once per visit, however much the player walks about in reach.
    expect(who.box.has('progress')).toBe(false);

    await sleep(PACE_MS);
    who.room.send('storage.swap', { team: 1, storage: 0 });
    expect((await who.box.take<ProgressMessage>('progress')).team.map((creature) => creature.species)).toEqual(['glowbun', 'snowsnoot']);
    expect((await who.box.take<StorageMessage>('storage')).storage).toEqual([{ ...weak(), hp: maxHpOf(weak(), world.battle) }]);

    await sleep(PACE_MS);
    who.room.send('team.reorder', { order: [1, 0] });
    expect((await who.box.take<ProgressMessage>('progress')).team.map((creature) => creature.species)).toEqual(['snowsnoot', 'glowbun']);
    await sleep(PACE_MS);
    who.room.send('team.reorder', { order: [0, 1, 2] });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'team.reorder', reason: 'invalid' });
    expect(saved(who.id)).toMatchObject({ lastShrine: { shrine: 'post-shrine' }, team: [{ species: 'snowsnoot' }, { species: 'glowbun' }] });
  });
});
