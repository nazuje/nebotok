import type { EncounterZone } from './content.ts';
import type { Rng } from './rng.ts';

/** A wild creature that has just appeared: which species, at which level. */
export type WildEncounter = { readonly species: string; readonly level: number };

/**
 * Decides whether a step onto a tile of `zone` meets a wild creature, and which. It always draws
 * one number for the chance (`rng.int(1, 100) <= encounterPercent`); on an encounter it draws one
 * more to pick a creature by weight, in the zone's order, and one for its level.
 */
export function rollEncounter(zone: EncounterZone, rng: Rng): WildEncounter | null {
  if (rng.int(1, 100) > zone.encounterPercent) return null;
  const total = zone.creatures.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng.int(1, total);
  for (const entry of zone.creatures) {
    roll -= entry.weight;
    if (roll <= 0) return { species: entry.species, level: rng.int(entry.minLevel, entry.maxLevel) };
  }
  throw new RangeError(`encounter zone "${zone.id}" has no creatures`);
}
