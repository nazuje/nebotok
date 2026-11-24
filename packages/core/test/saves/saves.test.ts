import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import renamed from '../../../../content/creatures/renamed.json' with { type: 'json' };
import {
  MAX_ACTIVE_QUESTS,
  RenamedFile,
  SAVE_SCHEMAS,
  SAVE_VERSION,
  SaveError,
  createSave,
  isRepaired,
  jobReady,
  knowableMoves,
  maxHpOf,
  migrateSave,
  migrations,
  pruneJobs,
  pruneSkills,
  pruneStory,
  renameSpecies,
  sanitizeProgress,
} from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';
import { storyContent } from '../support/story-content.ts';

const SAVES_DIR = fileURLToPath(new URL('../../fixtures/saves/', import.meta.url));
const versionDirs = readdirSync(SAVES_DIR).filter((name) => /^v\d+$/.test(name)).toSorted();
const fixtures = versionDirs.flatMap((dir) =>
  readdirSync(join(SAVES_DIR, dir))
    .filter((name) => name.endsWith('.json'))
    .map((name) => ({ label: `${dir}/${name}`, version: Number(dir.slice(1)), path: join(SAVES_DIR, dir, name) })),
);

/** Upgrades with today's creature content, as the server's progress store does. */
const migrate = (raw: unknown) => migrateSave(raw, battleContent);
const fixture = (dir: string, name: string): unknown => JSON.parse(readFileSync(join(SAVES_DIR, dir, name), 'utf8'));

/**
 * What the server does to every save it loads (apps/server/src/renamed.ts): today's species for
 * renamed ones, then the check against content, then the story pruned to today's quests and flags.
 */
function loaded(path: string) {
  const { progress, repairs } = sanitizeProgress(renameSpecies(migrate(JSON.parse(readFileSync(path, 'utf8'))).data, RenamedFile.parse(renamed), battleContent), battleContent);
  const skills = storyContent.skills!;
  return { progress: { ...progress, story: pruneStory(progress.story, storyContent), skills: pruneSkills(progress.skills, skills).skills, jobs: pruneJobs(progress.jobs, storyContent).jobs }, repairs };
}

