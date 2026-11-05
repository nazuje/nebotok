import { describe, expect, it } from 'vitest';
import { BattleContentError, battleContentProblems, checkContentFile, loadBattleContent } from '../../src/index.ts';
import { battleContent, battleFiles } from '../support/battle-content.ts';

const FILES = {
  'creatures/weather.json': battleFiles.weather,
  'creatures/moves.json': battleFiles.moves,
  'creatures/species.json': battleFiles.species,
  'creatures/battle-rules.json': battleFiles.rules,
  'creatures/befriending.json': battleFiles.befriending,
  'items.json': battleFiles.items,
} as const;

const goodMove = { id: 'test-poke', name: { en: 'Test Poke', sl: 'Testni dregljaj' }, type: 'sun', power: 30, accuracy: 100 };
const goodSpecies = {
  id: 'test-blob',
  name: { en: 'Test Blob', sl: 'Testna kepica' },
  type: 'sun',
  stats: { hp: 50, attack: 50, defense: 50, speed: 50 },
  moves: ['sun-tap', 'sun-wallop', 'sun-call', 'storm-tap'],
};

describe('battle content', () => {
  it.each(Object.entries(FILES))('accepts the real %s', (file, raw) => {
    expect(checkContentFile(file, raw)).toEqual({ ok: true });
  });

  it('links every type, weather and move between the files', () => {
    expect(battleContentProblems(battleFiles)).toEqual([]);
  });

  it('has the six weather types of the design', () => {
    expect([...battleContent.weather.values()].map((type) => type.name.en).toSorted()).toEqual(['Bloom', 'Frost', 'Gale', 'Rain', 'Storm', 'Sun']);
  });

  it('has 6 to 8 placeholder creatures that know four moves each', () => {
    expect(battleContent.species.size).toBeGreaterThanOrEqual(6);
    expect(battleContent.species.size).toBeLessThanOrEqual(8);
    for (const entry of battleContent.species.values()) expect(entry.moves).toHaveLength(4);
  });

  it('writes Slovenian names with Slovenian letters', () => {
    const names = [...battleContent.species.values(), ...battleContent.moves.values(), ...battleContent.weather.values()].map((entry) => entry.name.sl).join(' ');
    expect(names).toMatch(/č/);
    expect(names).toMatch(/ž/);
  });

  it('accepts a good move and a good creature', () => {
    expect(checkContentFile('creatures/moves.json', { moves: [goodMove] })).toEqual({ ok: true });
    expect(checkContentFile('creatures/species.json', { species: [goodSpecies] })).toEqual({ ok: true });
  });

  it('rejects a move with no power that calls no weather', () => {
    expect(checkContentFile('creatures/moves.json', { moves: [{ ...goodMove, power: 0 }] }).ok).toBe(false);
  });

  it('rejects a creature without exactly four different moves', () => {
    expect(checkContentFile('creatures/species.json', { species: [{ ...goodSpecies, moves: ['sun-tap', 'sun-wallop', 'sun-call'] }] }).ok).toBe(false);
    expect(checkContentFile('creatures/species.json', { species: [{ ...goodSpecies, moves: ['sun-tap', 'sun-tap', 'sun-call', 'storm-tap'] }] }).ok).toBe(false);
  });

  it('rejects a name without Slovenian', () => {
    expect(checkContentFile('creatures/species.json', { species: [{ ...goodSpecies, name: { en: 'Test Blob' } }] }).ok).toBe(false);
  });

  it('rejects a weather chart that names an unknown type or is both strong and weak', () => {
    const [sun, ...rest] = battleFiles.weather.types;
    const unknown = { types: [{ ...sun, strongAgainst: ['lava'] }, ...rest] };
    const both = { types: [{ ...sun, weakAgainst: [...(sun?.weakAgainst ?? []), 'frost'] }, ...rest] };
    expect(checkContentFile('creatures/weather.json', unknown).ok).toBe(false);
    expect(checkContentFile('creatures/weather.json', both).ok).toBe(false);
  });

  it('rejects repeated ids', () => {
    expect(checkContentFile('creatures/moves.json', { moves: [goodMove, goodMove] }).ok).toBe(false);
  });

  it('reports a creature that knows a move no file has', () => {
    const species = { species: [{ ...goodSpecies, moves: ['sun-tap', 'sun-wallop', 'sun-call', 'moon-tap'] }] };
    expect(battleContentProblems({ ...battleFiles, species })).toEqual(['species.json "test-blob": knows "moon-tap", which is not in moves.json']);
    expect(() => loadBattleContent({ ...battleFiles, species })).toThrow(BattleContentError);
  });

  it('reports a favourite treat or a treat liking that names nothing real', () => {
    const species = { species: [{ ...goodSpecies, favouriteTreat: 'moon-treat' }] };
    expect(battleContentProblems({ ...battleFiles, species })).toEqual(['species.json "test-blob": favouriteTreat "moon-treat" is not a treat in items.json']);
    const [plain, ...rest] = battleFiles.items.items;
    const items = { items: [{ ...plain!, likedBy: { species: ['moon-blob'], types: ['lava'] } }, ...rest] };
    expect(battleContentProblems({ ...battleFiles, items })).toHaveLength(2);
  });

  it('rejects befriending rules where a liked treat beats a favourite, or the bounds cross', () => {
    const rules = battleFiles.befriending;
    expect(checkContentFile('creatures/befriending.json', { ...rules, likedPercent: rules.favouritePercent + 1 }).ok).toBe(false);
    expect(checkContentFile('creatures/befriending.json', { ...rules, minPercent: 90, maxPercent: 80 }).ok).toBe(false);
    expect(checkContentFile('creatures/befriending.json', { ...rules, windowPercent: 0 }).ok).toBe(false);
  });

  it('rejects an item of an unknown kind or with a repeated id', () => {
    const [plain] = battleFiles.items.items;
    expect(checkContentFile('items.json', { items: [{ ...plain, kind: 'hat' }] }).ok).toBe(false);
    expect(checkContentFile('items.json', { items: [plain, plain] }).ok).toBe(false);
  });

  it('reports a creature with only weather moves', () => {
    const species = { species: [{ ...goodSpecies, type: 'rain', moves: ['sun-call', 'rain-call', 'gale-call', 'frost-call'] }] };
    expect(battleContentProblems({ ...battleFiles, species })).toEqual(['species.json "test-blob": knows no move that does damage']);
  });
});
