import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate, openDatabase, readMigrations, schemaVersion } from '../src/db.ts';

const folders: string[] = [];
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nebotok-db-'));
  folders.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tables = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);

describe('database migrations', () => {
  it('numbers the real migrations 1, 2, 3 … without gaps', () => {
    const migrations = readMigrations();
    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations.map((migration) => migration.version)).toEqual(migrations.map((_migration, at) => at + 1));
  });

  it('builds a fresh database up to the newest version, with WAL and foreign keys on', () => {
    const db = openDatabase(join(folder(), 'world.sqlite3'));
    expect(schemaVersion(db)).toBe(readMigrations().length);
    expect(tables(db)).toEqual(['player_progress', 'players', 'sessions']);
    expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(db.prepare('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare('PRAGMA busy_timeout').get()).toEqual({ timeout: 5000 });
    db.close();
  });

  it('leaves an up-to-date database alone and keeps its data on reopening', () => {
    const file = join(folder(), 'world.sqlite3');
    const first = openDatabase(file);
    first.prepare("INSERT INTO players (name, name_key, avatar, created_at) VALUES ('Test', 'test', 'blue', 1)").run();
    first.close();
    const again = openDatabase(file);
    expect(migrate(again, readMigrations())).toEqual({ from: readMigrations().length, to: readMigrations().length });
    expect(again.prepare('SELECT count(*) AS n FROM players').get()).toEqual({ n: 1 });
    again.close();
  });

  it('applies only the steps a database is missing, in one transaction', () => {
    const dir = folder();
    writeFileSync(join(dir, '001-first.sql'), 'CREATE TABLE one (id INTEGER PRIMARY KEY) STRICT;');
    writeFileSync(join(dir, '002-second.sql'), 'CREATE TABLE two (id INTEGER PRIMARY KEY) STRICT;');
    const db = openDatabase(':memory:', readMigrations(dir).slice(0, 1));
    expect(migrate(db, readMigrations(dir))).toEqual({ from: 1, to: 2 });
    expect(tables(db)).toEqual(['one', 'two']);
    db.close();
  });

  it('rolls the whole upgrade back when a step fails', () => {
    const dir = folder();
    writeFileSync(join(dir, '001-fine.sql'), 'CREATE TABLE fine (id INTEGER PRIMARY KEY) STRICT;');
    writeFileSync(join(dir, '002-broken.sql'), 'CREATE TABLE broken (;');
    const file = join(folder(), 'world.sqlite3');
    expect(() => openDatabase(file, readMigrations(dir))).toThrow(/syntax error|incomplete input/);
    const db = openDatabase(file, []);
    expect(schemaVersion(db)).toBe(0);
    expect(tables(db)).toEqual([]);
    db.close();
  });

  it('refuses a database from a newer server', () => {
    const file = join(folder(), 'world.sqlite3');
    openDatabase(file).close();
    expect(() => openDatabase(file, [])).toThrow(/newer than this server/);
  });

  it('refuses badly named or numbered migration files', () => {
    const misnamed = folder();
    writeFileSync(join(misnamed, 'first.sql'), '');
    expect(() => readMigrations(misnamed)).toThrow(/named like/);
    const gap = folder();
    writeFileSync(join(gap, '001-a.sql'), '');
    writeFileSync(join(gap, '003-c.sql'), '');
    expect(() => readMigrations(gap)).toThrow(/number 2/);
  });

  it('removes sessions and progress with their player', () => {
    const db = openDatabase(':memory:');
    const { lastInsertRowid: id } = db.prepare("INSERT INTO players (name, name_key, avatar, created_at) VALUES ('Test', 'test', 'blue', 1)").run();
    db.prepare("INSERT INTO sessions (token_hash, player_id, expires_at, created_at) VALUES (x'00', ?, 2, 1)").run(id);
    db.prepare("INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, 2, '{}', 1)").run(id);
    expect(() => db.prepare("INSERT INTO sessions (token_hash, player_id, expires_at, created_at) VALUES (x'01', 999, 2, 1)").run()).toThrow(/FOREIGN KEY/);
    db.prepare('DELETE FROM players WHERE id = ?').run(id);
    expect(db.prepare('SELECT (SELECT count(*) FROM sessions) AS s, (SELECT count(*) FROM player_progress) AS p').get()).toEqual({ s: 0, p: 0 });
    db.close();
  });

  it('refuses a PIN hash without its salt and progress that is not JSON', () => {
    const db = openDatabase(':memory:');
    expect(() => db.prepare("INSERT INTO players (name, name_key, avatar, pin_hash, created_at) VALUES ('T', 't', 'blue', x'00', 1)").run()).toThrow(/CHECK/);
    const { lastInsertRowid: id } = db.prepare("INSERT INTO players (name, name_key, avatar, created_at) VALUES ('T', 't', 'blue', 1)").run();
    expect(() => db.prepare("INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, 2, 'nope', 1)").run(id)).toThrow(/CHECK/);
    db.close();
  });
});