const loadedV6 = (name: string) => loaded(join(SAVES_DIR, 'v6', name)).progress;

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
    const latest = migrate(raw);
    expect(latest.v).toBe(SAVE_VERSION);
    const again = migrate(JSON.parse(JSON.stringify(latest)));
    expect(again).toEqual(latest);
    expect(createSave(latest.data)).toEqual(latest);
  });

  it.each(fixtures)('$label names only creatures, moves and items that exist once loaded', ({ path }) => {
    const { progress: data } = loaded(path);
    expect(createSave(data).data).toEqual(data);
    const creatures = [...data.team, ...data.storage];
    const species = [...data.seen, ...data.befriended, ...creatures.map((creature) => creature.species)];
    expect(species.filter((id) => !battleContent.species.has(id))).toEqual([]);
    expect(creatures.filter((creature) => !creature.moves.every((id) => knowableMoves(battleContent.species.get(creature.species)!, battleContent).has(id)))).toEqual([]);
    expect(creatures.filter((creature) => creature.hp > maxHpOf(creature, battleContent))).toEqual([]);
    expect(data.inventory.filter((entry) => !battleContent.items.has(entry.item))).toEqual([]);
  });

  it('drops the creatures, moves and items of a save that content no longer has, and keeps the rest', () => {
    const { progress: data, repairs } = loaded(join(SAVES_DIR, 'v3', 'unknown-species.json'));
    expect(repairs).toEqual({
      droppedCreatures: ['gone-species', 'old-cloud'],
      droppedItems: ['gone-treat'],
      replacedMoves: ['gone-move', 'drip-drop'],
      clamped: 1,
      repairedLoadouts: 0,
      forgottenSpecies: ['gone-species', 'old-cloud'],
      refilledTeam: false,
    });
    expect(data).toMatchObject({
      name: 'Test Courier',
      team: [{ species: 'glowbun', level: 7, xp: 10, hp: maxHpOf({ species: 'glowbun', level: 7 }, battleContent), moves: ['sun-ray', 'heat-shimmer', 'storm-tap'], nickname: 'Žarek' }],
      storage: [],
      inventory: [{ item: 'plain-treat', count: 2 }],
      lastShrine: { map: 'post-island', shrine: 'post-shrine' },
      seen: ['glowbun'],
      befriended: ['glowbun'],
    });
  });

  it('keeps the story through the repair and drops only the quests and flags the story no longer has', () => {
    const path = join(SAVES_DIR, 'v4', 'old-content.json');
    const raw = migrate(JSON.parse(readFileSync(path, 'utf8'))).data;
    const repaired = sanitizeProgress(raw, battleContent);
    expect(repaired.repairs).toMatchObject({ droppedCreatures: ['gone-species'], droppedItems: ['gone-treat'] });
    expect(repaired.progress.story).toEqual(raw.story);
    const { progress: data } = loaded(path);
    expect(data.story).toEqual({ active: [{ quest: 'first-round', step: 0, count: 0 }], done: [], flags: [] });
    expect(data.inventory).toEqual([{ item: 'hello-note', count: 1 }]);
    expect(data.team.map((creature) => creature.species)).toEqual(['glowbun']);
    expect(createSave(data).data).toEqual(data);
  });

  it('gives a v4 player no skills and an unopened board', () => {
    const data = migrate(JSON.parse(readFileSync(join(SAVES_DIR, 'v4', 'basic.json'), 'utf8'))).data;
    expect(data).toMatchObject({ skills: [], jobs: null });
  });

  it('keeps v5 skills and the board through the repair, with a delivery still ready to hand over', () => {
    const { progress: basic } = loaded(join(SAVES_DIR, 'v5', 'basic.json'));
    expect(basic.skills).toEqual([{ skill: 'foraging', level: 3, xp: 20 }, { skill: 'cooking', level: 2, xp: 5 }]);
    expect(basic.jobs?.board).toHaveLength(3);
    const { progress: ready } = loaded(join(SAVES_DIR, 'v5', 'delivery-ready.json'));
    const delivery = ready.jobs?.board.find((job) => job.to !== null);
    expect(delivery && jobReady(ready, delivery.to!)).toBe(true);
    const { progress: top } = loaded(join(SAVES_DIR, 'v5', 'max-level.json'));
    expect(top.skills[0]).toEqual({ skill: 'cooking', level: storyContent.skills!.maxLevel, xp: 0 });
  });

  it('gives a v5 player "Read to me" off, and keeps a v6 player\'s setting with the turtle setting off', () => {
    const old = migrate(fixture('v5', 'slovenian-name.json')).data;
    expect(old.settings).toEqual({ readToMe: false, turtle: false, sounds: true });
    const v6 = fixture('v6', 'slovenian-name.json') as { v: 6; data: Record<string, unknown> };
    expect(migrate(v6).data).toMatchObject({ name: 'Čmrljček Šumež', settings: { readToMe: true, turtle: false, sounds: true } });
    for (const settings of [{ readToMe: 'yes' }, { readToMe: true, loud: true }, {}]) {
      expect(() => migrate({ v: 6, data: { ...v6.data, settings } })).toThrow(SaveError);
    }
    const { settings: _missing, ...unset } = v6.data;
    expect(() => migrate({ v: 6, data: unset })).toThrow(SaveError);
  });

  it('puts the default loadout on a v6 player\'s creatures: on each button unlocked at their level, the first learned move of its kind', () => {
    expect(loadedV6('starter-level-5.json').team.map((creature) => creature.loadout)).toEqual([['heat-shimmer', null, null]]);
    // Puddle Jump was forgotten for Rain Tap, but it is still learned, so it goes on the special button.
    expect(loadedV6('forgot-a-move.json').team.map((creature) => creature.loadout)).toEqual([['drip-drop', 'puddle-jump', 'rain-call']]);
    const full = loadedV6('full-team-and-storage.json');
    expect(full.team.map((creature) => creature.loadout)).toEqual([
      ['heat-shimmer', 'sun-ray', 'sun-call'],
      ['sun-tap', null, null],
      ['sun-tap', 'sun-ray', null],
      ['gale-tap', 'twirl', 'gale-call'],
      ['storm-tap', 'cloud-clap', 'storm-call'],
      ['snow-puff', null, null],
    ]);
    expect(full.storage.map((creature) => [creature.species, creature.loadout])).toEqual([
      ['glowbun', ['heat-shimmer', 'sun-ray', null]],
      ['bloomlet', ['petal-toss', 'vine-tickle', 'bloom-call']],
      ['rimemoth', ['frost-tap', 'icicle-poke', null]],
    ]);
    for (const name of ['starter-level-5.json', 'forgot-a-move.json', 'full-team-and-storage.json']) {
      expect(migrate(fixture('v6', name)).data.settings.turtle).toBe(false);
    }
  });

  it('keeps a v7 player\'s loadouts and turtle setting, and refuses a loadout that is not three buttons', () => {
    const { progress, repairs } = loaded(join(SAVES_DIR, 'v7', 'slovenian-name.json'));
    expect(repairs.repairedLoadouts).toBe(0);
    expect(progress.team.map((creature) => creature.loadout)).toEqual([['rain-tap', null, 'rain-call'], ['static-zap', 'cloud-clap', null]]);
    const v7 = fixture('v7', 'slovenian-name.json') as { v: 7; data: { team: Record<string, unknown>[]; settings: unknown } };
    expect(migrate(v7).data.settings).toEqual({ readToMe: true, turtle: true, sounds: true });
    const [first] = v7.data.team;
    for (const loadout of [['rain-tap', null], ['rain-tap', null, null, null], ['Rain Tap', null, null], undefined]) {
      expect(() => migrate({ v: 7, data: { ...v7.data, team: [{ ...first, loadout }] } })).toThrow(SaveError);
    }
    expect(() => migrate({ v: 7, data: { ...v7.data, settings: { readToMe: true } } })).toThrow(SaveError);
  });

  it('turns sounds on for a v7 player, keeps a v8 player\'s choice, and refuses settings without it', () => {
    for (const name of ['basic.json', 'slovenian-name.json']) expect(migrate(fixture('v7', name)).data.settings.sounds).toBe(true);
    const v8 = fixture('v8', 'slovenian-name.json') as { v: 8; data: Record<string, unknown> };
    expect(migrate(v8).data).toMatchObject({ name: 'Žvižgač Čopek', settings: { readToMe: true, turtle: false, sounds: false } });
    for (const settings of [{ readToMe: true, turtle: false }, { readToMe: true, turtle: false, sounds: 'off' }, { readToMe: true, turtle: false, sounds: false, music: true }]) {
      expect(() => migrate({ v: 8, data: { ...v8.data, settings } })).toThrow(SaveError);
    }
  });

  it('replaces a loaded loadout move that is not learned, of the wrong kind or on a locked button with the default', () => {
    const v7 = fixture('v7', 'basic.json') as { v: 7; data: { team: Record<string, unknown>[] } };
    const [glowbun, pinwhirl] = v7.data.team;
    const team = [
      { ...glowbun, loadout: ['noon-blaze', 'sun-wallop', 'sun-call'] },
      { ...pinwhirl, loadout: ['twirl', 'gale-tap', 'sky-sweep'] },
    ];
    const { progress, repairs } = sanitizeProgress(migrate({ v: 7, data: { ...v7.data, team } }).data, battleContent);
    expect(repairs.repairedLoadouts).toBe(2);
    expect(isRepaired(repairs)).toBe(true);
    expect(progress.team.map((creature) => creature.loadout)).toEqual([
      ['heat-shimmer', 'sun-wallop', 'sun-call'],
      ['gust-push', 'twirl', null],
    ]);
  });
  it('refuses a skill twice, a job past its count, a repeated job and a job never drawn', () => {
    const { data } = fixture('v5', 'basic.json') as { data: { skills: unknown[]; jobs: { board: { count: number; progress: number }[] } } };
    const jobs = data.jobs!;
    const [first] = jobs.board;
    for (const bad of [
      { skills: [...data.skills, data.skills[0]] },
      { skills: [{ skill: 'cooking', level: 100, xp: 0 }] },
      { jobs: { ...jobs, board: [{ ...first!, progress: first!.count + 1 }] } },
      { jobs: { ...jobs, board: [first, first] } },
      { jobs: { ...jobs, drawn: 0 } },
      { jobs: { ...jobs, board: Array.from({ length: 6 }, (_, at) => ({ ...first!, job: at + 1 })), drawn: 6 } },
    ]) {
      expect(() => migrate({ v: 5, data: { ...data, ...bad } })).toThrow(SaveError);
    }
  });

  it('gives a v1 player no position, so they start at the spawn', () => {
    const v1 = { v: 1, data: { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z' } };
    expect(migrate(v1).data.position).toBeNull();
  });

  it('refuses a position off any sensible map', () => {
    const base = { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z' };
    expect(() => migrate({ v: 2, data: { ...base, position: { map: 'post-island', x: -1, y: 0, facing: 'up' } } })).toThrow(SaveError);
    expect(() => migrate({ v: 2, data: { ...base, position: { map: 'Post Island', x: 1, y: 0, facing: 'up' } } })).toThrow(SaveError);
    expect(() => migrate({ v: 2, data: { ...base, position: { map: 'post-island', x: 1, y: 0, facing: 'north' } } })).toThrow(SaveError);
  });

  it('gives a v2 player no creatures, so they choose a starter on their next visit', () => {
    const v2 = { v: 2, data: { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z', position: null } };
    expect(migrate(v2).data).toMatchObject({ team: [], storage: [], inventory: [], lastShrine: null, seen: [], befriended: [] });
  });

  it('refuses a team of more than six, a repeated item or move, and an empty move list', () => {
    const base = { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z', position: null, storage: [], inventory: [], lastShrine: null, seen: [], befriended: [] };
    const creature = { species: 'sun-blob', level: 5, xp: 0, hp: 22, moves: ['sun-tap'] };
    expect(migrate({ v: 3, data: { ...base, team: [creature] } }).data.team).toHaveLength(1);
    expect(() => migrate({ v: 3, data: { ...base, team: Array.from({ length: 7 }, () => creature) } })).toThrow(SaveError);
    expect(() => migrate({ v: 3, data: { ...base, team: [{ ...creature, moves: [] }] } })).toThrow(SaveError);
    expect(() => migrate({ v: 3, data: { ...base, team: [{ ...creature, moves: ['sun-tap', 'sun-tap'] }] } })).toThrow(SaveError);
    expect(() => migrate({ v: 3, data: { ...base, team: [creature], inventory: [{ item: 'plain-treat', count: 1 }, { item: 'plain-treat', count: 2 }] } })).toThrow(SaveError);
    expect(() => migrate({ v: 3, data: { ...base, team: [creature], seen: ['sun-blob', 'sun-blob'] } })).toThrow(SaveError);
    expect(() => migrate({ v: 3, data: { ...base, team: [{ ...creature, nickname: '' }] } })).toThrow(SaveError);
  });

  it('refuses a save from a newer game', () => {
    expect(() => migrate({ v: SAVE_VERSION + 1, data: {} })).toThrow(SaveError);
  });

  it('refuses things that are not saves', () => {
    for (const junk of [null, 'save', 42, {}, { v: 0, data: {} }, { v: 1.5, data: {} }]) {
      expect(() => migrate(junk)).toThrow(SaveError);
    }
  });

  it('refuses damaged data', () => {
    expect(() => migrate({ v: 1, data: { name: '', language: 'en', createdAt: '2026-01-01T00:00:00Z' } })).toThrow(SaveError);
    expect(() => migrate({ v: 1, data: { name: 'A', language: 'de', createdAt: '2026-01-01T00:00:00Z' } })).toThrow(SaveError);
  });
});

const active = (quest: string, step = 0, count = 0) => ({ quest, step, count });

describe('the story in a save', () => {
  const base = { name: 'Test Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z', position: null, team: [], storage: [], inventory: [], lastShrine: null, seen: [], befriended: [] };
  const withStory = (story: unknown) => ({ v: 4, data: { ...base, story } });

  it('gives a v3 player an empty story, so the story starts for them as for a new player', () => {
    expect(migrate({ v: 3, data: base }).data.story).toEqual({ active: [], done: [], flags: [] });
  });

  it('refuses a quest twice, a quest both active and done, a repeated flag, and numbers out of range', () => {
    expect(migrate(withStory({ active: [active('first-round')], done: ['old-round'], flags: ['met-bavko'] })).data.story.active).toHaveLength(1);
    for (const story of [
      { active: [active('first-round'), active('first-round', 1)], done: [], flags: [] },
      { active: [active('first-round')], done: ['first-round'], flags: [] },
      { active: [], done: ['first-round', 'first-round'], flags: [] },
      { active: [], done: [], flags: ['met-bavko', 'met-bavko'] },
      { active: [active('first-round', 50)], done: [], flags: [] },
      { active: [active('first-round', 0, 1000)], done: [], flags: [] },
      { active: Array.from({ length: MAX_ACTIVE_QUESTS + 1 }, (_, at) => active(`quest-${at}`)), done: [], flags: [] },
      { active: [active('First Round')], done: [], flags: [] },
      { active: [], done: [] },
    ]) {
      expect(() => migrate(withStory(story))).toThrow(SaveError);
    }
  });

  it.each(fixtures)('$label keeps a valid save once its story is pruned to the real content', ({ path }) => {
    const data = migrate(JSON.parse(readFileSync(path, 'utf8'))).data;
    const story = pruneStory(data.story, storyContent);
    expect(createSave({ ...data, story }).data.story).toEqual(story);
    expect(story.active.every((entry) => storyContent.quests.has(entry.quest))).toBe(true);
  });
});
