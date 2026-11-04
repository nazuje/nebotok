import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, type Config } from '../src/config.ts';
import { createServices, type Services } from '../src/services.ts';

/** A clock tests can move forward by hand. */
export function fakeClock(start = Date.UTC(2026, 4, 1, 9, 0, 0)) {
  let at = start;
  return {
    now: () => at,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

/** Real services on a database in a fresh temporary folder, removed by `dispose()`. */
export function tempServices(now?: () => number): { config: Config; services: Services; dispose(): void } {
  const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-test-'));
  const config = readConfig({ NODE_ENV: 'test', DATA_DIR: dataDir });
  const services = createServices(config, now);
  return {
    config,
    services,
    dispose: () => {
      services.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Runs `step` `times` times, each after the previous one settles (order matters for PIN attempts). */
export async function repeat<T>(times: number, step: (index: number) => Promise<T>, index = 0, results: T[] = []): Promise<T[]> {
  if (index >= times) return results;
  results.push(await step(index));
  return repeat(times, step, index + 1, results);
}

/** Waits for synced state to settle, since a patch may already have arrived before we ask. */
export async function until(check: () => boolean, what: string, deadline = Date.now() + 3_000): Promise<void> {
  if (check()) return;
  if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return until(check, what, deadline);
}
