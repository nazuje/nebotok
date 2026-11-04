import { Callbacks, Client } from '@colyseus/sdk';
import { PROTOCOL_VERSION, type Welcome } from '@nebotok/core';
import type { WorldState } from '../../server/src/world-state.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'unreachable';

export type ConnectionEvents = {
  status(status: ConnectionStatus): void;
  welcome(welcome: Welcome): void;
  players(count: number): void;
};

const FIRST_RETRY_MS = 2_000;
const LONGEST_RETRY_MS = 15_000;

/**
 * Same origin in production, so it works behind HTTPS on any host. In dev, Vite proxies /colyseus
 * to the local server. Short drops are retried by the SDK; a failed join is retried here.
 */
export function connect(events: ConnectionEvents): void {
  const client = new Client(import.meta.env.DEV ? '/colyseus' : '/');
  let retryMs = FIRST_RETRY_MS;

  const retryLater = () => {
    events.status('unreachable');
    setTimeout(join, retryMs);
    retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS);
  };

  async function join() {
    events.status('connecting');
    try {
      const room = await client.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
      retryMs = FIRST_RETRY_MS;
      room.onMessage('welcome', (message: Welcome) => events.welcome(message));
      Callbacks.get(room).listen('playerCount', (count) => events.players(count));
      room.onDrop(() => events.status('connecting'));
      room.onReconnect(() => events.status('connected'));
      room.onLeave(() => retryLater());
      events.status('connected');
    } catch {
      retryLater();
    }
  }

  void join();
}
