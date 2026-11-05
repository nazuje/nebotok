import { samePoint } from '@nebotok/core';
import type { Command } from './self-walker.ts';

/**
 * The server drops more than 5 `walk.to` a second and disconnects past 30 messages a second, so
 * movement goes out through here: never two commands closer than MIN_GAP_MS, never two walk
 * targets closer than WALK_TO_GAP_MS, the latest command waiting its turn, repeats dropped.
 */
export const MIN_GAP_MS = 100;
export const WALK_TO_GAP_MS = 250;

export type Outbox = {
  send(command: Command): void;
  /** Forgets what was sent and drops anything waiting, as when a new room is joined. */
  reset(): void;
};

export type OutboxDeps = {
  deliver(command: Command): void;
  now(): number;
  later(run: () => void, ms: number): () => void;
};

const same = (a: Command, b: Command) => {
  if (a.kind === 'to' && b.kind === 'to') return samePoint(a.target, b.target);
  if (a.kind === 'hold' && b.kind === 'hold') return a.direction === b.direction;
  return a.kind === b.kind;
};

export function createOutbox({ deliver, now, later }: OutboxDeps): Outbox {
  let last: Command | null = null;
  let lastAt = Number.NEGATIVE_INFINITY;
  let lastWalkToAt = Number.NEGATIVE_INFINITY;
  let waiting: Command | null = null;
  let cancel: (() => void) | null = null;

  const earliest = (command: Command) => Math.max(lastAt + MIN_GAP_MS, command.kind === 'to' ? lastWalkToAt + WALK_TO_GAP_MS : Number.NEGATIVE_INFINITY);

  function flush() {
    cancel = null;
    const command = waiting;
    if (!command) return;
    const at = now();
    const ready = earliest(command);
    if (at < ready) {
      cancel = later(flush, ready - at);
      return;
    }
    waiting = null;
    last = command;
    lastAt = at;
    if (command.kind === 'to') lastWalkToAt = at;
    deliver(command);
  }

  return {
    send: (command) => {
      // Asking again for what was last sent cancels whatever was waiting: that is already the plan.
      waiting = last !== null && same(last, command) ? null : command;
      if (waiting === null) {
        cancel?.();
        cancel = null;
        return;
      }
      if (cancel === null) flush();
    },
    reset: () => {
      cancel?.();
      cancel = null;
      waiting = null;
      last = null;
      lastAt = Number.NEGATIVE_INFINITY;
      lastWalkToAt = Number.NEGATIVE_INFINITY;
    },
  };
}
