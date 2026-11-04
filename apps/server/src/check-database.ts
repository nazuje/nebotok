import { DatabaseSync } from 'node:sqlite';
import { readMigrations, schemaVersion } from './db.ts';

export type DatabaseCheck =
  | { readonly ok: true; readonly schemaVersion: number; readonly profiles: number }
  | { readonly ok: false; readonly problem: string };

/**
 * Checks a database file before scripts/restore.sh swaps it in: SQLite's full integrity check, a
 * schema this server knows, and a players table to count. Opened read-only and never migrated, so
 * the file stays exactly as it was. Reports counts only, never names.
 */
export function checkDatabase(file: string, newestVersion: number = readMigrations().length): DatabaseCheck {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(file, { readOnly: true });
  } catch (error) {
    return { ok: false, problem: `cannot open it: ${(error as Error).message}` };
  }
  try {
    const { integrity_check: integrity } = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (integrity !== 'ok') return { ok: false, problem: `the integrity check failed: ${integrity}` };
    const version = schemaVersion(db);
    if (version < 1) return { ok: false, problem: 'it holds no game data' };
    if (version > newestVersion) return { ok: false, problem: `it is from a newer server (schema version ${version}, this one knows ${newestVersion})` };
    const { profiles } = db.prepare('SELECT count(*) AS profiles FROM players').get() as { profiles: number };
    return { ok: true, schemaVersion: version, profiles };
  } catch (error) {
    return { ok: false, problem: (error as Error).message };
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const file = process.argv[2];
  const result = file ? checkDatabase(file) : { ok: false as const, problem: 'usage: node apps/server/src/check-database.ts <file>' };
  if (result.ok) {
    process.stdout.write(`${result.profiles} profile(s), save schema version ${result.schemaVersion}\n`);
  } else {
    process.stderr.write(`${result.problem}\n`);
    process.exitCode = 1;
  }
}
