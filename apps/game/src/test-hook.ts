import type { Direction, Language, Point, StringId } from '@nebotok/core';
import type { ConnectionStatus } from './connection.ts';
import type { Controls } from './controls-choice.ts';
import type { Input } from './input.ts';
import type { WorldView } from './world-view.ts';
import type { ProfileScreenState, ProfileView } from './profile-screen.ts';

export type Screen = ProfileView | 'world';

/** A player as the server last told this page, and where the page draws them. */
export type TestPlayer = {
  name: string;
  avatar: string;
  self: boolean;
  connected: boolean;
  x: number;
  y: number;
  moving: boolean;
  facing: Direction;
  /** In tiles, between two tiles while a step is drawn. */
  drawn: Point;
  walking: boolean;
};

export type TestSnapshot = {
  /** Which screen is up: the profile list, the new-player form, the PIN pad, or the world. */
  screen: Screen;
  connection: ConnectionStatus | null;
  language: Language;
  protocol: number | null;
  playerCount: number | null;
  scene: string | null;
  /** The map whose tiles are drawn, if any. */
  map: string | null;
  players: TestPlayer[];
  controls: Controls;
  /** The tile the walk marker shows, if any. */
  marker: Point | null;
  /** Your own courier as this page predicts it, before the server confirms. */
  predicted: ReturnType<WorldView['predicted']>;
  input: ReturnType<Input['state']>;
  /** The profile this device is signed in as, if any. */
  profile: { id: number; name: string; avatar: string } | null;
  profiles: ProfileScreenState['profiles'];
  /** The message the profile screens show (a string id), if any. */
  notice: StringId | null;
  pinFor: ProfileScreenState['pinFor'];
  pinDigits: number;
  settingsOpen: boolean;
};

export type TestHook = {
  ready: boolean;
  stateAsText(): string;
  /** Where the centre of a map tile is on the page, in CSS pixels, or null before a map is drawn. */
  tileToScreen(x: number, y: number): Point | null;
};

declare global {
  interface Window {
    __nebotok?: TestHook;
  }
}

export type TestHookSources = {
  snapshot(): TestSnapshot;
  isReady(): boolean;
  tileToScreen(x: number, y: number): Point | null;
};

/** Only with ?test=1 in the URL: a read-only window for automated checks. */
export function installTestHook({ snapshot, isReady, tileToScreen }: TestHookSources): void {
  if (new URLSearchParams(location.search).get('test') !== '1') return;
  const hook: TestHook = {
    get ready() {
      return isReady();
    },
    stateAsText: () => JSON.stringify(snapshot()),
    tileToScreen: (x, y) => tileToScreen(x, y),
  };
  Object.defineProperty(window, '__nebotok', { value: Object.freeze(hook), configurable: false });
}
