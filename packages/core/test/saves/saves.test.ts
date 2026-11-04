import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAVE_SCHEMAS, SAVE_VERSION, SaveError, createSave, migrateSave, migrations } from '../../src/index.ts';

const SAVES_DIR = fileURLToPath(new URL('../../fixtures/saves/', import.meta.url));
const versionDirs = readdirSync(SAVES_DIR).filter((name) => /^v\d+$/.test(name)).sort();
const fixtures = versionDirs.flatMap((dir) =>
  readdirSync(join(SAVES_DIR, dir))
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ label: `${dir}/${name}`, version: Number(dir.slice(1)), path: join(SAVES_DIR, dir, name) })),
);

describe('save migrations', () => {
  it('keeps fixtures, schemas and migrations for every version', () => {
    const versions = Array.from({ length: SAVE_VERSION }, (_, at) => at + 1);
    expect(versionDirs).toEqual(versions.map((version) => `v${version}`));
    expect(Object.keys(SAVE_SCHEMAS).map(Number)).toEqual(versions);
    expect(Object.keys(migrations).map(Number)).toEqual(versions.slice(0, -1));
  });

  it.each(fixtures)('$label upgrades to the latest version and round-trips', ({ path, version }) => {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { v: number };
    expect(raw.v).toBe(version);
    const latest = migrateSave(raw);
    expect(latest.v).toBe(SAVE_VERSION);
    const again = migrateSave(JSON.parse(JSON.stringify(latest)));
    expect(again).toEqual(latest);
    expect(createSave(latest.data)).toEqual(latest);
  });

  it('refuses a save from a newer game', () => {
    expect(() => migrateSave({ v: SAVE_VERSION + 1, data: {} })).toThrow(SaveError);
  });

  it('refuses things that are not saves', () => {
    for (const junk of [null, 'save', 42, {}, { v: 0, data: {} }, { v: 1.5, data: {} }]) {
      expect(() => migrateSave(junk)).toThrow(SaveError);
    }
  });

  it('refuses damaged data', () => {
    expect(() => migrateSave({ v: 1, data: { name: '', language: 'en', createdAt: '2026-01-01T00:00:00Z' } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 1, data: { name: 'A', language: 'de', createdAt: '2026-01-01T00:00:00Z' } })).toThrow(SaveError);
  });
});
