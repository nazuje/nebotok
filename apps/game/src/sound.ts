import { SoundsFile } from '@nebotok/core';
import sounds from '../../../content/sounds.json';
import { createSoundPlayer, type SoundPlayer } from './sound-player.ts';
import { createWebAudioSynth } from './sound-synth.ts';

export type { SoundPlayer, TestSounds } from './sound-player.ts';

/** Taps and keys that count as the player asking, which is when a browser lets a page make sound. */
const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * The page's sound effects and haptics: `sound.play(id)` plays a recipe from `content/sounds.json`,
 * made in the page with Web Audio, and `sound.vibrate(pattern)` buzzes the device; both only while
 * the player's sounds setting is on. Nothing is fetched to play a sound. Automated browsers make
 * every sound but never send it to the speakers, since WebKit cannot be muted.
 */
export function createSound(): SoundPlayer {
  const automated = navigator.webdriver || new URLSearchParams(location.search).get('test') === '1';
  const synth = createWebAudioSynth(automated);
  const unlock = () => {
    if (!synth.unlock()) return;
    for (const type of GESTURES) document.removeEventListener(type, unlock, true);
  };
  for (const type of GESTURES) document.addEventListener(type, unlock, { capture: true, passive: true });
  const vibrate = typeof navigator.vibrate === 'function' ? (pattern: number[]) => void navigator.vibrate(pattern) : null;
  return createSoundPlayer({ file: SoundsFile.parse(sounds), synth, now: () => performance.now(), vibrate });
}

/**
 * A tap on a button plays `ui.tap`, after the button's own work, so turning sounds on taps and
 * turning them off does not. A fight's move, dash, treat and swap buttons are left to the fight's own sounds.
 */
export function tapSounds(sound: SoundPlayer): void {
  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button && !button.classList.contains('arena-button')) sound.play('ui.tap');
  });
}
