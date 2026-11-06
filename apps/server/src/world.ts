import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AvatarsFile,
  EncountersFile,
  ShrinesFile,
  StartersFile,
  WorldSettings,
  encounterProblems,
  loadBattleContent,
  mapLinkProblems,
  playabilityProblems,
  readTiledMap,
  starterProblems,
  stepDurationMs,
  type BattleContent,
  type EncounterZone,
  type WorldMap,
} from '@nebotok/core';

/** The repository's content/ folder; the image keeps the same layout under /app. */
export const CONTENT_DIR = fileURLToPath(new URL('../../../content/', import.meta.url));

/** What the server needs from content/ to run the world. */
export type WorldContent = {
  readonly map: WorldMap;
  readonly stepMs: number;
  readonly avatars: ReadonlySet<string>;
  /** Creatures, moves, weather, battle and befriending rules, and items. */
  readonly battle: BattleContent;
  /** Encounter zones by id: what lives in each patch of tall grass. */
  readonly encounters: ReadonlyMap<string, EncounterZone>;
  readonly shrines: ShrinesFile;
  readonly starters: StartersFile;
};

const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

function battleContentOf(dir: string): BattleContent {
  return loadBattleContent({
    weather: readJson(dir, 'creatures/weather.json'),
    moves: readJson(dir, 'creatures/moves.json'),
    species: readJson(dir, 'creatures/species.json'),
    rules: readJson(dir, 'creatures/battle-rules.json'),
    befriending: readJson(dir, 'creatures/befriending.json'),
    items: readJson(dir, 'items.json'),
  });
}

/** Reads and checks the start map, walk speed, avatars and everything battles need. Throws on anything content:validate would refuse. */
export function loadWorld(dir: string = CONTENT_DIR): WorldContent {
  const settings = WorldSettings.parse(readJson(dir, 'world.json'));
  const avatars = AvatarsFile.parse(readJson(dir, 'avatars.json'));
  const result = readTiledMap(settings.startMap, readJson(dir, `maps/${settings.startMap}.tmj`));
  if (!result.ok) throw new Error(`map ${settings.startMap}: ${result.problems.join('; ')}`);
  const battle = battleContentOf(dir);
  const encounters = EncountersFile.parse(readJson(dir, 'encounters.json'));
  const shrines = ShrinesFile.parse(readJson(dir, 'shrines.json'));
  const starters = StartersFile.parse(readJson(dir, 'starters.json'));
  const problems = [
    ...playabilityProblems(result.map),
    ...mapLinkProblems(result.map, encounters, shrines),
    ...encounterProblems(encounters, battle),
    ...starterProblems(starters, battle),
  ];
  if (problems.length > 0) throw new Error(`content for map ${settings.startMap}: ${problems.join('; ')}`);
  return {
    map: result.map,
    stepMs: stepDurationMs(settings.walkTilesPerSecond),
    avatars: new Set(avatars.avatars.map((avatar) => avatar.id)),
    battle,
    encounters: new Map(encounters.zones.map((zone) => [zone.id, zone])),
    shrines,
    starters,
  };
}
