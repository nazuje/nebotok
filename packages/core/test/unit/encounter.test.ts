import { describe, expect, it } from 'vitest';
import encounters from '../../../../content/encounters.json' with { type: 'json' };
import { EncountersFile, createRng, encounterProblems, rollEncounter, type EncounterZone } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

const zone: EncounterZone = {
  id: 'test-grass',
  encounterPercent: 25,
  weather: null,
  creatures: [
    { species: 'glowbun', minLevel: 2, maxLevel: 4, weight: 3 },
    { species: 'puddlepip', minLevel: 7, maxLevel: 7, weight: 1 },
  ],
};

function thirtySteps(seed: number) {
  const rng = createRng(seed);
  return Array.from({ length: 30 }, () => rollEncounter(zone, rng));
}

describe('wild encounters', () => {
  it('meets a creature on about the zone\'s share of steps, in its weights and levels', () => {
    const rng = createRng('steps');
    const met = Array.from({ length: 4_000 }, () => rollEncounter(zone, rng)).filter((wild) => wild !== null);
    expect(met.length).toBeGreaterThan(4_000 * 0.2);
    expect(met.length).toBeLessThan(4_000 * 0.3);
    const rain = met.filter((wild) => wild.species === 'puddlepip');
    expect(rain.length).toBeGreaterThan(met.length * 0.18);
    expect(rain.length).toBeLessThan(met.length * 0.32);
    expect(rain.every((wild) => wild.level === 7)).toBe(true);
    expect(new Set(met.filter((wild) => wild.species === 'glowbun').map((wild) => wild.level))).toEqual(new Set([2, 3, 4]));
  });

  it('meets one every step at 100 percent', () => {
    const rng = createRng(3);
    for (let step = 0; step < 50; step += 1) expect(rollEncounter({ ...zone, encounterPercent: 100 }, rng)).not.toBeNull();
  });

  it('rolls the same creatures from the same seed', () => {
    expect(thirtySteps(9)).toEqual(thirtySteps(9));
  });

  it('names only real creatures and weather in the real zones', () => {
    expect(encounterProblems(EncountersFile.parse(encounters), battleContent)).toEqual([]);
    const broken = { zones: [{ ...zone, weather: 'fog', creatures: [{ ...zone.creatures[0]!, species: 'moon-blob' }] }] };
    expect(encounterProblems(broken, battleContent)).toEqual(['encounters.json "test-grass": weather "fog" is not a weather type', 'encounters.json "test-grass": "moon-blob" is not in species.json']);
  });
});
