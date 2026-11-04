// Container proof: builds the production image from source with compose.local.yaml, starts it with
// the same sealing as on the Mac mini, then checks it from outside (Docker's own record of the
// containers) and from inside (what the server process can really do), plays it in Chromium and
// WebKit, proves the backups restore (scripts/lib/backup-check.mjs), and stops it the way an update
// does. The data volume is always left in place; the backup folder is a temporary one.
//   node scripts/container-check.mjs [--out <dir>]
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { checkBackups } from './lib/backup-check.mjs';
import { ROOT } from './lib/server-process.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = values.out ?? join(ROOT, '.proof', 'container-check');
const logs = join(out, 'logs');
mkdirSync(logs, { recursive: true });
const COMMAND_LOG = join(logs, 'container-check-commands.log');
writeFileSync(COMMAND_LOG, '');

// compose.local.yaml names its own project (nebotok-local), so nothing here can touch production.
const COMPOSE = ['compose', '-f', 'compose.local.yaml'];
const BASE = `http://127.0.0.1:${process.env.NEBOTOK_LOCAL_PORT ?? '2567'}`;
// Litestream backs the local stack up here, never into the Mac mini's BACKUP_DIR. COMPOSE_FILE
// points scripts/restore.sh at the local stack too.
const BACKUPS = mkdtempSync(join(tmpdir(), 'nebotok-local-backups-'));
const ENV = { ...process.env, COMPOSE_FILE: 'compose.local.yaml', NEBOTOK_LOCAL_BACKUP_DIR: BACKUPS };

function run(command, args, { timeoutMs = 120_000 } = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, env: ENV, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? '';
  appendFileSync(COMMAND_LOG, `$ ${command} ${args.join(' ')}\n${stdout}${stderr}exit ${result.status ?? result.signal}\n\n`);
  return { code: result.status ?? 1, stdout, stderr };
}
const docker = (args, options) => run('docker', args, options);
const compose = (args, options) => docker([...COMPOSE, ...args], options);
const inspect = (id) => JSON.parse(docker(['inspect', id]).stdout)[0];
const exec = (...args) => compose(['exec', '-T', 'app', ...args]);
/** Tries to write a file as the server's user; answers 'written' or the error code. */
const tryWrite = (path) =>
  exec('node', '-e', `try { require('node:fs').writeFileSync(${JSON.stringify(path)}, 'probe'); console.log('written'); } catch (error) { console.log(error.code); }`).stdout.trim();

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

/** What Docker itself says about how the container is sealed. */
function checkFromOutside(info) {
  const host = info.HostConfig;
  check('runs as a non-root user', info.Config.User && !['root', '0', '0:0'].includes(info.Config.User), `user ${info.Config.User || '(image default)'}`);
  check('root filesystem is read-only', host.ReadonlyRootfs === true);
  check('every capability dropped', (host.CapDrop ?? []).includes('ALL') && (host.CapAdd ?? []).length === 0, `drop ${host.CapDrop}, add ${host.CapAdd ?? 'none'}`);
  check('no-new-privileges is set', (host.SecurityOpt ?? []).some((option) => /^no-new-privileges(:true)?$/.test(option)));
  check('not privileged', host.Privileged === false);
  const mounts = info.Mounts.map((mount) => `${mount.Type}:${mount.Destination}`);
  check('no host folders or Docker socket mounted', info.Mounts.every((mount) => mount.Type === 'volume'), mounts.join(', '));
  const bindings = Object.values(host.PortBindings ?? {}).flat();
  check('port published on 127.0.0.1 only', bindings.length > 0 && bindings.every((binding) => binding.HostIp === '127.0.0.1'), bindings.map((binding) => `${binding.HostIp}:${binding.HostPort}`).join(', '));
  check('memory, CPU and process limits set', host.Memory > 0 && host.NanoCpus > 0 && host.PidsLimit > 0, `memory ${host.Memory}, nanoCPUs ${host.NanoCpus}, pids ${host.PidsLimit}`);
  check('healthcheck reports healthy', info.State.Health?.Status === 'healthy', info.State.Health?.Status);
}

/** What Docker says about the Litestream container: sealed like the game, with no network at all. */
function checkLitestreamFromOutside(info) {
  const host = info.HostConfig;
  check('Litestream runs as the game\'s uid, not root', info.Config.User === '1000:1000', `user ${info.Config.User || '(image default)'}`);
  check('Litestream: read-only root, every capability dropped, no-new-privileges, not privileged',
    host.ReadonlyRootfs === true && (host.CapDrop ?? []).includes('ALL') && (host.CapAdd ?? []).length === 0
      && (host.SecurityOpt ?? []).some((option) => /^no-new-privileges(:true)?$/.test(option)) && host.Privileged === false);
  check('Litestream has no network', host.NetworkMode === 'none', host.NetworkMode);
  const mounts = info.Mounts.map((mount) => `${mount.Type}:${mount.Destination}${mount.RW ? '' : ':ro'}`).toSorted();
  const expected = ['bind:/backups', 'bind:/etc/litestream:ro', 'volume:/data'];
  check('Litestream sees only the data volume, its read-only config and the backup folder',
    JSON.stringify(mounts) === JSON.stringify(expected) && info.Mounts.some((mount) => mount.Destination === '/backups' && mount.Source.endsWith(BACKUPS)),
    mounts.join(', '));
  check('Litestream has memory, CPU and process limits', host.Memory > 0 && host.NanoCpus > 0 && host.PidsLimit > 0, `memory ${host.Memory}, nanoCPUs ${host.NanoCpus}, pids ${host.PidsLimit}`);
}

