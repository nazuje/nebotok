import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db.ts';
import { createLog } from '../src/log.ts';
import { listSnapshots, snapshotDue, snapshotName, SNAPSHOTS_KEPT, startSnapshots, takeSnapshot } from '../src/snapshots.ts';

const folders: string[] = [];
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nebotok-snapshots-'));
  folders.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const at = (iso: string) => Date.parse(iso);
const fourInTheMorning = () => at('2026-11-04T04:00:00Z');

function worldWithOnePlayer(dir: string): DatabaseSync {
  const db = openDatabase(join(dir, 'world.sqlite3'));
  db.prepare("INSERT INTO players (name, name_key, avatar, created_at) VALUES ('Čmrljček Šumež', 'čmrljček šumež', 'blue', 1)").run();
  return db;
}

describe('snapshot names and timing', () => {
  it('names a snapshot by its UTC time, so names sort by time', () => {
    expect(snapshotName(at('2026-11-04T03:05:12.345Z'))).toBe('nebotok-20261104T030512Z.db');
    const names = ['2026-01-02T00:00:00Z', '2025-12-31T23:59:59Z', '2026-01-01T10:00:00Z'].map((iso) => snapshotName(at(iso)));
    expect(names.toSorted()).toEqual([names[1], names[2], names[0]]);
  });

  it('is due when there is none, and once a night after 03:00 UTC', () => {
    expect(snapshotDue([], at('2026-11-04T12:00:00Z'))).toBe(true);
    const lastNight = [snapshotName(at('2026-11-04T03:20:00Z'))];
    expect(snapshotDue(lastNight, at('2026-11-04T23:00:00Z'))).toBe(false);
    expect(snapshotDue(lastNight, at('2026-11-05T02:59:59Z'))).toBe(false);
    expect(snapshotDue(lastNight, at('2026-11-05T03:00:00Z'))).toBe(true);
    const beforeThree = [snapshotName(at('2026-11-04T02:00:00Z'))];
    expect(snapshotDue(beforeThree, at('2026-11-04T02:30:00Z'))).toBe(false);
    expect(snapshotDue(beforeThree, at('2026-11-04T03:10:00Z'))).toBe(true);
  });

  it('lists only snapshot files, oldest first, and nothing for a missing folder', () => {
    const dir = folder();
    for (const name of ['nebotok-20261104T030000Z.db', 'notes.txt', '.partial-nebotok-20261105T030000Z.db', 'nebotok-20261103T030000Z.db']) {
      writeFileSync(join(dir, name), '');
    }
    expect(listSnapshots(dir)).toEqual(['nebotok-20261103T030000Z.db', 'nebotok-20261104T030000Z.db']);
    expect(listSnapshots(join(dir, 'missing'))).toEqual([]);
  });
});

describe('taking snapshots', () => {
  it('writes a whole, standalone copy of the database that opens on its own', () => {
    const db = worldWithOnePlayer(folder());
    const dir = join(folder(), 'snapshots');
    const { file } = takeSnapshot(db, dir, at('2026-11-04T03:00:00Z'));
    db.close();
    expect(readdirSync(dir)).toEqual([file]);
    const copy = new DatabaseSync(join(dir, file), { readOnly: true });
    expect(copy.prepare('SELECT name FROM players').all()).toEqual([{ name: 'Čmrljček Šumež' }]);
    expect(copy.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    copy.close();
  });

  it(`keeps only the newest ${SNAPSHOTS_KEPT}, and leaves other files alone`, () => {
    const db = worldWithOnePlayer(folder());
    const dir = folder();
    const days = Array.from({ length: SNAPSHOTS_KEPT }, (_unused, day) => snapshotName(at('2026-10-01T03:00:00Z') + day * 86_400_000));
    for (const name of days) writeFileSync(join(dir, name), '');
    writeFileSync(join(dir, 'keep-me.txt'), '');
    const { file, removed } = takeSnapshot(db, dir, at('2026-11-04T03:00:00Z'));
    db.close();
    expect(removed).toBe(1);
    expect(listSnapshots(dir)).toEqual([...days.slice(1), file]);
    expect(existsSync(join(dir, 'keep-me.txt'))).toBe(true);
  });

  it('replaces a half-written copy left by a crash', () => {
    const db = worldWithOnePlayer(folder());
    const dir = folder();
    const when = at('2026-11-04T03:00:00Z');
    writeFileSync(join(dir, `.partial-${snapshotName(when)}`), 'half');
    takeSnapshot(db, dir, when);
    db.close();
    expect(readdirSync(dir)).toEqual([snapshotName(when)]);
  });
});

describe('the snapshot schedule', () => {
  it('takes one at start when due, then not again the same night, and logs no player data', () => {
    const lines: string[] = [];
    const log = createLog('info', (line) => lines.push(line));
    const db = worldWithOnePlayer(folder());
    const dir = join(folder(), 'snapshots');
    startSnapshots({ db, dir, log, now: fourInTheMorning }).stop();
    startSnapshots({ db, dir, log, now: fourInTheMorning }).stop();
    db.close();
    expect(listSnapshots(dir)).toEqual(['nebotok-20261104T040000Z.db']);
    expect(lines.map((line) => JSON.parse(line) as { msg: string })).toEqual([
      expect.objectContaining({ level: 'info', msg: 'snapshot taken', file: 'nebotok-20261104T040000Z.db', removed: 0 }),
    ]);
    expect(lines.join('\n')).not.toContain('Čmrljček');
  });

  it('logs a failure instead of throwing', () => {
    const lines: string[] = [];
    const db = worldWithOnePlayer(folder());
    const blocked = join(folder(), 'not-a-folder');
    writeFileSync(blocked, '');
    expect(() => startSnapshots({ db, dir: join(blocked, 'snapshots'), log: createLog('info', (line) => lines.push(line)) }).stop()).not.toThrow();
    db.close();
    expect(lines.map((line) => (JSON.parse(line) as { msg: string }).msg)).toEqual(['snapshot failed']);
  });

  it('does nothing once the database is closed', () => {
    const lines: string[] = [];
    const db = worldWithOnePlayer(folder());
    db.close();
    const dir = join(folder(), 'snapshots');
    mkdirSync(dir);
    startSnapshots({ db, dir, log: createLog('info', (line) => lines.push(line)) }).stop();
    expect(lines).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });
});
