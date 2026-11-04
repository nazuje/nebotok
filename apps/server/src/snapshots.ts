import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Log } from './log.ts';

/** Where in DATA_DIR the nightly snapshots go. Litestream's container copies them to the backup folder. */
export const SNAPSHOT_DIR = 'snapshots';
export const SNAPSHOTS_KEPT = 30;
/** A night's snapshot falls due at 03:00 UTC, the small hours in Europe. */
export const SNAPSHOT_HOUR_UTC = 3;
const CHECK_EVERY_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SNAPSHOT_FILE = /^nebotok-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.db$/;

/** `nebotok-20261104T030512Z.db`: sorting the names sorts them by time. */
export function snapshotName(at: number): string {
  const stamp = new Date(at).toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
  return `nebotok-${stamp}.db`;
}

function takenAt(name: string): number {
  const [, year, month, day, hour, minute, second] = (SNAPSHOT_FILE.exec(name) ?? []).map(Number);
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute, second);
}

/** The snapshots in `dir`, oldest first. Anything else in the folder is left alone. */
export function listSnapshots(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return names.filter((name) => SNAPSHOT_FILE.test(name)).toSorted();
}

/** Due when there is none yet, or the newest one is older than the last 03:00 UTC. */
export function snapshotDue(names: readonly string[], at: number): boolean {
  const newest = names.at(-1);
  if (newest === undefined) return true;
  const day = new Date(at);
  const todayAtHour = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), SNAPSHOT_HOUR_UTC);
  const lastDueAt = at >= todayAtHour ? todayAtHour : todayAtHour - DAY_MS;
  return takenAt(newest) < lastDueAt;
}

/**
 * Writes a complete, self-contained copy of the database with `VACUUM INTO`, which reads one
 * consistent view while the game keeps running. It is written under a hidden name and renamed when
 * whole, so a copy is never picked up half-written. Then only the newest SNAPSHOTS_KEPT stay.
 */
export function takeSnapshot(db: DatabaseSync, dir: string, at: number): { readonly file: string; readonly removed: number } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = snapshotName(at);
  const partial = join(dir, `.partial-${file}`);
  rmSync(partial, { force: true });
  db.prepare('VACUUM INTO ?').run(partial);
  renameSync(partial, join(dir, file));
  const old = listSnapshots(dir).slice(0, -SNAPSHOTS_KEPT);
  for (const name of old) rmSync(join(dir, name), { force: true });
  return { file, removed: old.length };
}

export type SnapshotSchedule = { stop(): void };

/** Checks at start and then hourly, and takes the night's snapshot when it is due. Never throws. */
export function startSnapshots(options: {
  readonly db: DatabaseSync;
  readonly dir: string;
  readonly log: Log;
  readonly now?: () => number;
}): SnapshotSchedule {
  const { db, dir, log, now = Date.now } = options;
  const tick = () => {
    try {
      const at = now();
      if (!db.isOpen || !snapshotDue(listSnapshots(dir), at)) return;
      log.info('snapshot taken', takeSnapshot(db, dir, at));
    } catch (error) {
      log.error('snapshot failed', { error });
    }
  };
  tick();
  const timer = setInterval(tick, CHECK_EVERY_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
