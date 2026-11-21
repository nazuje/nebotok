// Workbox precaches no file over 2 MiB (its default maximumFileSizeToCacheInBytes), and the build
// then fails. This fails it earlier, with headroom, so a growing chunk is noticed before then.
export const PRECACHE_GUARD_BYTES = 1.75 * 1024 * 1024;

interface PrecacheEntry {
  url: string;
  size: number;
}

/** A Workbox manifest transform that refuses any precached file over PRECACHE_GUARD_BYTES. */
export const refuseLargePrecache = <Entry extends PrecacheEntry>(manifest: Entry[]): { manifest: Entry[] } => {
  const large = manifest.filter((entry) => entry.size > PRECACHE_GUARD_BYTES);
  if (large.length > 0) {
    const list = large.map((entry) => `${entry.url} (${entry.size} bytes)`).join(', ');
    throw new Error(`Precached files over ${PRECACHE_GUARD_BYTES} bytes: ${list}. Split or shrink them before they reach Workbox's 2 MiB precache limit.`);
  }
  return { manifest };
};
