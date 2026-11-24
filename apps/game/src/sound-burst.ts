/** No more than this many sounds start in any `BURST_WINDOW_MS`, across every id, so a burst of hits does not clip. */
export const BURST_MOST = 6;
export const BURST_WINDOW_MS = 100;
/** Of those, the starts only a `keep` sound may take, so a fight's result or a ring-out is heard through a flurry of hits. */
export const BURST_KEPT = 2;

/** `keep` for a sound that must be heard, such as a result; `normal` for one a burst may drop, such as a repeated hit. */
export type SoundPriority = 'normal' | 'keep';

/**
 * The burst cap: called as a sound is about to start, at page time `now` in ms, it says whether it
 * may, and counts it when it does. A `normal` sound is dropped once `BURST_MOST - BURST_KEPT` have
 * started in the window ending now, a `keep` sound only once `BURST_MOST` have.
 */
export function createBurstCap(): (now: number, priority: SoundPriority) => boolean {
  let starts: number[] = [];
  return (now, priority) => {
    starts = starts.filter((at) => now - at <= BURST_WINDOW_MS);
    if (starts.length >= (priority === 'keep' ? BURST_MOST : BURST_MOST - BURST_KEPT)) return false;
    starts.push(now);
    return true;
  };
}
