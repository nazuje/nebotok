import { layerMs, type Sound, type SoundLayer, type SoundsFile } from '@nebotok/core';

/** How many played sounds the test hook keeps. */
export const PLAYED_KEPT = 30;

/**
 * The gain of every effect together: the file's master `volume`, down to its `duckPercent` of that
 * while a "Read to me" clip plays, so the voice stays the loudest thing on the page.
 */
export function masterGain(file: Pick<SoundsFile, 'volume' | 'duckPercent'>, ducked: boolean): number {
  return (file.volume / 100) * (ducked ? file.duckPercent / 100 : 1);
}

/** A layer's peak gain within its sound, before the master gain. */
export function layerGain(sound: Pick<Sound, 'volume'>, layer: Pick<SoundLayer, 'volume'>): number {
  return (sound.volume / 100) * (layer.volume / 100);
}

export type GainPoint = { readonly ms: number; readonly gain: number };

/** A layer's envelope, in ms after it starts: up from silence to `peak` over the attack, held, and back down over the release. */
export function envelopePoints(layer: SoundLayer, peak: number): GainPoint[] {
  const length = layerMs(layer);
  const { attackMs, releaseMs } = layer.envelope;
  return [
    { ms: 0, gain: 0 },
    { ms: attackMs, gain: peak },
    { ms: length - releaseMs, gain: peak },
    { ms: length, gain: 0 },
  ];
}

/** When each of a tone's pitch steps begins, in ms after the layer starts. */
export function pitchTimes(steps: readonly { readonly hz: number; readonly ms: number }[]): { ms: number; hz: number }[] {
  let at = 0;
  return steps.map(({ hz, ms }) => {
    const begins = at;
    at += ms;
    return { ms: begins, hz };
  });
}

/** The list of played sounds with one more, keeping the last `PLAYED_KEPT`. */
export function remember<T>(played: readonly T[], next: T): T[] {
  return [...played, next].slice(-PLAYED_KEPT);
}
