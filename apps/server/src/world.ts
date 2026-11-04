import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AvatarsFile, WorldSettings, playabilityProblems, readTiledMap, stepDurationMs, type WorldMap } from '@nebotok/core';

/** The repository's content/ folder; the image keeps the same layout under /app. */
export const CONTENT_DIR = fileURLToPath(new URL('../../../content/', import.meta.url));

/** What the server needs from content/ to run the world. */
export type WorldContent = {
  readonly map: WorldMap;
  readonly stepMs: number;
  readonly avatars: ReadonlySet<string>;
};

const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

/** Reads and checks the start map, walk speed and avatars. Throws on anything content:validate would refuse. */
export function loadWorld(dir: string = CONTENT_DIR): WorldContent {
  const settings = WorldSettings.parse(readJson(dir, 'world.json'));
  const avatars = AvatarsFile.parse(readJson(dir, 'avatars.json'));
  const result = readTiledMap(settings.startMap, readJson(dir, `maps/${settings.startMap}.tmj`));
  if (!result.ok) throw new Error(`map ${settings.startMap}: ${result.problems.join('; ')}`);
  const problems = playabilityProblems(result.map);
  if (problems.length > 0) throw new Error(`map ${settings.startMap}: ${problems.join('; ')}`);
  return {
    map: result.map,
    stepMs: stepDurationMs(settings.walkTilesPerSecond),
    avatars: new Set(avatars.avatars.map((avatar) => avatar.id)),
  };
}
