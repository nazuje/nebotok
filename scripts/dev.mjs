// npm run dev: the server (restarting on change) and the Vite dev server together. Vite proxies
// /colyseus and /healthz to the server. Nothing opens a browser.
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const children = [
  { name: 'server', command: process.execPath, args: ['--watch', 'src/index.ts'], cwd: join(ROOT, 'apps/server') },
  // Through this same node binary: the .bin shim goes via a version manager that does not pass SIGTERM on.
  { name: 'game', command: process.execPath, args: [join(ROOT, 'node_modules/vite/bin/vite.js')], cwd: join(ROOT, 'apps/game') },
].map(({ name, command, args, cwd }) => {
  // Local only unless HOST says otherwise: the dev server should not be reachable from the network.
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { HOST: '127.0.0.1', ...process.env } });
  const prefix = (stream, target) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (data) => {
      const lines = (rest + data).split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) target.write(`[${name}] ${line}\n`);
    });
  };
  prefix(child.stdout, process.stdout);
  prefix(child.stderr, process.stderr);
  return child;
});

const exited = children.map((child) => new Promise((resolve) => child.once('exit', resolve)));
let stopping = false;
const stop = async (code) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  const force = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 5_000);
  await Promise.all(exited);
  clearTimeout(force);
  process.exit(code);
};
for (const child of children) child.once('exit', (code) => stop(code ?? 1));
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
