import { ColyseusTestServer } from '@colyseus/testing';
import type { Room } from '@colyseus/sdk';
import {
  CLOSE_CODES,
  PLAYER_SPAWN,
  PROTOCOL_VERSION,
  createSave,
  emptyProgress,
  findPath,
  isWalkable,
  newCreature,
  type BattleResult,
  type BattleUpdate,
  type BefriendRules,
  type Point,
  type Progress,
  type ProgressMessage,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.ts';
import { REQUESTS_PER_SECOND } from '../src/world-room.ts';
import type { WorldState } from '../src/world-state.ts';
import type { WorldContent } from '../src/world.ts';
import { capturedLog, freePort, tempServices, until } from './helpers.ts';

// Each test breaks one thing the room relies on, on purpose, while the others stay as they were.
const broken = { clock: false, befriending: false };
/** In the room's content only: saves still load with it, as when a species leaves content while saves name it. */
const REMOVED = 'glowbun';
let temp: ReturnType<typeof tempServices>;
let colyseus: ColyseusTestServer;
let world: WorldContent;
const logged = capturedLog();

/** Befriending rules whose base chance throws while `broken.befriending` is set, so offering a treat fails mid-step. */
function breakableBefriending(rules: BefriendRules): BefriendRules {
  return {
    ...rules,
    windowPercent: 100,
    get basePercent() {
      if (broken.befriending) throw new RangeError('befriending rules unreadable');
      return rules.basePercent;
    },
  };
}

beforeAll(async () => {
  temp = tempServices(() => {
    if (broken.clock) throw new Error('clock stopped');
    return Date.now();
  });
  const real = temp.services.world;
  world = {
    ...real,
    encounters: new Map([...real.encounters].map(([id, zone]) => [id, { ...zone, encounterPercent: 100, creatures: [{ species: 'drizzlesnail', minLevel: 3, maxLevel: 3, weight: 1 }] }])),
    battle: { ...real.battle, species: new Map([...real.battle.species].filter(([id]) => id !== REMOVED)), befriending: breakableBefriending(real.battle.befriending) },
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
  broken.clock = false;
  broken.befriending = false;
  await colyseus.cleanup();
  temp.services.db.exec('DELETE FROM players');
  logged.lines.length = 0;
});

const map = () => world.map;
const spawn = (): Point => map().spawns[PLAYER_SPAWN]!;
const shrineTile = (): Point => map().shrines['post-shrine']!;
const grass = () => map().encounterAreas.find((area) => area.zone === 'post-meadow')!;
const besideGrass = (): Point => ({ x: grass().x + grass().width, y: grass().y + 1 });
const intoGrass = (): Point => ({ x: grass().x + grass().width - 1, y: grass().y + 1 });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Joined = { id: number; room: Room<unknown, WorldState> };

async function player(name: string, progress: Partial<Progress> = {}, at: Point | null = null): Promise<Joined> {
  const made = await temp.services.profiles.create({ name, avatar: 'green' });
  if (!made.ok) throw new Error(made.error);
  const { id } = made.value;
  const position = at && { map: map().id, ...at, facing: 'left' as const };
  temp.services.progress.save(id, createSave({ name, language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position, ...emptyProgress(), ...progress }));
  const login = await temp.services.profiles.login({ profileId: id });
  if (!login.ok) throw new Error(login.error);
  colyseus.sdk.auth.token = login.value.token;
  const room = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
  room.reconnection.enabled = false;
  await room.waitForMessage('welcome');
  return { id, room };
}

/** A walkable tile a few steps from the spawn, away from the grass and the shrine. */
function tileAway(): Point {
  const from = spawn();
  for (const [dx, dy] of [[3, 0], [-3, 0], [0, 3], [0, -3]] as const) {
    const target = { x: from.x + dx, y: from.y + dy };
    if (isWalkable(map(), target) && findPath(map(), from, target)) return target;
  }
  throw new Error('no tile near the spawn');
}

const standsAt = ({ room }: Joined, target: Point) => {
  const me = room.state.players.get(room.sessionId);
  return me !== undefined && me.x === target.x && me.y === target.y && !me.moving;
};
const leftWith = ({ room }: Joined) => new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));
const linesWith = (msg: string) => logged.lines.filter((line) => line['msg'] === msg);

