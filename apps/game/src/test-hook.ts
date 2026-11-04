import type { Language, StringId } from '@nebotok/core';
import type { ConnectionStatus } from './connection.ts';
import type { ProfileScreenState, ProfileView } from './profile-screen.ts';

export type Screen = ProfileView | 'world';

export type TestSnapshot = {
  /** Which screen is up: the profile list, the new-player form, the PIN pad, or the world. */
  screen: Screen;
  connection: ConnectionStatus | null;
  language: Language;
  protocol: number | null;
  playerCount: number | null;
  scene: string | null;
  /** The profile this device is signed in as, if any. */
  profile: { id: number; name: string; avatar: string } | null;
  profiles: ProfileScreenState['profiles'];
  /** The message the profile screens show (a string id), if any. */
  notice: StringId | null;
  pinFor: ProfileScreenState['pinFor'];
  pinDigits: number;
  settingsOpen: boolean;
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
