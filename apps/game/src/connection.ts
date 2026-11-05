import { Callbacks, Client, ErrorCode, type Room } from '@colyseus/sdk';
import { CLOSE_CODES, PROTOCOL_VERSION, type Language, type Welcome } from '@nebotok/core';
import type { WorldState } from '../../server/src/world-state.ts';
import { SERVER_BASE } from './session.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'unreachable' | 'signedOut' | 'replaced' | 'outdated';

export type WorldRoom = Room<unknown, WorldState>;

export type ConnectionEvents = {
  status(status: ConnectionStatus): void;
  welcome(welcome: Welcome): void;
  players(count: number): void;
  /** A room was joined. The same room carries on through short drops the SDK reconnects. */
  room(room: WorldRoom): void;
};

export type WorldConnection = {
  /** Leaves the world for good, as when switching player. */
  leave(): Promise<void>;
};

const FIRST_RETRY_MS = 2_000;
const LONGEST_RETRY_MS = 15_000;

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}

/**
 * Joins the world with a session token. Same origin in production, so it works behind HTTPS on any
 * host; in dev, Vite proxies /colyseus to the local server. Short drops are retried by the SDK; a
 * failed join is retried here, except when the session is no longer valid, the profile is now
 * playing elsewhere, or the page is older than the server.
 */
export function connect(token: string, language: () => Language, events: ConnectionEvents): WorldConnection {
  const client = new Client(SERVER_BASE === '' ? '/' : SERVER_BASE);
  client.auth.token = token;
  let retryMs = FIRST_RETRY_MS;
  let stopped = false;
  let room: WorldRoom | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const retryLater = () => {
    if (stopped) return;
    events.status('unreachable');
    retry = setTimeout(join, retryMs);
    retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS);
  };

  async function join() {
    if (stopped) return;
    events.status('connecting');
    let joined: WorldRoom;
    try {
      joined = await client.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION, language: language() });
    } catch (error) {
      if (stopped) return;
      const code = errorCode(error);
      if (code === ErrorCode.AUTH_FAILED) events.status('signedOut');
      else if (code === ErrorCode.MATCHMAKE_INVALID_CRITERIA) events.status('outdated');
      else retryLater();
      return;
    }
    if (stopped) {
      void joined.leave();
      return;
    }
    room = joined;
    retryMs = FIRST_RETRY_MS;
    // The SDK keeps what is sent during a drop and sends it all once back, which would set a courier
    // walking by itself long after the tap. Nothing is kept: a command needs a live connection.
    joined.reconnection.maxEnqueuedMessages = 0;
    joined.onMessage('welcome', (message: Welcome) => events.welcome(message));
    Callbacks.get(joined).listen('playerCount', (count) => events.players(count));
    joined.onDrop(() => events.status('connecting'));
    joined.onReconnect(() => events.status('connected'));
    joined.onLeave((code) => {
      room = null;
      if (stopped) return;
      if (code === CLOSE_CODES.replaced) events.status('replaced');
      else if (code === CLOSE_CODES.signedOut) events.status('signedOut');
      else retryLater();
    });
    events.room(joined);
    events.status('connected');
  }

  void join();

  return {
    leave: async () => {
      stopped = true;
      clearTimeout(retry);
      const leaving = room;
      room = null;
      if (leaving) await leaving.leave().catch(() => {});
    },
  };
}
