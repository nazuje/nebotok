// The backup half of the container proof (scripts/container-check.mjs): with the stack running, it
// restores Litestream's replica from the backup folder alone into a fresh folder and compares it
// with the live database, waits for the nightly snapshot to reach the backup folder, and runs
// scripts/restore.sh three ways (newest copy, a snapshot, undo), checking the saves each time.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SNAPSHOT_FILE = /^nebotok-\d{8}T\d{6}Z\.db$/;
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** Profiles (without PIN hashes), saved progress and SQLite's integrity verdict, as one JSON line. */
const DUMP = `const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
const all = (sql) => db.prepare(sql).all();
console.log(JSON.stringify({
  integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
  profiles: all('SELECT id, name, avatar, pin_hash IS NOT NULL AS pin FROM players ORDER BY id'),
  progress: all('SELECT player_id, save_version, data FROM player_progress ORDER BY player_id'),
}));`;

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
const fileSaves = (file) => parse(spawnSync(process.execPath, ['-e', DUMP, file], { encoding: 'utf8' }).stdout ?? '');
const sameSaves = (a, b) => Boolean(a && b) && JSON.stringify([a.profiles, a.progress]) === JSON.stringify([b.profiles, b.progress]);
const describe = (dump) => (dump ? `${dump.profiles.length} profile(s), ${dump.progress.length} saved progress` : 'unreadable');

/** Calls `attempt` every second until it returns something truthy or `timeoutMs` passes. */
function waitFor(attempt, timeoutMs) {
  const until = Date.now() + timeoutMs;
  let result = attempt();
  while (!result && Date.now() < until) {
    pause(1000);
    result = attempt();
  }
  return result;
}

/**
 * @param {object} helpers from container-check: `run(command, args, options)`, `docker(args)`,
 *   `exec(...args)` in the app container, `check(name, ok, detail)`, the host `backups` folder and
 *   the `litestreamImage` the stack runs.
 */
export function checkBackups({ run, docker, exec, check, backups, litestreamImage, restoreScript }) {
  const liveSaves = () => parse(exec('node', '-e', DUMP, '/data/nebotok.db').stdout);

  const live = liveSaves();
  check('the game has saves to back up', live?.profiles.length > 0 && live.progress.length > 0, describe(live));

  // Only the backup folder (read-only) and an empty folder: the replica alone must be enough.
  const restoreFresh = () => {
    const into = mkdtempSync(join(tmpdir(), 'nebotok-restore-'));
    const restored = docker(['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--user', '1000:1000',
      '-v', `${backups}:/backups:ro`, '-v', `${into}:/restore`,
      litestreamImage, 'restore', '-integrity-check', 'full', '-o', '/restore/nebotok.db', 'file:///backups/litestream']);
    const saves = restored.code === 0 ? fileSaves(join(into, 'nebotok.db')) : null;
    rmSync(into, { recursive: true, force: true });
    return sameSaves(saves, live) && saves.integrity === 'ok' ? saves : null;
  };
  const restored = waitFor(restoreFresh, 30_000);
  check('a fresh restore from the backup folder alone has the same profiles and progress', restored, describe(restored));

  const snapshots = join(backups, 'snapshots');
  const snapshot = waitFor(() => existsSync(snapshots) && readdirSync(snapshots).toSorted().findLast((name) => SNAPSHOT_FILE.test(name)), 45_000);
  const snapshotSaves = snapshot ? fileSaves(join(snapshots, snapshot)) : null;
  check('the nightly snapshot reaches the backup folder and passes its integrity check', snapshotSaves?.integrity === 'ok', snapshot || 'none after 45 s');

  const stamps = [];
  const restore = (...args) => {
    const result = run(restoreScript, ['--yes', ...args], { timeoutMs: 300_000 });
    const stamp = /--undo (\d{8}T\d{6}Z)/.exec(result.stdout)?.[1];
    if (stamp) stamps.push(stamp);
    return { ok: result.code === 0, stamp, saves: liveSaves() };
  };
  const newest = restore();
  check('scripts/restore.sh puts the newest backup back and the game starts on it', newest.ok && sameSaves(newest.saves, live), describe(newest.saves));
  if (snapshot) {
    const older = restore('--snapshot', snapshot);
    check('scripts/restore.sh --snapshot brings back that night', older.ok && sameSaves(older.saves, snapshotSaves), describe(older.saves));
    const undone = older.stamp ? restore('--undo', older.stamp) : { ok: false };
    check('scripts/restore.sh --undo puts back what the restore replaced', undone.ok && sameSaves(undone.saves, live), describe(undone.saves));
  }
  // The replaced databases are kept by design; the check removes only the ones it made itself.
  const leftovers = stamps.map((stamp) => `/data/before-restore-${stamp}`);
  exec('node', '-e', 'for (const dir of process.argv.slice(1)) require("node:fs").rmSync(dir, { recursive: true, force: true })', ...leftovers);
}
