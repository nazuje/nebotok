import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SAVE_SCHEMAS, SAVE_VERSION, SaveError, createSave, migrateSave, migrations } from '../../src/index.ts';

const SAVES_DIR = fileURLToPath(new URL('../../fixtures/saves/', import.meta.url));
const versionDirs = readdirSync(SAVES_DIR).filter((name) => /^v\d+$/.test(name)).toSorted();
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

  it('gives a v1 player no position, so they start at the spawn', () => {
    const v1 = { v: 1, data: { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z' } };
    expect(migrateSave(v1).data.position).toBeNull();
  });

  it('refuses a position off any sensible map', () => {
    const base = { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z' };
    expect(() => migrateSave({ v: 2, data: { ...base, position: { map: 'post-island', x: -1, y: 0, facing: 'up' } } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 2, data: { ...base, position: { map: 'Post Island', x: 1, y: 0, facing: 'up' } } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 2, data: { ...base, position: { map: 'post-island', x: 1, y: 0, facing: 'north' } } })).toThrow(SaveError);
  });

  it('gives a v2 player no creatures, so they choose a starter on their next visit', () => {
    const v2 = { v: 2, data: { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z', position: null } };
    expect(migrateSave(v2).data).toMatchObject({ team: [], storage: [], inventory: [], lastShrine: null, seen: [], befriended: [] });
  });

  it('refuses a team of more than six, a repeated item or move, and an empty move list', () => {
    const base = { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z', position: null, storage: [], inventory: [], lastShrine: null, seen: [], befriended: [] };
    const creature = { species: 'sun-blob', level: 5, xp: 0, hp: 22, moves: ['sun-tap'] };
    expect(migrateSave({ v: 3, data: { ...base, team: [creature] } }).data.team).toHaveLength(1);
    expect(() => migrateSave({ v: 3, data: { ...base, team: Array.from({ length: 7 }, () => creature) } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 3, data: { ...base, team: [{ ...creature, moves: [] }] } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 3, data: { ...base, team: [{ ...creature, moves: ['sun-tap', 'sun-tap'] }] } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 3, data: { ...base, team: [creature], inventory: [{ item: 'plain-treat', count: 1 }, { item: 'plain-treat', count: 2 }] } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 3, data: { ...base, team: [creature], seen: ['sun-blob', 'sun-blob'] } })).toThrow(SaveError);
    expect(() => migrateSave({ v: 3, data: { ...base, team: [{ ...creature, nickname: '' }] } })).toThrow(SaveError);
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
