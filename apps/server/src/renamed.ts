import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RenamedFile, isRepaired, loadBattleContent, renameSpecies, sanitizeProgress, type SaveData } from '@nebotok/core';
import type { Log } from './log.ts';
import { CONTENT_DIR } from './world.ts';

const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

/** Turns a loaded save's data into data today's content can play. */
export type SaveRepair = (playerId: number, data: SaveData) => SaveData;

/**
 * Reads content/creatures/renamed.json and the creatures and items it is checked against, and
 * returns what every loaded save goes through: renamed species become today's, then
 * `sanitizeProgress` drops or replaces what content no longer has, so an old save still loads and
 * battles. A repair is logged with the player's id and the content ids involved, never more.
 */
export function loadSaveRepair(log: Log, dir: string = CONTENT_DIR): SaveRepair {
  const renamed = RenamedFile.parse(readJson(dir, 'creatures/renamed.json'));
  const content = loadBattleContent({
    weather: readJson(dir, 'creatures/weather.json'),
    moves: readJson(dir, 'creatures/moves.json'),
    species: readJson(dir, 'creatures/species.json'),
    rules: readJson(dir, 'creatures/battle-rules.json'),
    befriending: readJson(dir, 'creatures/befriending.json'),
    items: readJson(dir, 'items.json'),
  });
  return (playerId, data) => {
    const { progress, repairs } = sanitizeProgress(renameSpecies(data, renamed, content), content);
    if (isRepaired(repairs)) log.warn('save repaired', { playerId, ...repairs });
    return progress;
  };
}
