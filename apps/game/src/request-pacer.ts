/**
 * The server answers at most 5 talk, battle, team, storage, starter, move, skill and board requests
 * a second from one page and drops the rest without a word (`REQUESTS_PER_SECOND` in
 * apps/server/src/world-room.ts), so every one of them goes out through here, in the order asked:
 * at most REQUESTS_PER_WINDOW in any WINDOW_MS. The window is longer than the server's second so
 * requests the network bunches up on the way still arrive within its limit.
 */
export const REQUESTS_PER_WINDOW = 5;
export const WINDOW_MS = 1_250;
/** Requests waiting their turn past this many are dropped here, as the server would drop them. */
export const MAX_WAITING = 10;
/**
 * A request with neither an answer nor a refusal this long after it went out is taken as lost, so a
 * screen waiting for it lets the next tap ask again instead of ignoring taps for ever.
 */
export const ANSWER_MS = 1_500;

export type RequestPacer = {
  /** Calls `deliver` to send one request: now, or once the window has room. */
  send(deliver: () => void): void;
  /** Drops everything waiting and forgets what was sent, as when a new room is joined. */
  reset(): void;
};

export type RequestPacerDeps = {
  now(): number;
  later(run: () => void, ms: number): () => void;
};

export function createRequestPacer({ now, later }: RequestPacerDeps): RequestPacer {
  let sentAt: number[] = [];
  let waiting: (() => void)[] = [];
  let cancel: (() => void) | null = null;

  function flush() {
    cancel = null;
    while (waiting.length > 0) {
      const at = now();
      sentAt = sentAt.filter((time) => at - time < WINDOW_MS);
      const oldest = sentAt[0];
      if (oldest !== undefined && sentAt.length >= REQUESTS_PER_WINDOW) {
        cancel = later(flush, oldest + WINDOW_MS - at);
        return;
      }
      sentAt.push(at);
      waiting.shift()?.();
    }
  }

  return {
    send: (deliver) => {
      if (waiting.length >= MAX_WAITING) return;
      waiting.push(deliver);
      if (cancel === null) flush();
    },
    reset: () => {
      cancel?.();
      cancel = null;
      waiting = [];
      sentAt = [];
    },
  };
}
