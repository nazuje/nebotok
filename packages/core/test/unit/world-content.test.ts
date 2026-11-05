import { describe, expect, it } from 'vitest';
import encounters from '../../../../content/encounters.json' with { type: 'json' };
import shrines from '../../../../content/shrines.json' with { type: 'json' };
import starters from '../../../../content/starters.json' with { type: 'json' };
import { checkContentFile } from '../../src/index.ts';

const zone = { id: 'test-grass', encounterPercent: 10, weather: null, creatures: [{ species: 'sun-blob', minLevel: 2, maxLevel: 4, weight: 1 }] };

describe('world content', () => {
  it.each([
    ['encounters.json', encounters],
    ['shrines.json', shrines],
    ['starters.json', starters],
  ])('accepts the real %s', (file, raw) => {
    expect(checkContentFile(file, raw)).toEqual({ ok: true });
  });

  it('rejects an encounter zone with no creatures, crossed levels, no chance or a repeated id', () => {
    expect(checkContentFile('encounters.json', { zones: [zone] })).toEqual({ ok: true });
    expect(checkContentFile('encounters.json', { zones: [{ ...zone, creatures: [] }] }).ok).toBe(false);
    expect(checkContentFile('encounters.json', { zones: [{ ...zone, creatures: [{ ...zone.creatures[0], minLevel: 5 }] }] }).ok).toBe(false);
    expect(checkContentFile('encounters.json', { zones: [{ ...zone, encounterPercent: 0 }] }).ok).toBe(false);
    expect(checkContentFile('encounters.json', { zones: [zone, zone] }).ok).toBe(false);
  });

  it('rejects a shrine without Slovenian and fainting rules out of range', () => {
    const [shrine] = shrines.shrines;
    expect(checkContentFile('shrines.json', { ...shrines, shrines: [{ ...shrine, name: { en: 'Shrine' } }] }).ok).toBe(false);
    expect(checkContentFile('shrines.json', { ...shrines, teamFainted: { healTeam: true, itemsKeptPercent: 101 } }).ok).toBe(false);
  });

  it('rejects starters that are not three different creatures', () => {
    expect(checkContentFile('starters.json', { ...starters, species: ['sun-blob', 'rain-blob'] }).ok).toBe(false);
    expect(checkContentFile('starters.json', { ...starters, species: ['sun-blob', 'sun-blob', 'rain-blob'] }).ok).toBe(false);
  });
});
