// npm run dev: the server (restarting on change) and the Vite dev server together. Vite proxies
// /colyseus and /healthz to the server. Nothing opens a browser. The game is on 5173 and the server
// on 2567 when those are free; otherwise (another worktree's dev, say) on free ports, printed below.
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { ROOT, freePort } from './lib/server-process.mjs';

const serverPort = await freePort(2567);
const gamePort = await freePort(5173);
const ports = { NEBOTOK_SERVER_PORT: String(serverPort), NEBOTOK_GAME_PORT: String(gamePort) };

const children = [
  { name: 'server', command: process.execPath, args: ['--watch', 'src/index.ts'], cwd: join(ROOT, 'apps/server'), env: { PORT: String(serverPort) } },
  // Through this same node binary: the .bin shim goes via a version manager that does not pass SIGTERM on.
  { name: 'game', command: process.execPath, args: [join(ROOT, 'node_modules/vite/bin/vite.js')], cwd: join(ROOT, 'apps/game'), env: ports },
].map(({ name, command, args, cwd, env }) => {
  // Local only unless HOST says otherwise: the dev server should not be reachable from the network.
  const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { HOST: '127.0.0.1', ...process.env, ...env } });
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

console.log(`dev: the game is at http://127.0.0.1:${gamePort}/ and the server on port ${serverPort}`);
// Where `npm run scene` finds this worktree's dev server; gone again when dev stops.
const DEV_FILE = join(ROOT, '.proof', 'dev.json');
mkdirSync(join(ROOT, '.proof'), { recursive: true });
// dataDir is the server's database folder, where a scene writes the saves its players start from.
// The server runs in apps/server, so a relative DATA_DIR is from there.
const dataDir = process.env.DATA_DIR ? resolvePath(ROOT, 'apps/server', process.env.DATA_DIR) : join(ROOT, '.local-data');
writeFileSync(DEV_FILE, `${JSON.stringify({ game: `http://127.0.0.1:${gamePort}`, serverPort, pid: process.pid, dataDir }, null, 2)}\n`);

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
  rmSync(DEV_FILE, { force: true });
  process.exit(code);
};
for (const child of children) child.once('exit', (code) => stop(code ?? 1));
process.once('SIGINT', () => stop(0));
process.once('SIGTERM', () => stop(0));
