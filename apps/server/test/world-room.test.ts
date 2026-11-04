import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { ErrorCode, type Room } from '@colyseus/sdk';
import { CLOSE_CODES, PLAYER_SPAWN, PROTOCOL_VERSION, createSave, findPath, isWalkable, type Point, type Welcome } from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.ts';
import { createLog } from '../src/log.ts';
import type { WorldState } from '../src/world-state.ts';
import { tempServices, until } from './helpers.ts';

let temp: ReturnType<typeof tempServices>;
let colyseus: ColyseusTestServer;

beforeAll(async () => {
  temp = tempServices();
  colyseus = await boot(createGameServer(temp.config, createLog('silent'), temp.services));
});
afterAll(async () => {
  await colyseus.shutdown();
  temp.dispose();
});
beforeEach(async () => {
  await colyseus.cleanup();
  temp.services.db.exec('DELETE FROM players');
});

const map = () => temp.services.world.map;
const spawn = (): Point => map().spawns[PLAYER_SPAWN]!;

/** The nearest walkable tile at least `distance` steps from the spawn along a path. */
function tileAway(distance: number): Point {
  const from = spawn();
  for (let radius = distance; radius < 20; radius += 1) {
    for (const [dx, dy] of [[radius, 0], [-radius, 0], [0, radius], [0, -radius]] as const) {
      const target = { x: from.x + dx, y: from.y + dy };
      const path = isWalkable(map(), target) ? findPath(map(), from, target) : null;
      if (path && path.length >= distance) return target;
    }
  }
  throw new Error('no tile far enough from the spawn');
}

function blockedTile(): Point {
  for (let y = 0; y < map().height; y += 1) for (let x = 0; x < map().width; x += 1) if (!isWalkable(map(), { x, y })) return { x, y };
  throw new Error('the map has no blocked tile');
}

async function profile(name: string): Promise<{ id: number; token: string }> {
  const made = await temp.services.profiles.create({ name, avatar: 'green' });
  if (!made.ok) throw new Error(made.error);
  return { id: made.value.id, token: await signIn(made.value.id) };
}

async function signIn(profileId: number): Promise<string> {
  const login = await temp.services.profiles.login({ profileId });
  if (!login.ok) throw new Error(login.error);
  return login.value.token;
}

async function join(token: string | undefined, options: object = { protocol: PROTOCOL_VERSION }): Promise<Room<unknown, WorldState>> {
  colyseus.sdk.auth.token = token ?? '';
  const room = await colyseus.sdk.joinOrCreate<WorldState>('world', options);
  room.reconnection.enabled = false;
  await room.waitForMessage('welcome');
  return room;
}

const leftWith = (room: Room<unknown, WorldState>) => new Promise<number>((resolve) => room.onLeave((code) => resolve(code)));
const at = (room: Room<unknown, WorldState>, sessionId: string, target: Point) => {
  const player = room.state.players.get(sessionId);
  return player !== undefined && player.x === target.x && player.y === target.y && !player.moving;
};

describe('joining the world', () => {
  it('turns away a join without a session, with a bad one, or with another protocol', async () => {
    const { token } = await profile('Test Courier');
    await expect(join(undefined)).rejects.toMatchObject({ code: ErrorCode.AUTH_FAILED, message: 'not signed in' });
    await expect(join('not-a-real-token')).rejects.toMatchObject({ code: ErrorCode.AUTH_FAILED });
    await expect(join(token, { protocol: PROTOCOL_VERSION + 1 })).rejects.toMatchObject({ code: ErrorCode.MATCHMAKE_INVALID_CRITERIA, message: expect.stringMatching(/protocol/) });
    await expect(join(token, {})).rejects.toMatchObject({ code: ErrorCode.MATCHMAKE_INVALID_CRITERIA });
  });

  it('welcomes two players, shows each the other by name and avatar, and counts them', async () => {
    const red = await profile('Red Courier');
    const blue = await profile('Blue Courier');
    const first = await join(red.token);
    const second = await join(blue.token);
    expect(second.roomId).toBe(first.roomId);
    await until(() => first.state.playerCount === 2 && second.state.playerCount === 2, 'both to see two players');
    const shown = first.state.players.get(second.sessionId);
    expect({ name: shown?.name, avatar: shown?.avatar, x: shown?.x, y: shown?.y, connected: shown?.connected }).toEqual({
      name: 'Blue Courier',
      avatar: 'green',
      ...spawn(),
      connected: true,
    });
    expect(first.state.map).toBe(map().id);
    expect(first.state.stepMs).toBe(temp.services.world.stepMs);

    await second.leave();
    await until(() => first.state.playerCount === 1, 'the count to drop to one');
    await first.leave();
  });

  it('greets a lone player as alone', async () => {
    const { token } = await profile('Test Courier');
    colyseus.sdk.auth.token = token;
    const room = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
    expect(await room.waitForMessage('welcome')).toEqual({ protocol: PROTOCOL_VERSION, world: 'sky', playerCount: 1, messageKey: 'welcome.alone' } satisfies Welcome);
    await room.leave();
  });
});