describe('an error in the room', () => {
  it('ends only the seat whose part of a tick throws, and the room goes on for everyone else', async () => {
    const watcher = await player('Watching Courier');
    const victim = await player('Shrine Courier', { team: [newCreature(REMOVED, 10, temp.services.world.battle)] }, { x: shrineTile().x - 3, y: shrineTile().y });
    const closed = leftWith(victim);
    victim.room.send('walk.to', shrineTile());
    expect(await closed).toBe(CLOSE_CODES.failed);

    const target = tileAway();
    watcher.room.send('walk.to', target);
    await until(() => standsAt(watcher, target), 'the watcher to walk on');
    await until(() => !watcher.room.state.players.has(victim.room.sessionId), 'the failed seat to go');
    expect(watcher.room.connection.isOpen).toBe(true);
    expect(linesWith('seat error')).toEqual([expect.objectContaining({ level: 'error', task: 'tick', playerId: victim.id, error: 'RangeError', message: `unknown species "${REMOVED}"` })]);
    expect(JSON.stringify(logged.lines)).not.toMatch(/Courier/);
    // The seat was saved as it left, so the player comes back to the world.
    expect(temp.services.progress.load(victim.id)?.data.team).toHaveLength(1);
  });

  it('logs an error that escapes a tick and keeps ticking, with every player still connected', async () => {
    const first = await player('First Courier');
    const second = await player('Second Courier');
    broken.clock = true;
    await sleep(200);
    broken.clock = false;
    expect(linesWith('room error').length).toBeGreaterThan(0);
    expect(linesWith('room error')[0]).toMatchObject({ level: 'error', method: 'setFixedTimestep', error: 'Error', message: 'clock stopped' });

    const target = tileAway();
    second.room.send('walk.to', target);
    await until(() => standsAt(second, target) && standsAt(first, spawn()), 'the walk after the errors');
    expect(first.room.connection.isOpen && second.room.connection.isOpen).toBe(true);
    expect(first.room.state.playerCount).toBe(2);
  });

  it('ends a battle whose step throws as a run, keeping the treat it was offering', async () => {
    const inventory = [{ item: 'plain-treat', count: 1 }];
    const who = await player('Treat Courier', { team: [newCreature('puddlepip', 60, world.battle)], inventory }, besideGrass());
    const messages: { type: string; payload: unknown }[] = [];
    who.room.onMessage('*', (type: string | number, payload: unknown) => messages.push({ type: String(type), payload }));
    const heard = (type: string) => messages.find((message) => message.type === type)?.payload;
    who.room.send('walk.to', intoGrass());
    await until(() => heard('battle.started') !== undefined, 'the battle');

    broken.befriending = true;
    await sleep(Math.ceil(1_000 / REQUESTS_PER_SECOND) + 20);
    who.room.send('battle.treat', { itemId: 'plain-treat' });
    await until(() => heard('battle.result') !== undefined, 'the battle to end');
    expect(heard('battle.result')).toMatchObject({ outcome: { winner: null, reason: 'ran' }, rewards: [] } satisfies Partial<BattleResult>);
    expect((heard('battle.turn') as BattleUpdate).events.map((event) => event.kind)).toEqual(['ran', 'ended']);
    const progress = messages.findLast((message) => message.type === 'progress')?.payload as ProgressMessage;
    expect(progress.inventory).toEqual(inventory);
    expect(temp.services.progress.load(who.id)?.data.inventory).toEqual(inventory);
    expect(linesWith('room error')).toEqual([expect.objectContaining({ method: 'onMessage', sessionId: who.room.sessionId, error: 'RangeError' })]);
    await until(() => who.room.state.players.get(who.room.sessionId)?.inBattle === false, 'the battle mark to go');
    expect(who.room.connection.isOpen).toBe(true);
  });
});
