import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDatabase } from '../src/check-database.ts';
import { openDatabase, readMigrations } from '../src/db.ts';

const folders: string[] = [];
function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), 'nebotok-check-'));
  folders.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('checking a database before a restore', () => {
  it('counts the profiles in a sound database and leaves it unmigrated', () => {
    const file = join(folder(), 'nebotok.db');
    const db = openDatabase(file);
    db.prepare("INSERT INTO players (name, name_key, avatar, created_at) VALUES ('Čmrljček Šumež', 'čmrljček šumež', 'blue', 1)").run();
    db.close();
    expect(checkDatabase(file)).toEqual({ ok: true, schemaVersion: readMigrations().length, profiles: 1 });
  });

  it('refuses a file that is not a database, an empty one and a missing one', () => {
    const dir = folder();
    writeFileSync(join(dir, 'junk'), 'this is not SQLite at all, just some words in a file');
    expect(checkDatabase(join(dir, 'junk'))).toEqual({ ok: false, problem: expect.stringMatching(/not a database/) });
    new DatabaseSync(join(dir, 'empty')).close();
    expect(checkDatabase(join(dir, 'empty'))).toEqual({ ok: false, problem: 'it holds no game data' });
    expect(checkDatabase(join(dir, 'missing'))).toEqual({ ok: false, problem: expect.stringMatching(/cannot open it/) });
  });

  it('refuses a database from a newer server', () => {
    const file = join(folder(), 'nebotok.db');
    openDatabase(file).close();
    expect(checkDatabase(file, 0)).toEqual({ ok: false, problem: expect.stringMatching(/newer server/) });
  });
});