describe('walking', () => {
  it('walks a player to a tile, and the other player sees it get there', async () => {
    const walker = await join((await profile('Walking Courier')).token);
    const watcher = await join((await profile('Watching Courier')).token);
    const target = tileAway(3);
    walker.send('walk.to', target);
    await until(() => at(watcher, walker.sessionId, target) && at(walker, walker.sessionId, target), 'both to see the walker arrive');
    expect(watcher.state.players.get(walker.sessionId)?.facing).toBe(walker.state.players.get(walker.sessionId)?.facing);
  });

  it('walks while a direction is held and stops when asked', async () => {
    const room = await join((await profile('Test Courier')).token);
    const start = spawn();
    room.send('walk.hold', { direction: 'left' });
    await until(() => (room.state.players.get(room.sessionId)?.x ?? start.x) < start.x, 'a step to the left');
    room.send('walk.stop', {});
    await until(() => room.state.players.get(room.sessionId)?.moving === false, 'the walker to stop');
    const stopped = room.state.players.get(room.sessionId)!;
    expect(stopped.facing).toBe('left');
    expect(isWalkable(map(), stopped)).toBe(true);
  });

  it('refuses a blocked tile and ignores one off the map', async () => {
    const room = await join((await profile('Test Courier')).token);
    room.send('walk.to', { x: 1000, y: 1000 });
    const blocked = blockedTile();
    room.send('walk.to', blocked);
    expect(await room.waitForMessage('walk.refused')).toEqual(blocked);
    expect(at(room, room.sessionId, spawn())).toBe(true);
  });

  it('disconnects a client that sends a malformed walk', async () => {
    const room = await join((await profile('Test Courier')).token);
    const left = leftWith(room);
    room.send('walk.to', { x: -1, y: 2 });
    expect(await left).toBe(4002);
  });
});

describe('one character per profile', () => {
  it('lets a newer join take over, closing the older one with its own code', async () => {
    const { id, token } = await profile('Test Courier');
    const older = await join(token);
    const target = tileAway(2);
    older.send('walk.to', target);
    await until(() => at(older, older.sessionId, target), 'the walk to finish');
    const olderLeft = leftWith(older);

    const newer = await join(await signIn(id));
    expect(await olderLeft).toBe(CLOSE_CODES.replaced);
    await until(() => newer.state.players.size === 1, 'only the newer character to remain');
    expect(at(newer, newer.sessionId, target)).toBe(true);
    expect(newer.state.playerCount).toBe(1);
  });

  it('takes over a character that is waiting to reconnect, which then cannot come back', async () => {
    const { id, token } = await profile('Test Courier');
    const older = await join(token);
    const { reconnectionToken } = older;
    await older.leave(false);
    const newer = await join(await signIn(id));
    await until(() => newer.state.players.size === 1, 'only the newer character to remain');
    await expect(colyseus.sdk.reconnect(reconnectionToken)).rejects.toMatchObject({ code: ErrorCode.MATCHMAKE_EXPIRED });
  });

  it('closes the seat when the profile signs out', async () => {
    const { token } = await profile('Test Courier');
    const room = await join(token);
    const left = leftWith(room);
    temp.services.profiles.logout(token);
    expect(await left).toBe(CLOSE_CODES.signedOut);
  });
});

describe('reconnecting', () => {
  it('keeps a dropped character standing where it was, and resumes it on reconnecting', async () => {
    const dropper = await join((await profile('Dropping Courier')).token);
    const watcher = await join((await profile('Watching Courier')).token);
    const target = tileAway(2);
    dropper.send('walk.to', target);
    await until(() => at(dropper, dropper.sessionId, target), 'the walk to finish');

    const { reconnectionToken, sessionId } = dropper;
    await dropper.leave(false);
    await until(() => watcher.state.players.get(sessionId)?.connected === false, 'the watcher to see the drop');
    expect(at(watcher, sessionId, target)).toBe(true);

    const back = await colyseus.sdk.reconnect<WorldState>(reconnectionToken);
    expect(back.sessionId).toBe(sessionId);
    await until(() => watcher.state.players.get(sessionId)?.connected === true, 'the watcher to see the return');
    expect(at(back, sessionId, target)).toBe(true);
    expect(watcher.state.playerCount).toBe(2);
  });
});

describe('saving positions', () => {
  it('saves where a player stood when they leave, and starts them there next time', async () => {
    const { id, token } = await profile('Saving Courier');
    const room = await join(token);
    const target = tileAway(2);
    room.send('walk.to', target);
    await until(() => at(room, room.sessionId, target), 'the walk to finish');
    await room.leave();
    await until(() => temp.services.progress.load(id)?.data.position?.x === target.x, 'the save');
    expect(temp.services.progress.load(id)?.data).toMatchObject({ name: 'Saving Courier', position: { map: map().id, ...target } });

    const again = await join(token);
    expect(at(again, again.sessionId, target)).toBe(true);
  });

  it('starts at the spawn when the saved tile is no longer walkable', async () => {
    const { id, token } = await profile('Lost Courier');
    const blocked = blockedTile();
    temp.services.progress.save(id, createSave({ name: 'Lost Courier', language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position: { map: map().id, ...blocked, facing: 'up' } }));
    const room = await join(token);
    expect(at(room, room.sessionId, spawn())).toBe(true);
  });
});

describe('messages', () => {
  it('answers a valid ping', async () => {
    const room = await join((await profile('Test Courier')).token);
    room.send('ping', { sentAt: 42 });
    expect(await room.waitForMessage('pong')).toEqual({ sentAt: 42 });
  });

  it('disconnects a client that sends a malformed ping', async () => {
    const room = await join((await profile('Test Courier')).token);
    const left = leftWith(room);
    room.send('ping', { sentAt: 'soon' });
    expect(await left).toBe(4002);
  });
});

describe('health check', () => {
  it('reports ok with the protocol and version', async () => {
    const response = await colyseus.http.get('/healthz');
    expect(response.data).toEqual({ ok: true, protocol: PROTOCOL_VERSION, version: '0.0.0' });
  });
});
