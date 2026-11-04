import { Callbacks, Client, ErrorCode } from '@colyseus/sdk';
import { CLOSE_CODES, PROTOCOL_VERSION, type Language, type Welcome } from '@nebotok/core';
import type { WorldState } from '../../server/src/world-state.ts';
import { SERVER_BASE, devSignIn, forgetToken, storedToken } from './session.ts';

export type ConnectionStatus = 'connecting' | 'connected' | 'unreachable' | 'signedOut' | 'replaced';

export type ConnectionEvents = {
  status(status: ConnectionStatus): void;
  welcome(welcome: Welcome): void;
  players(count: number): void;
};

const FIRST_RETRY_MS = 2_000;
const LONGEST_RETRY_MS = 15_000;

async function sessionToken(): Promise<string | null> {
  const token = storedToken();
  if (token !== null || !import.meta.env.DEV) return token;
  return devSignIn();
}

/**
 * Same origin in production, so it works behind HTTPS on any host. In dev, Vite proxies /colyseus
 * to the local server. Short drops are retried by the SDK; a failed join is retried here, except
 * when there is no valid session, or the server says this profile is now playing elsewhere.
 */
export function connect(language: () => Language, events: ConnectionEvents): void {
  const client = new Client(SERVER_BASE === '' ? '/' : SERVER_BASE);
  let retryMs = FIRST_RETRY_MS;

  const retryLater = () => {
    events.status('unreachable');
    setTimeout(join, retryMs);
    retryMs = Math.min(retryMs * 2, LONGEST_RETRY_MS);
  };

  const signedOut = () => {
    forgetToken();
    events.status('signedOut');
  };

  async function join() {
    events.status('connecting');
    let token: string | null;
    try {
      token = await sessionToken();
    } catch {
      retryLater();
      return;
    }
    if (token === null) {
      events.status('signedOut');
      return;
    }
    client.auth.token = token;
    try {
      const room = await client.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION, language: language() });
      retryMs = FIRST_RETRY_MS;
      room.onMessage('welcome', (message: Welcome) => events.welcome(message));
      Callbacks.get(room).listen('playerCount', (count) => events.players(count));
      room.onDrop(() => events.status('connecting'));
      room.onReconnect(() => events.status('connected'));
      room.onLeave((code) => {
        if (code === CLOSE_CODES.replaced) events.status('replaced');
        else if (code === CLOSE_CODES.signedOut) signedOut();
        else retryLater();
      });
      events.status('connected');
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === ErrorCode.AUTH_FAILED) signedOut();
      else retryLater();
    }
  }

  void join();
}
