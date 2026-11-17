import type { ClipPlayer } from './speech.ts';

/** What the test hook shows of the clips: the last one asked for and how many have been. */
export type TestVoice = { readonly clip: string | null; readonly asked: number };

/** The only place a clip may come from: the game's own server. */
const VOICE_PATH = '/voice/';

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
  /** The clip playing now and what runs when it ends; another clip or a stop replaces it unrun. */
  let playing: { readonly url: string; readonly ended: (() => void) | undefined } | null = null;

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
    playing = null;
    if (current === null && !audio.hasAttribute('src')) return;
    current = null;
    audio.pause();
    audio.removeAttribute('src');
    // Without a source, load() drops the clip's download and leaves the element quiet and ready.
    audio.load();
  };
  /** The clip that `which` names played through or failed: its `ended` runs, once. */
  const finish = (which: typeof playing) => {
    if (which === null || which !== playing) return;
    playing = null;
    current = null;
    which.ended?.();
  };
  const ended = () => finish(playing);
  audio.addEventListener('ended', ended);
  audio.addEventListener('error', ended);
  // A clip never goes on playing in a tab the player has left.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
  });

  async function start(which: NonNullable<typeof playing>) {
    try {
      await audio.play();
      unlocked = true;
    } catch {
      // Not unlocked yet, or the clip is missing: the line is simply not read, and the next one is.
      finish(which);
    }
  }

  return {
    play: (url, whenEnded) => {
      if (!url.startsWith(VOICE_PATH)) return;
      const which = { url, ended: whenEnded };
      playing = which;
      current = url;
      last = url;
      asked += 1;
      audio.src = url;
      void start(which);
    },
    stop,
    state: () => ({ clip: last, asked }),
  };
}
