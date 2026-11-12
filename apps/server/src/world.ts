import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AvatarsFile,
  DIALOGUE_FILE,
  EncountersFile,
  ShrinesFile,
  StartersFile,
  WorldSettings,
  encounterProblems,
  loadBattleContent,
  loadStoryContent,
  mapLinkProblems,
  playabilityProblems,
  readTiledMap,
  starterProblems,
  stepDurationMs,
  storyMapProblems,
  type BattleContent,
  type EncounterZone,
  type StoryContent,
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
  /** The characters, their dialogue, the quests, the chapters and the bag's stacks. */
  readonly story: StoryContent;
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

function storyContentOf(dir: string, battle: BattleContent): StoryContent {
  const dialogue: Record<string, unknown> = {};
  for (const file of readdirSync(join(dir, 'dialogue')).toSorted()) {
    const npc = DIALOGUE_FILE.exec(`dialogue/${file}`)?.[1];
    if (npc !== undefined) dialogue[npc] = readJson(dir, `dialogue/${file}`);
  }
  return loadStoryContent(
    {
      npcs: readJson(dir, 'npcs.json'), dialogue, quests: readJson(dir, 'quests.json'), story: readJson(dir, 'story.json'), inventory: readJson(dir, 'inventory.json'),
      skills: {
        skills: readJson(dir, 'skills.json'),
        spots: readJson(dir, 'spots.json'),
        recipes: readJson(dir, 'recipes.json'),
        stations: readJson(dir, 'stations.json'),
        jobs: readJson(dir, 'jobs.json'),
      },
    },
    battle,
  );
}

/** Reads and checks the start map, walk speed, avatars, everything battles need and the story. Throws on anything content:validate would refuse. */
export function loadWorld(dir: string = CONTENT_DIR): WorldContent {
  const settings = WorldSettings.parse(readJson(dir, 'world.json'));
  const avatars = AvatarsFile.parse(readJson(dir, 'avatars.json'));
  const result = readTiledMap(settings.startMap, readJson(dir, `maps/${settings.startMap}.tmj`));
  if (!result.ok) throw new Error(`map ${settings.startMap}: ${result.problems.join('; ')}`);
  const battle = battleContentOf(dir);
  const encounters = EncountersFile.parse(readJson(dir, 'encounters.json'));
  const shrines = ShrinesFile.parse(readJson(dir, 'shrines.json'));
  const starters = StartersFile.parse(readJson(dir, 'starters.json'));
  const story = storyContentOf(dir, battle);
  const problems = [
    ...playabilityProblems(result.map),
    ...mapLinkProblems(result.map, encounters, shrines),
    ...encounterProblems(encounters, battle),
    ...starterProblems(starters, battle),
    ...storyMapProblems(story, { maps: [result.map], zones: encounters.zones.map((zone) => zone.id), shrines: shrines.shrines.map((shrine) => shrine.id) }),
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
    story,
  };
}
