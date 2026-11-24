import type { Sound, SoundsFile } from '@nebotok/core';
import { masterGain, remember } from './sound-mix.ts';

/** A sound the page asked for while sounds were on, and when, in page ms. */
export type PlayedSound = { readonly id: string; readonly at: number };

/** What the test hook shows: the setting, whether the page may make sound yet, and the last sounds asked for. */
export type TestSounds = { readonly on: boolean; readonly unlocked: boolean; readonly played: readonly PlayedSound[] };

/** What makes the sound itself: Web Audio in the page (sound-synth.ts), a fake in tests. */
export type Synth = {
  /** Whether a tap has let the page make sound yet. */
  ready(): boolean;
  /** Plays a recipe now, through the master gain; before a tap has unlocked the page, not at all. */
  play(sound: Sound): void;
  /** Sets the gain of every effect, playing ones too. */
  master(gain: number): void;
};

export type SoundPlayer = {
  /** Plays the sound `id` names in sounds.json, if sounds are on. An id not there is refused. Returns whether it was played. */
  play(id: string): boolean;
  /** Buzzes the device with a vibration pattern in ms, if sounds are on and the device can. Returns whether it asked. */
  vibrate(pattern: readonly number[]): boolean;
  /** The player's sounds setting. */
  setOn(on: boolean): void;
  /** Whether a voice clip is playing, so effects play quieter. */
  setDucked(ducked: boolean): void;
  state(): TestSounds;
};

export type SoundPlayerOptions = {
  file: SoundsFile;
  synth: Synth;
  /** The page's clock, in ms. */
  now(): number;
  /** The device's vibration, or null where it has none (Safari on iPhone and iPad). */
  vibrate: ((pattern: number[]) => void) | null;
};

/** Sound effects and haptics, behind the player's sounds setting (on until it says otherwise). */
export function createSoundPlayer(options: SoundPlayerOptions): SoundPlayer {
  const { file, synth } = options;
  const recipes = new Map(file.sounds.map((sound) => [sound.id, sound]));
  let on = true;
  let ducked = false;
  let played: PlayedSound[] = [];
  const mix = () => synth.master(on ? masterGain(file, ducked) : 0);
  mix();

  return {
    play: (id) => {
      const sound = recipes.get(id);
      if (!sound || !on) return false;
      played = remember(played, { id, at: Math.round(options.now()) });
      synth.play(sound);
      return true;
    },
    vibrate: (pattern) => {
      if (!on || !options.vibrate) return false;
      options.vibrate([...pattern]);
      return true;
    },
    setOn: (next) => {
      on = next;
      mix();
    },
    setDucked: (next) => {
      ducked = next;
      mix();
    },
    state: () => ({ on, unlocked: synth.ready(), played }),
  };
}
