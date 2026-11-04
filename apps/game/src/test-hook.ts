import type { Language } from '@nebotok/core';
import type { ConnectionStatus } from './connection.ts';

export type TestSnapshot = {
  connection: ConnectionStatus;
  language: Language;
  protocol: number | null;
  playerCount: number | null;
  scene: string | null;
};

export type TestHook = { ready: boolean; stateAsText(): string };

declare global {
  interface Window {
    __nebotok?: TestHook;
  }
}

/** Only with ?test=1 in the URL: a read-only window for automated checks. */
export function installTestHook(snapshot: () => TestSnapshot, isReady: () => boolean): void {
  if (new URLSearchParams(location.search).get('test') !== '1') return;
  const hook: TestHook = {
    get ready() {
      return isReady();
    },
    stateAsText: () => JSON.stringify(snapshot()),
  };
  Object.defineProperty(window, '__nebotok', { value: Object.freeze(hook), configurable: false });
}
