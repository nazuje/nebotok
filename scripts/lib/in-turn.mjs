// Helpers for work that must happen one step at a time (shared ports, ordered joins, one browser at
// a time), written as recursion so each step starts only after the previous one settles.

/** Runs fn over items strictly in order and resolves with the results in the same order. */
export async function inTurn(items, fn, index = 0, results = []) {
  if (index >= items.length) return results;
  results.push(await fn(items[index], index));
  return inTurn(items, fn, index + 1, results);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls check() every intervalMs until it resolves truthy or the deadline passes; resolves with the last answer. */
export async function poll(check, { deadline, intervalMs = 25 }) {
  const answer = await check();
  if (answer || Date.now() > deadline) return answer;
  await sleep(intervalMs);
  return poll(check, { deadline, intervalMs });
}
