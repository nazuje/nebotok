import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

/** The one database file in DATA_DIR. Litestream replicates exactly this file. */
export const DATABASE_FILE = 'nebotok.db';
const MIGRATIONS_DIR = fileURLToPath(new URL('./migrations/', import.meta.url));
const MIGRATION_FILE = /^(\d{3})-[a-z0-9-]+\.sql$/;

export type Migration = { readonly version: number; readonly file: string; readonly sql: string };

/** The numbered SQL files, in order. Versions must run 1, 2, 3 … with no gaps or repeats. */
export function readMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const migrations = readdirSync(dir)
    .filter((file) => file.endsWith('.sql'))
    .toSorted()
    .map((file) => {
      const match = MIGRATION_FILE.exec(file);
      if (!match?.[1]) throw new Error(`migration file ${file} must be named like 001-what-it-does.sql`);
      return { version: Number(match[1]), file, sql: readFileSync(join(dir, file), 'utf8') };
    });
  migrations.forEach((migration, at) => {
    if (migration.version !== at + 1) throw new Error(`migration ${migration.file} should be number ${at + 1}`);
  });
  return migrations;
}

export function schemaVersion(db: DatabaseSync): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/**
 * Brings the database up to the newest migration, all pending steps in one transaction: either the
 * whole upgrade lands or none of it does. Refuses a database from a newer server.
 */
export function migrate(db: DatabaseSync, migrations: readonly Migration[]): { readonly from: number; readonly to: number } {
  const from = schemaVersion(db);
  const to = migrations.length;
  if (from > to) throw new Error(`the database is at schema version ${from}, newer than this server knows (${to})`);
  if (from === to) return { from, to };
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const migration of migrations.slice(from)) {
      db.exec(migration.sql);
      db.exec(`PRAGMA user_version = ${migration.version}`);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { from, to };
}

/**
 * Opens (or creates) the database with the settings every connection needs: write-ahead logging,
 * which Litestream replicates; enforced foreign keys; and a busy timeout, so a moment of contention
 * with Litestream's checkpoints waits instead of failing.
 */
export function openDatabase(file: string, migrations: readonly Migration[] = readMigrations()): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  try {
    migrate(db, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  return db;
}
