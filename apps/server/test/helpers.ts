import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readConfig, type Config } from '../src/config.ts';
import { createLog, type Log } from '../src/log.ts';
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

/** A port free on 127.0.0.1 right now, so test servers in several worktrees never share one. */
export function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Real services on a database in a fresh temporary folder, removed by `dispose()`. */
export function tempServices(now?: () => number, log: Log = createLog('silent')): { config: Config; services: Services; dispose(): void } {
  const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-test-'));
  const config = readConfig({ NODE_ENV: 'test', DATA_DIR: dataDir });
  const services = createServices(config, now, log);
  return {
    config,
    services,
    dispose: () => {
      services.close();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

/** Log lines as parsed JSON, for tests that check what was logged. */
export function capturedLog(level: 'debug' | 'info' | 'warn' = 'warn'): { log: Log; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return { log: createLog(level, (line) => lines.push(JSON.parse(line) as Record<string, unknown>)), lines };
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
