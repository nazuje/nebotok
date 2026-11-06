import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RenamedFile, loadBattleContent, renameSpecies, type SaveData } from '@nebotok/core';
import { CONTENT_DIR } from './world.ts';

const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

/**
 * Reads content/creatures/renamed.json and the creatures it points at, and returns what turns an
 * old save's species into today's, so a save naming a replaced species still loads and battles.
 */
export function loadRenames(dir: string = CONTENT_DIR): (data: SaveData) => SaveData {
  const renamed = RenamedFile.parse(readJson(dir, 'creatures/renamed.json'));
  const content = loadBattleContent({
    weather: readJson(dir, 'creatures/weather.json'),
    moves: readJson(dir, 'creatures/moves.json'),
    species: readJson(dir, 'creatures/species.json'),
    rules: readJson(dir, 'creatures/battle-rules.json'),
    befriending: readJson(dir, 'creatures/befriending.json'),
    items: readJson(dir, 'items.json'),
  });
  return (data) => renameSpecies(data, renamed, content);
}
