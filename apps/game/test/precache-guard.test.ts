import { describe, expect, it } from 'vitest';
import { PRECACHE_GUARD_BYTES, refuseLargePrecache } from '../precache-guard.ts';

const entry = (url: string, size: number) => ({ url, revision: null, size });

describe('precache size guard', () => {
  it('leaves headroom under the 2 MiB precache limit', () => {
    expect(PRECACHE_GUARD_BYTES).toBe(1_835_008);
    expect(PRECACHE_GUARD_BYTES).toBeLessThan(2 * 1024 * 1024);
  });

  it('passes the manifest through unchanged when every file is at or under the guard', () => {
    const manifest = [entry('assets/app.js', 750_000), entry('assets/phaser.js', PRECACHE_GUARD_BYTES)];
    expect(refuseLargePrecache(manifest)).toEqual({ manifest });
  });

  it('fails naming every file over the guard', () => {
    const manifest = [entry('assets/app.js', PRECACHE_GUARD_BYTES + 1), entry('assets/core.js', 11_000), entry('assets/phaser.js', 2_000_000)];
    expect(() => refuseLargePrecache(manifest)).toThrow(`assets/app.js (${PRECACHE_GUARD_BYTES + 1} bytes), assets/phaser.js (2000000 bytes)`);
    expect(() => refuseLargePrecache(manifest)).not.toThrow('core.js');
  });
});
