import { describe, expect, it } from 'vitest';
import { BURST_KEPT, BURST_MOST, BURST_WINDOW_MS, createBurstCap, type SoundPriority } from '../src/sound-burst.ts';

/** The most starts any window of `BURST_WINDOW_MS` holds, ends included. */
function busiest(starts: readonly number[]): number {
  return Math.max(0, ...starts.map((from) => starts.filter((at) => at >= from && at - from <= BURST_WINDOW_MS).length));
}

describe('the burst cap', () => {
  it('lets a burst of hits start only until the window is nearly full, and again once it has passed', () => {
    const allow = createBurstCap();
    const started = Array.from({ length: 10 }, (_, at) => allow(1_000 + at, 'normal'));
    expect(started.filter(Boolean)).toHaveLength(BURST_MOST - BURST_KEPT);
    expect(allow(1_000 + BURST_WINDOW_MS, 'normal')).toBe(false);
    expect(allow(1_001 + BURST_WINDOW_MS, 'normal')).toBe(true);
  });

  it('keeps room for a result or a ring-out through a flurry of hits, up to six in the window', () => {
    const allow = createBurstCap();
    for (let at = 0; at < 10; at += 1) allow(2_000 + at, 'normal');
    expect(allow(2_020, 'keep')).toBe(true);
    expect(allow(2_030, 'keep')).toBe(true);
    expect(allow(2_040, 'keep')).toBe(false);
    expect(allow(2_040, 'normal')).toBe(false);
  });

  it('never starts more than six sounds in any 100 ms, however they come', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed / 2_147_483_648;
    };
    for (let trial = 0; trial < 50; trial += 1) {
      const allow = createBurstCap();
      const started: number[] = [];
      let now = 0;
      for (let at = 0; at < 300; at += 1) {
        now += Math.floor(random() * 30);
        const priority: SoundPriority = random() < 0.3 ? 'keep' : 'normal';
        if (allow(now, priority)) started.push(now);
      }
      expect(busiest(started)).toBeLessThanOrEqual(BURST_MOST);
    }
  });

  it('lets sounds spread out over time all start', () => {
    const allow = createBurstCap();
    const started = Array.from({ length: 40 }, (_, at) => allow(at * 30, 'normal'));
    expect(started.every(Boolean)).toBe(true);
  });
});
