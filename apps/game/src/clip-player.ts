import type { ClipPlayer } from './speech.ts';

/** What the test hook shows of the clips: the last one asked for and how many have been. */
export type TestVoice = { readonly clip: string | null; readonly asked: number };

/** Taps and keys that count as the player asking, which is when a browser lets a page make sound. */
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

/**
 * The page's one audio element, which plays every clip. Safari on an iPhone or iPad plays sound
 * from an element only once a tap has started it, so the first taps call `load()` on it, which
 * unlocks it without a sound; after that a clip can start when a line arrives from the server.
 * Clips come only from the game's own server (`/voice/`), and a missing or failed one is silent.
 */
export function createClipPlayer(): ClipPlayer & { state(): TestVoice } {
  const audio = new Audio();
  audio.preload = 'auto';
  let current: string | null = null;
  let last: string | null = null;
  let asked = 0;
  let unlocked = false;

  const unlock = () => {
    if (unlocked) {
      for (const type of GESTURES) document.removeEventListener(type, unlock, true);
      return;
    }
    // Loading the empty element in a tap is what unlocks it; with a clip playing, the tap already did.
    if (current === null) audio.load();
  };
  for (const type of GESTURES) document.addEventListener(type, unlock, { capture: true, passive: true });

  const stop = () => {
    if (current === null && !audio.hasAttribute('src')) return;
    current = null;
    audio.pause();
    audio.removeAttribute('src');
    // Without a source, load() drops the clip's download and leaves the element quiet and ready.
    audio.load();
  };
  const ended = () => {
    current = null;
  };
  audio.addEventListener('ended', ended);
  audio.addEventListener('error', ended);
  // A clip never goes on playing in a tab the player has left.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });

  async function start(url: string) {
    try {
      await audio.play();
      unlocked = true;
    } catch {
      // Not unlocked yet, or the clip is missing: the line is simply not read.
      if (current === url) current = null;
    }
  }

  return {
    play: (url) => {
      current = url;
      last = url;
      asked += 1;
      audio.src = url;
      void start(url);
    },
    stop,
    state: () => ({ clip: last, asked }),
  };
}
