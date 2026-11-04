import { boot, type ColyseusTestServer } from '@colyseus/testing';
import { PROTOCOL_VERSION, type Welcome } from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.ts';
import { readConfig } from '../src/config.ts';
import { createLog } from '../src/log.ts';
import type { WorldState } from '../src/world-state.ts';

let colyseus: ColyseusTestServer;

beforeAll(async () => {
  colyseus = await boot(createGameServer(readConfig({ NODE_ENV: 'test' }), createLog('silent')));
});
afterAll(async () => {
  await colyseus.shutdown();
});
beforeEach(async () => {
  await colyseus.cleanup();
});

const join = () => colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });

/** Waits for synced state to settle, since a patch may already have arrived before we ask. */
async function until(check: () => boolean, what: string, deadline = Date.now() + 3_000): Promise<void> {
  if (check()) return;
  if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return until(check, what, deadline);
}

describe('world room', () => {
  it('welcomes two players, counts them, and counts down when one leaves', async () => {
    const first = await join();
    const firstWelcome = (await first.waitForMessage('welcome')) as Welcome;
    expect(firstWelcome).toEqual({ protocol: PROTOCOL_VERSION, world: 'sky', playerCount: 1, messageKey: 'welcome.alone' });

    const second = await join();
    const secondWelcome = (await second.waitForMessage('welcome')) as Welcome;
    expect(secondWelcome).toMatchObject({ playerCount: 2, messageKey: 'welcome.together' });
    expect(second.roomId).toBe(first.roomId);

    await Promise.all([first, second].map((client) => until(() => client.state.playerCount === 2, 'both clients to see two players')));
    for (const client of [first, second]) {
      expect([...client.state.players.keys()].toSorted()).toEqual([first.sessionId, second.sessionId].toSorted());
      expect(client.state.players.get(client.sessionId)?.id).toBe(client.sessionId);
    }

    await second.leave();
    await until(() => first.state.playerCount === 1, 'the count to drop to one');
    expect([...first.state.players.keys()]).toEqual([first.sessionId]);
    await first.leave();
  });

  it('turns away a client with another protocol or none', async () => {
    await expect(colyseus.sdk.joinOrCreate('world', { protocol: PROTOCOL_VERSION + 1 })).rejects.toThrow(/protocol/);
    await expect(colyseus.sdk.joinOrCreate('world', {})).rejects.toThrow(/protocol/);
  });

  it('answers a valid ping', async () => {
    const client = await join();
    await client.waitForMessage('welcome');
    client.send('ping', { sentAt: 42 });
    expect(await client.waitForMessage('pong')).toEqual({ sentAt: 42 });
    await client.leave();
  });

  it('disconnects a client that sends a malformed ping', async () => {
    const client = await join();
    await client.waitForMessage('welcome');
    client.reconnection.enabled = false;
    const left = new Promise<number>((resolve) => client.onLeave((code) => resolve(code)));
    client.send('ping', { sentAt: 'soon' });
    expect(await left).toBe(4002);
  });
});

describe('health check', () => {
  it('reports ok with the protocol and version', async () => {
    const response = await colyseus.http.get('/healthz');
    expect(response.data).toEqual({ ok: true, protocol: PROTOCOL_VERSION, version: '0.0.0' });
  });
});
