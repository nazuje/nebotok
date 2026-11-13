import { describe, expect, it } from 'vitest';
import { MAX_WAITING, REQUESTS_PER_WINDOW, WINDOW_MS, createRequestPacer } from '../src/request-pacer.ts';

/** A pacer on a clock the test moves by hand, with every request it delivered and when. */
function pacedClock() {
  let time = 0;
  let timers: { at: number; run: () => void }[] = [];
  const delivered: { id: number; at: number }[] = [];
  const pacer = createRequestPacer({
    now: () => time,
    later: (run, ms) => {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => {
        timers = timers.filter((each) => each !== timer);
      };
    },
  });
  const advance = (to: number) => {
    for (;;) {
      const next = timers.filter((timer) => timer.at <= to).toSorted((a, b) => a.at - b.at)[0];
      if (!next) break;
      timers = timers.filter((timer) => timer !== next);
      time = next.at;
      next.run();
    }
    time = to;
  };
  const send = (id: number) => pacer.send(() => delivered.push({ id, at: time }));
  return { pacer, send, advance, delivered, timers: () => timers.length };
}

/** The most requests delivered in any one second, the server's window. */
const busiestSecond = (times: readonly number[]) => Math.max(...times.map((start) => times.filter((at) => at >= start && at < start + 1_000).length));

describe('the request pacer', () => {
  it('sends at once while there is room, then holds the rest in order until the window has room', () => {
    const clock = pacedClock();
    for (let id = 0; id < REQUESTS_PER_WINDOW + 2; id += 1) clock.send(id);
    expect(clock.delivered.map(({ at }) => at)).toEqual(Array.from({ length: REQUESTS_PER_WINDOW }, () => 0));
    clock.advance(WINDOW_MS);
    expect(clock.delivered.map(({ id }) => id)).toEqual(Array.from({ length: REQUESTS_PER_WINDOW + 2 }, (_, id) => id));
    expect(clock.delivered.at(-1)?.at).toBe(WINDOW_MS);
  });

  it('never lets more than the server allows out in any second, however fast it is tapped', () => {
    const clock = pacedClock();
    // Eight taps a second for five seconds, each one a request.
    for (let at = 0, id = 0; at < 5_000; at += 125, id += 1) {
      clock.advance(at);
      clock.send(id);
    }
    clock.advance(60_000);
    expect(busiestSecond(clock.delivered.map(({ at }) => at))).toBeLessThanOrEqual(REQUESTS_PER_WINDOW);
    const ids = clock.delivered.map(({ id }) => id);
    expect(ids).toEqual(ids.toSorted((a, b) => a - b));
  });

  it('drops requests past the most that may wait, and everything waiting on reset', () => {
    const clock = pacedClock();
    for (let id = 0; id < REQUESTS_PER_WINDOW + MAX_WAITING + 3; id += 1) clock.send(id);
    clock.advance(60_000);
    expect(clock.delivered).toHaveLength(REQUESTS_PER_WINDOW + MAX_WAITING);
    const fresh = pacedClock();
    for (let id = 0; id < REQUESTS_PER_WINDOW + 1; id += 1) fresh.send(id);
    fresh.pacer.reset();
    expect(fresh.timers()).toBe(0);
    fresh.send(99);
    fresh.advance(60_000);
    expect(fresh.delivered.map(({ id }) => id)).toEqual([0, 1, 2, 3, 4, 99]);
  });
});
