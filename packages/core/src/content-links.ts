import type { BattleContent } from './battle/content.ts';
import type { EncountersFile, ShrinesFile, StartersFile } from './content.ts';
import type { WorldMap } from './map.ts';

/** Every species and weather an encounter zone names must exist. */
export function encounterProblems(encounters: EncountersFile, content: BattleContent): string[] {
  return encounters.zones.flatMap((zone) => [
    ...(zone.weather !== null && !content.weather.has(zone.weather) ? [`encounters.json "${zone.id}": weather "${zone.weather}" is not a weather type`] : []),
    ...zone.creatures.flatMap((entry) => (content.species.has(entry.species) ? [] : [`encounters.json "${zone.id}": "${entry.species}" is not in species.json`])),
  ]);
}

/** The starters exist and are of three different weather types, and every starting item is a treat. */
export function starterProblems(starters: StartersFile, content: BattleContent): string[] {
  const problems: string[] = [];
  const types = new Set<string>();
  for (const id of starters.species) {
    const species = content.species.get(id);
    if (!species) problems.push(`starters.json: "${id}" is not in species.json`);
    else types.add(species.type);
  }
  if (problems.length === 0 && types.size !== starters.species.length) problems.push('starters.json: the starters must be of different weather types');
  for (const { item } of starters.items) if (!content.items.has(item)) problems.push(`starters.json: item "${item}" is not in items.json`);
  return problems;
}

/** Every tall-grass area of a map names a zone in encounters.json, and every shrine a shrine in shrines.json. */
export function mapLinkProblems(map: WorldMap, encounters: EncountersFile, shrines: ShrinesFile): string[] {
  const zones = new Set(encounters.zones.map((zone) => zone.id));
  const known = new Set(shrines.shrines.map((shrine) => shrine.id));
  return [
    ...map.encounterAreas.flatMap((area) => (zones.has(area.zone) ? [] : [`encounter area "${area.zone}" is not a zone in encounters.json`])),
    ...Object.keys(map.shrines).flatMap((id) => (known.has(id) ? [] : [`shrine "${id}" is not in shrines.json`])),
  ];
}
