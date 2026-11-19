import { ColyseusTestServer } from '@colyseus/testing';
import type { Room } from '@colyseus/sdk';
import { matchMaker } from '@colyseus/core';
import {
  ARENA_BETWEEN_MS,
  ARENA_IDLE,
  ARENA_NONE,
  ARENA_PICK_MS,
  PROTOCOL_VERSION,
  cleanArenaInput,
  createSave,
  defaultSettings,
  emptyProgress,
  arenaContentOf,
  fightContentOf,
  fightHash,
  fightStart,
  fightStep,
  newCreature,
  wildLoadout,
  type ArenaJoinMessage,
  type ArenaResultMessage,
  type ArenaStartedMessage,
  type Progress,
  type ProgressMessage,
  type Refused,
  type RoundsFightSetup,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.ts';
import { BATTLE_IDLE_MS } from '../src/battles.ts';
import { ARENA_ROOM, createFightBook, type FightEnd } from '../src/fights.ts';
import type { ArenaRoom } from '../src/arena-room.ts';
import type { ArenaRoomState } from '../src/arena-state.ts';
import type { WorldRoom } from '../src/world-room.ts';
import type { WorldState } from '../src/world-state.ts';
import { capturedLog, freePort, repeat, tempServices, until } from './helpers.ts';

// The rooms' clock runs ahead of the real one by `offset`, so a test can make two minutes pass.
const clock = { offset: 0 };
let temp: ReturnType<typeof tempServices>;
let colyseus: ColyseusTestServer;
const fights = createFightBook();
const logged = capturedLog('info');

const WILD = { species: 'drizzlesnail', level: 3 } as const;
const PRACTICE = [WILD, { species: 'glowbun', level: 3 }, { species: 'pinwhirl', level: 3 }] as const;

beforeAll(async () => {
  temp = tempServices(() => Date.now() + clock.offset);
  const server = createGameServer({ ...temp.config, arenaBattles: true }, logged.log, temp.services, { fights, recordFights: true });
  await server.listen(await freePort(), '127.0.0.1');
  colyseus = new ColyseusTestServer(server);
});
afterAll(async () => {
  await colyseus.shutdown();
  temp.dispose();
});
beforeEach(async () => {
  clock.offset = 0;
  await colyseus.cleanup();
  temp.services.db.exec('DELETE FROM players');
  logged.lines.length = 0;
});

const world = () => temp.services.world;
const content = () => fightContentOf(world().battle);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Heard = { readonly type: string; readonly payload: unknown };
type Inbox = { readonly heard: Heard[]; take<T>(type: string): Promise<T>; count(type: string): number };

function inbox(room: Room): Inbox {
  const heard: Heard[] = [];
  room.onMessage('*', (type: string | number, payload: unknown) => heard.push({ type: String(type), payload }));
  const count = (type: string) => heard.filter((message) => message.type === type).length;
  return {
    heard,
    count,
    async take<T>(type: string): Promise<T> {
      await until(() => count(type) > 0, `a ${type} message`, Date.now() + 5_000);
      const [message] = heard.splice(
        heard.findIndex((entry) => entry.type === type),
        1,
      );
      return message!.payload as T;
    },
  };
}

type Player = { id: number; token: string; room: Room<unknown, WorldState>; box: Inbox };

async function player(name: string, progress: Partial<Progress> = {}): Promise<Player> {
  const made = await temp.services.profiles.create({ name, avatar: 'green' });
  if (!made.ok) throw new Error(made.error);
  const { id } = made.value;
  const spawn = world().map.spawns['player']!;
  const position = { map: world().map.id, x: spawn.x, y: spawn.y, facing: 'down' as const };
  const team = [newCreature('glowbun', 20, world().battle)];
  temp.services.progress.save(id, createSave({ settings: defaultSettings(), name, language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position, ...emptyProgress(), team, ...progress }));
  const login = await temp.services.profiles.login({ profileId: id });
  if (!login.ok) throw new Error(login.error);
  colyseus.sdk.auth.token = login.value.token;
  const room = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
  room.reconnection.enabled = false;
  const box = inbox(room);
  await box.take('welcome');
  await box.take<ProgressMessage>('progress');
  return { id, token: login.value.token, room, box };
}

const worldRoomOf = ({ room }: Player) => colyseus.getRoomById<WorldRoom>(room.roomId);
const saved = (id: number) => temp.services.progress.load(id)?.data;
/** A level 5 fighter the computer plays, with a wild creature's buttons. */
const computer = (id: string, species: string) => ({ id, species, level: 5, loadout: wildLoadout(species, 5, arenaContentOf(world().battle)), turtle: false, computer: true });
/** A level 40 team creature at `place`, and a level 1 one of the other side's: a best of 3 that ends soon. */
const strong = (place: number, species: string) => ({ place, fighter: { ...computer(`a${place + 1}`, species), level: 40, computer: false } });
const weak = (at: number) => ({ place: null, fighter: { ...computer(`b${at + 1}`, WILD.species), level: 1 } });
const settledLogs = () => logged.lines.filter((line) => line['msg'] === 'fight settled');

/** Starts a wild fight for the player and returns its `arena.join`. */
async function startFight(who: Player): Promise<ArenaJoinMessage> {
  const fightId = await worldRoomOf(who).startWildFight(who.id, WILD);
  expect(fightId).not.toBeNull();
  const join = await who.box.take<ArenaJoinMessage>('arena.join');
  expect(join.fightId).toBe(fightId);
  return join;
}

/** Starts a best of 3 against BOT for the player, as the `arena.practice` switch does, and returns its `arena.join`. */
async function startPractice(who: Player): Promise<ArenaJoinMessage> {
  const fightId = await worldRoomOf(who).startPractice(who.id, PRACTICE);
  expect(fightId).not.toBeNull();
  return who.box.take<ArenaJoinMessage>('arena.join');
}

type Fighter = { room: Room<unknown, ArenaRoomState>; box: Inbox; server: ArenaRoom };

async function enter(who: Player, join: ArenaJoinMessage): Promise<Fighter> {
  colyseus.sdk.auth.token = who.token;
  const room = await colyseus.sdk.consumeSeatReservation<ArenaRoomState>(join.reservation);
  room.reconnection.enabled = false;
  return { room, box: inbox(room), server: colyseus.getRoomById<ArenaRoom>(room.roomId) };
}

/** Streams one input, as a client does once per fixed step. */
function send(fighter: Fighter, input: Partial<Record<'dir' | 'press', number> & Record<'dash' | 'treat' | 'swap' | 'leave', boolean>>) {
  const handle = fighter.room.input();
  Object.assign(handle.data, { dir: ARENA_NONE, press: ARENA_NONE, dash: false, treat: false, swap: false, leave: false }, input);
  handle.send();
}

type Input = Parameters<typeof send>[1];

/** Streams `count` inputs a step apart, as a client at 30 inputs a second does. */
async function stream(fighter: Fighter, count: number, input: (index: number) => Input) {
  await repeat(count, async (index) => {
    send(fighter, input(index));
    await sleep(33);
  });
}

describe('the arena room', () => {
  it('plays a wild fight joined with the reservation from arena.join, and keeps the seat busy in the world', async () => {
    const who = await player('Test Courier');
    const join = await startFight(who);
    const fighter = await enter(who, join);
    const started = await fighter.box.take<ArenaStartedMessage>('arena.started');
    expect(started).toMatchObject({ fightId: join.fightId, mode: 'wild', side: 0 });
    expect(started.sides[0]).toEqual([expect.objectContaining({ id: 'a1', species: 'glowbun', level: 20, place: 0 })]);
    expect(started.sides[1]).toEqual([expect.objectContaining({ id: 'b1', species: WILD.species, level: WILD.level, place: null })]);
    await until(() => fighter.room.state.tick > 30, 'the fight to run');
    expect(fighter.room.state.bodies.map((body) => body.id)).toEqual(['a1', 'b1']);
    expect(fighter.room.state.limit).toBe(content().arena.island.limitTicks);
    expect(who.room.state.players.get(who.room.sessionId)?.inBattle).toBe(true);
    expect(saved(who.id)?.seen).toContain(WILD.species);
    // The world takes no walking while the fight goes on.
    const before = { ...who.room.state.players.get(who.room.sessionId)! };
    who.room.send('walk.to', { x: before.x + 1, y: before.y });
    await sleep(200);
    expect(who.room.state.players.get(who.room.sessionId)).toMatchObject({ x: before.x, y: before.y });
    // The stick moves the player's creature.
    const x = fighter.room.state.bodies[0]!.x;
    await stream(fighter, 15, () => ({ dir: 0 }));
    await until(() => fighter.room.state.bodies[0]!.x > x, 'the creature to walk right');
    expect(logged.lines.filter((line) => line['msg'] === 'fight started')).toHaveLength(1);
  });

  it('refuses joining by matchmaking, without a ticket, with another player’s or with a used reservation', async () => {
    const who = await player('Test Courier');
    const other = await player('Other Courier');
    const join = await startFight(who);
    const roomId = join.reservation.roomId;

    colyseus.sdk.auth.token = who.token;
    await expect(colyseus.sdk.joinOrCreate(ARENA_ROOM, { fightId: join.fightId })).rejects.toThrow(/seat from the world room/);
    await expect(colyseus.sdk.create(ARENA_ROOM, { fightId: join.fightId })).rejects.toThrow(/seat from the world room/);
    await expect(colyseus.sdk.joinById(roomId, { ticket: 'made-up' })).rejects.toThrow(/seat from the world room/);
    expect(await matchMaker.query({ name: ARENA_ROOM })).toHaveLength(1);

    // A seat with no ticket, or another player's session on this player's ticket.
    const room = matchMaker.getLocalRoomById(roomId)!;
    const bare = await matchMaker.reserveSeatFor(await matchMaker.getRoomById(roomId), {});
    await expect(colyseus.sdk.consumeSeatReservation(bare)).rejects.toThrow(/ticket/);
    colyseus.sdk.auth.token = other.token;
    await expect(colyseus.sdk.consumeSeatReservation(join.reservation)).rejects.toThrow(/another player/);
    // The seat and its ticket went with that attempt, so even their own player needs a new one.
    colyseus.sdk.auth.token = who.token;
    const again = await fights.reserve(join.fightId, who.id);
    await expect(colyseus.sdk.consumeSeatReservation(join.reservation)).rejects.toThrow(/expired/);
    expect(room.clients).toHaveLength(0);
    // Nobody but the fight's own player gets a seat at all.
    expect(await fights.reserve(join.fightId, other.id)).toBeNull();
    const fighter = await enter(who, { fightId: join.fightId, reservation: again! });
    await fighter.box.take('arena.started');
    expect(room.clients).toHaveLength(1);
    expect(fighter.server.current.outcome).toBeNull();
    expect(logged.lines.filter((line) => line['msg'] === 'fighter refused')).toHaveLength(2);
  });

  it('turns garbage input into none and keeps going', () => {
    expect(cleanArenaInput({ dir: Number.NaN, press: 9999, dash: 'yes', treat: 1, swap: null, leave: 'true' })).toEqual({
      dir: ARENA_NONE,
      press: ARENA_NONE,
      dash: false,
      treat: false,
      swap: false,
      leave: false,
    });
    expect(cleanArenaInput({ dir: '3', press: -1 })).toMatchObject({ dir: ARENA_NONE, press: ARENA_NONE });
    expect(cleanArenaInput({ dir: 2.5, press: 3 })).toMatchObject({ dir: ARENA_NONE, press: ARENA_NONE });
    expect(cleanArenaInput({ dir: 15, press: 2, dash: true })).toMatchObject({ dir: 15, press: 2, dash: true });
  });

  it('clamps out-of-range input from the wire without crashing', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    const garbage = [{ dir: 200, press: 7 }, { dir: Number.NaN, press: Number.NaN }, { dir: 9999, press: 9999 }, { dir: -1, press: 254 }];
    await stream(fighter, garbage.length, (index) => garbage[index]!);
    const tick = fighter.room.state.tick;
    await until(() => fighter.room.state.tick > tick + 10, 'the fight to keep running');
    expect(fighter.room.connection.isOpen).toBe(true);
    expect(fighter.server.current.outcome).toBeNull();
    expect(logged.lines.filter((line) => line['level'] === 'error')).toEqual([]);
  });

  it('disconnects a client that sends 100 messages a second', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    const left = new Promise<number>((resolve) => fighter.room.onLeave((code) => resolve(code)));
    for (let index = 0; index < 100; index += 1) send(fighter, { dir: 4 });
    expect(await left).not.toBe(1000);
    // Away, so the fight waits for it.
    await until(() => fighter.server.paused, 'the fight to wait');
  });

  it('drops presses beyond ten a second and counts them', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    // A new press every step: dash and button 1 by turns, 30 a second.
    await stream(fighter, 30, (index) => (index % 2 === 0 ? { dash: true } : { press: 0 }));
    await until(() => fighter.server.stats.droppedPresses >= 10, 'presses to be dropped');
    expect(fighter.server.stats.droppedPresses).toBeLessThanOrEqual(20);
  });

  it('pauses a wild fight while its player is away, resumes on reconnect, and ends it as ran after BATTLE_IDLE_MS', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    await until(() => fighter.room.state.tick > 10, 'the fight to run');
    const { reconnectionToken } = fighter.room;
    await fighter.room.leave(false);
    await until(() => fighter.server.paused, 'the fight to wait');
    const tick = fighter.server.current.tick;
    await sleep(300);
    expect(fighter.server.current.tick).toBe(tick);

    const back = await colyseus.sdk.reconnect<ArenaRoomState>(reconnectionToken);
    back.reconnection.enabled = false;
    const backBox = inbox(back);
    expect((await backBox.take<ArenaStartedMessage>('arena.started')).side).toBe(0);
    await until(() => fighter.server.current.tick > tick + 10, 'the fight to resume');

    await back.leave(false);
    await until(() => fighter.server.paused, 'the fight to wait again');
    clock.offset = BATTLE_IDLE_MS;
    const result = await who.box.take<ArenaResultMessage>('arena.result');
    expect(result.outcome).toMatchObject({ result: 'ran' });
    expect(logged.lines.find((line) => line['msg'] === 'fight ended')).toMatchObject({ why: 'away', outcome: 'ran' });
  });

  it('refuses a reconnection to the fight once the profile has signed out', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    const { reconnectionToken } = fighter.room;
    await fighter.room.leave(false);
    await until(() => fighter.server.paused, 'the fight to wait');
    // Signed out on another device: the world seat is still away, so only the arena room checks.
    temp.services.profiles.logout(who.token);
    const back = await colyseus.sdk.reconnect<ArenaRoomState>(reconnectionToken).catch(() => null);
    if (back) await until(() => !back.connection.isOpen, 'the reconnection to be closed');
    expect(logged.lines.some((line) => line['msg'] === 'reconnection refused: signed out' && line['fight'] === fighter.server.fightId)).toBe(true);
  });

  it('offers a new seat to a player still in the world whose seat in the fight room is gone', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    await fighter.room.leave(true);
    await until(() => fighter.server.paused, 'the fight to wait');
    const again = await enter(who, await who.box.take<ArenaJoinMessage>('arena.join'));
    expect((await again.box.take<ArenaStartedMessage>('arena.started')).side).toBe(0);
    const tick = again.server.current.tick;
    await until(() => again.server.current.tick > tick + 10, 'the fight to resume');
  });

  it('hands the result to the world room once, which saves it and frees the seat', async () => {
    const who = await player('Test Courier', { inventory: [{ item: 'plain-treat', count: 2 }] });
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    send(fighter, { leave: true });
    const result = await who.box.take<ArenaResultMessage>('arena.result');
    expect(result).toMatchObject({ outcome: { result: 'ran' }, rewards: [], befriended: null, woke: null });
    await until(() => who.room.state.players.get(who.room.sessionId)?.inBattle === false, 'the seat to be free');
    expect(saved(who.id)?.team[0]?.hp).toBeGreaterThan(0);
    expect(saved(who.id)?.inventory).toEqual([{ item: 'plain-treat', count: 2 }]);
    // Leaving the world after the end changes nothing.
    await who.room.leave(true);
    await sleep(100);
    expect(settledLogs()).toHaveLength(1);
    expect(logged.lines.filter((line) => line['msg'] === 'fight ended')).toHaveLength(1);
    await until(() => fighter.room.connection.isOpen === false, 'the arena room to close');
  });

  it('ends the fight as ran when its player leaves the world, and settles it before a takeover loads the save', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    await until(() => fighter.room.state.tick > 10, 'the fight to run');
    await who.room.leave(true);
    await until(() => settledLogs().length === 1, 'the fight to be settled');
    expect(settledLogs()[0]).toMatchObject({ why: 'left', result: 'ran' });
    expect(fighter.server.current.outcome).toMatchObject({ result: 'ran' });

    const again = await player('Taker Courier');
    const join = await startFight(again);
    await enter(again, join);
    const login = await temp.services.profiles.login({ profileId: again.id });
    if (!login.ok) throw new Error(login.error);
    colyseus.sdk.auth.token = login.value.token;
    const newer = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
    newer.reconnection.enabled = false;
    inbox(newer);
    await until(() => settledLogs().length === 2, 'the takeover to settle the fight');
    expect(settledLogs()[1]).toMatchObject({ why: 'replaced', result: 'ran' });
    await until(() => newer.state?.players?.get(newer.sessionId)?.inBattle === false, 'the new seat to be free');
  });

  it('plays the fight the inputs it consumed play in core (server = core)', async () => {
    const who = await player('Test Courier');
    const join = await startFight(who);
    const fighter = await enter(who, join);
    await fighter.box.take('arena.started');
    const setup = fights.plan(join.fightId)!.setup;
    await stream(fighter, 45, (index) => ({ dir: index % 16, press: index % 7 === 0 ? 0 : ARENA_NONE, dash: index % 11 === 0 }));
    send(fighter, { leave: true });
    await who.box.take('arena.result');
    const { recorded, current } = fighter.server;
    expect(recorded.length).toBeGreaterThan(60);
    expect(recorded.some(([input]) => input.dir !== null && input !== ARENA_IDLE)).toBe(true);
    const replayed = recorded.reduce((fight, inputs) => fightStep(fight, inputs, content()).fight, fightStart(setup, content()));
    expect(fightHash(replayed)).toBe(fightHash(current));
    expect(current.outcome).toMatchObject({ result: 'ran' });
  });

  it('plays a computer against a computer with nobody in the room, and stops it with no result', async () => {
    const ended: FightEnd[] = [];
    const setup: RoundsFightSetup = {
      mode: 'rounds',
      seed: 7,
      picks: [[{ place: null, fighter: computer('a1', 'glowbun') }], [{ place: null, fighter: computer('b1', WILD.species) }]],
    };
    await fights.open({ fightId: 'bots', setup, seats: [], minds: [{ side: 0, mind: 'BOT' }, { side: 1, mind: 'BOT' }], ended: (end) => ended.push(end) });
    const [cache] = await matchMaker.query({ name: ARENA_ROOM });
    const server = colyseus.getRoomById<ArenaRoom>(cache!.roomId);
    await until(() => server.current.tick > 60, 'the computers to fight');
    expect(server.paused).toBe(false);
    fights.stop('bots', 'shutdown');
    expect(ended).toEqual([expect.objectContaining({ fightId: 'bots', why: 'shutdown' })]);
    expect(ended[0]!.fight?.outcome).toBeNull();
  });

  it('lets the player pick three for a best of 3, refusing a creature twice, a fainted one or one off the team', async () => {
    const team = [newCreature('glowbun', 20, world().battle), { ...newCreature('pinwhirl', 20, world().battle), hp: 0 }, newCreature('puddlepip', 18, world().battle), newCreature('drizzlesnail', 15, world().battle), newCreature('glowbun', 12, world().battle)];
    const who = await player('Test Courier', { team });
    const fighter = await enter(who, await startPractice(who));
    const started = await fighter.box.take<ArenaStartedMessage>('arena.started');
    // Only its own side, with the defaults: the first three standing.
    expect(started.mode).toBe('rounds');
    expect(started.sides[0].map((creature) => creature.place)).toEqual([0, 2, 3]);
    expect(started.sides[1]).toEqual([]);
    expect(fighter.room.state.phase).toBe('picking');
    expect(fighter.room.state.bodies).toHaveLength(0);
    const wrong = [[0, 0, 2], [0, 1, 2], [0, 2, 5], [0, 2]];
    for (const order of wrong) fighter.room.send('arena.pick', { order });
    await until(() => fighter.box.count('refused') === wrong.length, 'every wrong pick to be refused');
    expect(fighter.box.heard.filter((message) => message.type === 'refused').map((message) => message.payload as Refused)).toEqual(wrong.map(() => ({ request: 'arena.pick', reason: 'invalid' })));
    fighter.box.heard.length = 0;
    expect(fighter.room.state.phase).toBe('picking');
    fighter.room.send('arena.pick', { order: [4, 2, 0] });
    const rounds = await fighter.box.take<ArenaStartedMessage>('arena.started');
    expect(rounds.sides[0].map((creature) => creature.id)).toEqual(['a5', 'a3', 'a1']);
    expect(rounds.sides[1].map((creature) => creature.species)).toEqual(PRACTICE.map((opponent) => opponent.species));
    await until(() => fighter.room.state.phase === 'fighting' && fighter.room.state.bodies.length === 2, 'round 1 to start');
    expect(fighter.room.state.bodies.map((body) => body.id)).toEqual(['a5', 'b1']);
    expect(fighter.room.state.picked.toArray()).toEqual([true, false]);
    fighter.room.send('arena.pick', { order: [0, 2, 3] });
    expect(await fighter.box.take<Refused>('refused')).toEqual({ request: 'arena.pick', reason: 'notNow' });
  });

  it('refuses arena.pick in a wild fight', async () => {
    const who = await player('Test Courier');
    const fighter = await enter(who, await startFight(who));
    await fighter.box.take('arena.started');
    fighter.room.send('arena.pick', { order: [0] });
    expect(await fighter.box.take<Refused>('refused')).toEqual({ request: 'arena.pick', reason: 'notNow' });
  });

  it('picks the first three standing creatures when the time runs out, and counts only while the player is here', async () => {
    const team = [{ ...newCreature('glowbun', 20, world().battle), hp: 0 }, newCreature('pinwhirl', 20, world().battle), newCreature('puddlepip', 18, world().battle)];
    const who = await player('Test Courier', { team });
    const join = await startPractice(who);
    await sleep(200);
    clock.offset = ARENA_PICK_MS;
    const fighter = await enter(who, join);
    await fighter.box.take('arena.started');
    // The time away did not count.
    await sleep(200);
    expect(fighter.room.state.phase).toBe('picking');
    expect(fighter.room.state.countdown).toBeGreaterThan(ARENA_PICK_MS - 1_000);
    clock.offset += ARENA_PICK_MS;
    const started = await fighter.box.take<ArenaStartedMessage>('arena.started');
    expect(started.sides[0].map((creature) => creature.place)).toEqual([1, 2]);
    await until(() => fighter.room.state.phase === 'fighting', 'round 1 to start');
    expect(fighter.room.state.bodies[0]?.id).toBe('a2');
    expect(logged.lines.find((line) => line['msg'] === 'rounds picked')).toMatchObject({ chose: [false] });
  });

  it('pauses between rounds with the score, swaps in the next picks on a fresh island, and ends 2–0 after two rounds', async () => {
    const who = await player('Test Courier');
    const team = [strong(0, 'glowbun'), strong(1, 'pinwhirl'), strong(2, 'puddlepip')];
    const setup: RoundsFightSetup = { mode: 'rounds', seed: 11, picks: [team, [weak(0), weak(1), weak(2)]] };
    const ended: FightEnd[] = [];
    // The player's side is played by BOT, against a side that stands still, so each round ends soon.
    await fights.open({ fightId: 'two-nil', setup, seats: [{ playerId: who.id, side: 0 }], minds: [{ side: 0, mind: 'BOT' }], pickers: [{ side: 0, team }], ended: (end) => ended.push(end) });
    const fighter = await enter(who, { fightId: 'two-nil', reservation: (await fights.reserve('two-nil', who.id))! });
    await fighter.box.take('arena.started');
    fighter.room.send('arena.pick', { order: [2, 0, 1] });
    await fighter.box.take('arena.started');
    const { state } = fighter.room;
    await until(() => state.phase === 'fighting' && state.bodies[0]?.id === 'a3', 'round 1 to start');
    await until(() => state.phase === 'between', 'round 1 to end', Date.now() + 60_000);
    expect(state.rounds.toArray()).toEqual([0]);
    expect([...state.score]).toEqual([1, 0]);
    expect(state.round).toBe(1);
    // The next picks stand on a fresh island, and nothing moves while the score shows.
    expect(state.bodies.map((body) => body.id)).toEqual(['a1', 'b2']);
    expect(state.bodies.every((body) => body.health === body.max)).toBe(true);
    expect(fighter.server.current.island.tick).toBe(0);
    const tick = fighter.server.current.tick;
    await sleep(300);
    expect(fighter.server.current.tick).toBe(tick);
    expect(state.countdown).toBeGreaterThan(0);
    clock.offset += ARENA_BETWEEN_MS;
    await until(() => state.phase !== 'between', 'round 2 to start');
    await until(() => ended.length === 1, 'the best of 3 to end', Date.now() + 60_000);
    await until(() => state.phase === 'ended', 'the end to reach the player');
    expect(state.rounds.toArray()).toEqual([0, 0]);
    expect(ended[0]!.fight?.outcome).toMatchObject({ result: 'won', winner: 0 });
    expect(fighter.server.current.mode === 'rounds' && fighter.server.current.rounds).toHaveLength(2);
  });});