/** What the server's own user can do inside the running container. */
function checkFromInside() {
  const uid = exec('id', '-u').stdout.trim();
  check('the server process is not uid 0', uid !== '' && uid !== '0', `uid ${uid}`);
  const root = tryWrite('/nebotok-probe');
  check('cannot write to /', root === 'EROFS', root);
  const code = tryWrite('/app/apps/server/src/probe.ts');
  check('cannot change its own code', code === 'EROFS' || code === 'EACCES', code);
  const data = tryWrite('/data/.nebotok-probe');
  check('can write its data volume', data === 'written', data);
  exec('node', '-e', "require('node:fs').rmSync('/data/.nebotok-probe', { force: true })");
  const temp = tryWrite('/tmp/nebotok-probe');
  check('can write /tmp (in memory)', temp === 'written', temp);
  const socket = exec('node', '-e', "console.log(require('node:fs').existsSync('/var/run/docker.sock'))").stdout.trim();
  check('no Docker socket inside', socket === 'false', `exists: ${socket}`);
}

/** Error lines, non-JSON lines and anything on stderr, like the host-run server check. */
function logProblems(stdout, stderr) {
  const lines = stdout.split('\n').filter((line) => line.trim());
  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { level: 'unstructured', msg: line };
    }
  });
  const problems = [
    ...parsed.filter((line) => line.level === 'error' || line.level === 'unstructured').map((line) => `${line.level}: ${line.msg}`),
    ...stderr.split('\n').filter((line) => line.trim()).map((line) => `stderr: ${line}`),
  ];
  return { parsed, problems };
}

/** Litestream logs JSON lines with upper-case levels; the snapshot copy loop writes the same shape. */
function stopLitestream(id) {
  const stop = compose(['stop', '--timeout', '30', 'litestream'], { timeoutMs: 60_000 });
  const after = inspect(id);
  check('Litestream stops cleanly on SIGTERM', stop.code === 0 && after.State.ExitCode === 0, `exit code ${after.State.ExitCode}`);
  const { stdout, stderr } = docker(['logs', id]);
  writeFileSync(join(logs, 'container-litestream.log'), `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`);
  const problems = `${stdout}\n${stderr}`.split('\n').filter((line) => /"level":"(ERROR|WARN)"/.test(line));
  check('Litestream log has no errors or warnings', problems.length === 0, problems.slice(0, 2).join('; ') || undefined);
}

function stopAndReadLogs(id) {
  const stop = compose(['stop', '--timeout', '30', 'app'], { timeoutMs: 60_000 });
  const after = inspect(id);
  check('stops cleanly on SIGTERM', stop.code === 0 && after.State.ExitCode === 0 && !after.State.OOMKilled, `exit code ${after.State.ExitCode}`);
  const { stdout, stderr } = docker(['logs', id]);
  writeFileSync(join(logs, 'container-server.log'), `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ''}`);
  const { parsed, problems } = logProblems(stdout, stderr);
  check('server log is clean JSON with no errors', problems.length === 0, problems.slice(0, 3).join('; ') || `${parsed.length} lines`);
  check('server logged a graceful shutdown', parsed.some((line) => line.msg === 'shutdown complete'));
}

let id = '';
let litestream = '';
let image = null;
try {
  compose(['down']);
  const build = compose(['build'], { timeoutMs: 900_000 });
  check('image builds from source', build.code === 0, `exit ${build.code}`);
  if (build.code === 0) {
    const [imageId, size] = docker(['image', 'inspect', 'nebotok:local', '--format', '{{.Id}} {{.Size}}']).stdout.trim().split(' ');
    image = { tag: 'nebotok:local', id: imageId, sizeBytes: Number(size) };
    const up = compose(['up', '-d', '--wait', '--wait-timeout', '90']);
    check('container starts and turns healthy', up.code === 0, up.code === 0 ? undefined : up.stderr.trim().split('\n').at(-1));
    id = compose(['ps', '-a', '-q', 'app']).stdout.trim();
    litestream = compose(['ps', '-a', '-q', 'litestream']).stdout.trim();
  }
  if (id && litestream) {
    checkFromOutside(inspect(id));
    checkLitestreamFromOutside(inspect(litestream));
    checkFromInside();
    const browsers = spawnSync(process.execPath, ['scripts/browser-check.mjs', '--url', BASE, '--out', join(out, 'container')], {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 600_000,
    });
    check('Chromium and WebKit play the game served by the container', browsers.status === 0, `exit ${browsers.status}, see ${relative(ROOT, join(out, 'container', 'logs', 'browser-check.json'))}`);
    checkBackups({ run, docker, exec, check, backups: BACKUPS, litestreamImage: inspect(litestream).Config.Image, restoreScript: join(ROOT, 'scripts', 'restore.sh') });
    stopAndReadLogs(id);
    stopLitestream(litestream);
  }
} finally {
  // Removes the containers and their network. Never -v: volumes outlive every check.
  const down = compose(['down']);
  check('stack removed with its data volume kept', down.code === 0);
  rmSync(BACKUPS, { recursive: true, force: true });
}

const ok = checks.length > 0 && checks.every((result) => result.ok);
writeFileSync(join(logs, 'container-check.json'), `${JSON.stringify({ ok, base: BASE, image, checks }, null, 2)}\n`);
const failed = checks.filter((result) => !result.ok).length;
console.log(failed ? `\ncontainer-check: ${failed} check(s) failed` : `\ncontainer-check: all ${checks.length} checks passed`);
process.exit(ok ? 0 : 1);
