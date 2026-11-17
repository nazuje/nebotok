import { CLIENT_MESSAGES, SERVER_MESSAGES, type SettingsMessage, type SettingsSetMessage } from '@nebotok/core';
import type { WorldRoom } from './connection.ts';
import type { RequestPacer } from './request-pacer.ts';

export type PlayerSettingsOptions = {
  /** Paces the change with the page's other requests, under the server's limit. */
  requests: RequestPacer;
  /** The settings changed, so the settings panel shows them. */
  changed(): void;
};

export type PlayerSettings = {
  /** Listens to a joined room. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** "Read to me", as the server last sent it or as the player just set it; null before the server has said. */
  readToMe(): boolean | null;
  /** Turns "Read to me" over and asks the server to save it with the player. */
  toggleReadToMe(): void;
  /** Forgets the player's settings, as when they leave the world. */
  reset(): void;
};

/**
 * The player's own settings, saved with them on the server so they follow the player to any device
 * (docs/protocol.md "Settings"). A change shows at once and the server's answer confirms it.
 */
export function createPlayerSettings(options: PlayerSettingsOptions): PlayerSettings {
  let room: WorldRoom | null = null;
  let readToMe: boolean | null = null;

  const set = (next: boolean | null) => {
    readToMe = next;
    options.changed();
  };

  return {
    joined: (joined) => {
      room = joined;
      const stop = joined.onMessage(SERVER_MESSAGES.settings, (message: SettingsMessage) => set(message.readToMe));
      return () => {
        stop();
        if (room === joined) room = null;
      };
    },
    readToMe: () => readToMe,
    toggleReadToMe: () => {
      if (readToMe === null || !room) return;
      const wanted: SettingsSetMessage = { readToMe: !readToMe };
      set(wanted.readToMe);
      const to = room;
      options.requests.send(() => to.send(CLIENT_MESSAGES.settingsSet, wanted));
    },
    reset: () => set(null),
  };
}
