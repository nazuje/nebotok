/**
 * Counts events per key (an IP address, a profile) in a sliding window, in memory. Keys that have
 * gone quiet are forgotten, so the table cannot grow without bound.
 */
export type RateLimiter = {
  /** Records one event for `key` and says whether it is within the limit. */
  take(key: string, now: number): boolean;
  /** Whole seconds until `key` may act again; 0 when it may now. */
  retryAfterSeconds(key: string, now: number): number;
};

export function createRateLimiter({ limit, windowMs, maxKeys = 10_000 }: { limit: number; windowMs: number; maxKeys?: number }): RateLimiter {
  const events = new Map<string, number[]>();
  const recent = (key: string, now: number) => (events.get(key) ?? []).filter((at) => now - at < windowMs);
  return {
    take(key, now) {
      const kept = recent(key, now);
      if (kept.length >= limit) {
        events.set(key, kept);
        return false;
      }
      kept.push(now);
      events.delete(key);
      events.set(key, kept);
      // Maps iterate in insertion order, so the first key is the one quiet the longest.
      if (events.size > maxKeys) events.delete(events.keys().next().value as string);
      return true;
    },
    retryAfterSeconds(key, now) {
      const kept = recent(key, now);
      if (kept.length < limit) return 0;
      return Math.max(1, Math.ceil((windowMs - (now - (kept[0] ?? now))) / 1_000));
    },
  };
}
