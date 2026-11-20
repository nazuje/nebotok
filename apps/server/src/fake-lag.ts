import type { Client } from '@colyseus/core';

/** What the arena room touches of a player's socket: the `ws` WebSocket under `client.ref`. */
type Socket = {
  send(data: unknown, ...rest: unknown[]): unknown;
  emit(event: string | symbol, ...args: unknown[]): boolean;
};

const isSocket = (value: unknown): value is Socket => typeof value === 'object' && value !== null && typeof Reflect.get(value, 'send') === 'function' && typeof Reflect.get(value, 'emit') === 'function';

/**
 * Dev and test only (`ARENA_FAKE_LAG_MS`, docs/protocol.md "Prediction"): holds back everything
 * one player's arena socket sends and receives by half of `lagMs` each way, so its round trip grows
 * by `lagMs`. Every message waits the same, so none overtakes another. A sent buffer is copied
 * first: Colyseus encodes patches into a buffer it reuses.
 */
export function addFakeLag(client: Client, lagMs: number): void {
  const socket: unknown = client.ref;
  if (lagMs <= 0 || !isSocket(socket)) return;
  const half = lagMs / 2;
  const send = socket.send.bind(socket);
  const emit = socket.emit.bind(socket);
  socket.send = (data: unknown, ...rest: unknown[]) => {
    const kept = data instanceof Uint8Array ? new Uint8Array(data) : data;
    setTimeout(() => send(kept, ...rest), half);
  };
  socket.emit = (event: string | symbol, ...args: unknown[]) => {
    if (event !== 'message') return emit(event, ...args);
    setTimeout(() => emit(event, ...args), half);
    return true;
  };
}
