// Starts the real server as a child process for proof runs, and keeps every line it prints.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { poll, sleep } from './in-turn.mjs';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** A port free on 127.0.0.1 right now: `preferred` when nothing holds it, otherwise any. */
export function freePort(preferred = 0) {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', (error) => (preferred === 0 ? reject(error) : resolve(freePort())));
    probe.listen(preferred, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/**
 * Runs `node apps/server/src/index.ts` on `port`, or a free local port. `lines` collects stdout as
 * parsed JSON where possible; `problems()` lists error lines, non-JSON output and anything on stderr.
 */
export async function startServer({ env = {}, logFile, port: given } = {}) {
  const port = given ?? (await freePort());
  const child = spawn(process.execPath, ['apps/server/src/index.ts'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', LOG_LEVEL: 'info', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const raw = [];
  const lines = [];
  const stderr = [];
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (data) => {
    buffered += data;
    const parts = buffered.split('\n');
    buffered = parts.pop() ?? '';
    for (const line of parts) {
      if (!line.trim()) continue;
      raw.push(line);
      try {
        lines.push(JSON.parse(line));
      } catch {
        lines.push({ level: 'unstructured', msg: line });
      }
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (data) => {
    stderr.push(data);
    raw.push(`[stderr] ${data.trimEnd()}`);
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));

  const base = `http://127.0.0.1:${port}`;
  const healthy = () => fetch(`${base}/healthz`).then((response) => response.ok, () => false);
  const up = await poll(healthy, { deadline: Date.now() + 10_000, intervalMs: 100 });
  if (!up) {
    child.kill('SIGKILL');
    throw new Error(`the server did not answer /healthz on ${base}\n${raw.join('\n')}`);
  }

  return {
    port,
    base,
    lines,
    problems: () => [
      ...lines.filter((line) => line.level === 'error').map((line) => `error log: ${line.msg}`),
      ...lines.filter((line) => line.level === 'unstructured').map((line) => `unstructured output: ${line.msg}`),
      ...stderr.map((text) => `stderr: ${text.trim()}`),
    ],
    /** SIGTERM, then wait for a clean exit; returns the exit code. */
    stop: async (timeoutMs = 10_000) => {
      child.kill('SIGTERM');
      const result = await Promise.race([exited, sleep(timeoutMs).then(() => null)]);
      if (result === null) {
        child.kill('SIGKILL');
        return { code: null, signal: 'SIGKILL', timedOut: true };
      }
      return { ...result, timedOut: false };
    },
    /** SIGKILL, as a crash or a power cut stops it: nothing is saved on the way out. */
    kill: () => {
      child.kill('SIGKILL');
      return exited;
    },
    saveLog: () => {
      if (logFile) writeFileSync(logFile, `${raw.join('\n')}\n`);
    },
  };
}
