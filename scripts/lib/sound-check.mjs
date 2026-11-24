// The sounds a page asked for, as its test hook records them (`sounds.played`, the last 30), for
// the checks that play an event to see its sound was asked for. No sound reaches the speakers.
import { readState, until } from './game-page.mjs';

/** Waits up to `timeoutMs` for the page to record the sound `id`; returns a problem, or null once it has. */
export async function heardProblem(page, id, what, timeoutMs = 3_000) {
  const heard = (state) => state.sounds?.played.some((played) => played.id === id) === true;
  const state = await until(page, heard, `the sound ${id} of ${what}`, timeoutMs).catch(() => readState(page));
  return heard(state) ? null : `${what} recorded the sounds ${JSON.stringify(state.sounds?.played.slice(-6).map((played) => played.id))}, no ${id}`;
}
