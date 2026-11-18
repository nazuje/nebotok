import type { Working } from './working.ts';

/**
 * Weather on the island: a `weather` move sets its weather, and every ultimate its own type's. A
 * new weather ends the old one early. The weather chart applies to every hit (`strike`).
 */

/** Asks for `type` weather for `ticks`; the step settles every call once both sides have acted. */
export function callWeather(work: Working, type: string, ticks: number): void {
  if (ticks > 0) work.weatherCalls.push({ type, ticks });
}

const byType = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Of the weathers cast this step, the longest wins, then the first type id in sort order, so
 * which side acted first never decides.
 */
export function settleWeather(work: Working): void {
  const [winner] = work.weatherCalls.toSorted((a, b) => b.ticks - a.ticks || byType(a.type, b.type));
  work.weatherCalls.length = 0;
  if (!winner) return;
  const old = work.weather;
  if (old && old.type !== winner.type) work.events.push({ kind: 'weatherEnded', weather: old.type });
  work.weather = winner;
  work.events.push({ kind: 'weatherStarted', weather: winner.type, ticks: winner.ticks });
}

/** The weather's ticks count down; at 0 it ends. */
export function weatherTickDown(work: Working): void {
  const { weather } = work;
  if (!weather) return;
  if (weather.ticks > 1) {
    work.weather = { ...weather, ticks: weather.ticks - 1 };
    return;
  }
  work.weather = null;
  work.events.push({ kind: 'weatherEnded', weather: weather.type });
}
