/** One sound id starts at most this many times in any second; a child mashing a button hears a patter, not a roar. */
export const STARTS_PER_SECOND = 8;
const SECOND_MS = 1_000;

/**
 * The start times, in page ms, to keep for one sound id after asking for it again at `now`: the
 * starts of the last second with this one added, or null when there were already
 * STARTS_PER_SECOND of them, so this one is dropped rather than played later.
 */
export function startWithinRate(starts: readonly number[], now: number): number[] | null {
  const recent = starts.filter((at) => now - at < SECOND_MS);
  return recent.length < STARTS_PER_SECOND ? [...recent, now] : null;
}
