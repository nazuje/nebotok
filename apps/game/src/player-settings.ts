import { CLIENT_MESSAGES, SERVER_MESSAGES, type Refused, type SettingsMessage, type SettingsSetMessage, type SettingsSoundsMessage, type SettingsTurtleMessage } from '@nebotok/core';
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
  /** The turtle setting, for easier arena fights, as the server last sent it or as the player just set it; null before the server has said. */
  turtle(): boolean | null;
  /** Turns the turtle setting over and asks the server to save it. A refusal, as during a fight, turns it back. */
  toggleTurtle(): void;
  /** The sounds setting, effects and haptics, as the server last sent it or as the player just set it; null before the server has said. */
  sounds(): boolean | null;
  /** Turns the sounds setting over and asks the server to save it. */
  toggleSounds(): void;
  /** Forgets the player's settings, as when they leave the world. */
  reset(): void;
};

/**
 * The player's own settings, saved with them on the server so they follow the player to any device
 * (docs/protocol.md "Settings"). A change shows at once and the server's answer confirms it.
 */
export function createPlayerSettings(options: PlayerSettingsOptions): PlayerSettings {
  let room: WorldRoom | null = null;
  let settings: SettingsMessage | null = null;
  /** The turtle setting before a change the server has not answered yet. */
  let turtleBefore: boolean | null = null;

  const set = (next: SettingsMessage | null) => {
    settings = next;
    options.changed();
  };

  return {
    joined: (joined) => {
      room = joined;
      const stops = [
        joined.onMessage(SERVER_MESSAGES.settings, (message: SettingsMessage) => {
          turtleBefore = null;
          set(message);
        }),
        joined.onMessage(SERVER_MESSAGES.refused, (message: Refused) => {
          if (message.request !== CLIENT_MESSAGES.settingsTurtle || turtleBefore === null || !settings) return;
          set({ ...settings, turtle: turtleBefore });
          turtleBefore = null;
        }),
      ];
      return () => {
        for (const stop of stops) stop();
        if (room === joined) room = null;
      };
    },
    readToMe: () => settings?.readToMe ?? null,
    toggleReadToMe: () => {
      if (!settings || !room) return;
      const wanted: SettingsSetMessage = { readToMe: !settings.readToMe };
      set({ ...settings, ...wanted });
      const to = room;
      options.requests.send(() => to.send(CLIENT_MESSAGES.settingsSet, wanted));
    },
    turtle: () => settings?.turtle ?? null,
    toggleTurtle: () => {
      if (!settings || !room) return;
      const wanted: SettingsTurtleMessage = { on: !settings.turtle };
      turtleBefore ??= settings.turtle;
      set({ ...settings, turtle: wanted.on });
      const to = room;
      options.requests.send(() => to.send(CLIENT_MESSAGES.settingsTurtle, wanted));
    },
    sounds: () => settings?.sounds ?? null,
    toggleSounds: () => {
      if (!settings || !room) return;
      const wanted: SettingsSoundsMessage = { on: !settings.sounds };
      set({ ...settings, sounds: wanted.on });
      const to = room;
      options.requests.send(() => to.send(CLIENT_MESSAGES.settingsSounds, wanted));
    },
    reset: () => {
      turtleBefore = null;
      set(null);
    },
  };
}
