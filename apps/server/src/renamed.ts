import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QuestsFile, RenamedFile, StoryFile, isRepaired, loadBattleContent, pruneStory, renameSpecies, sanitizeProgress, type SaveData, type StoryProgress } from '@nebotok/core';
import type { Log } from './log.ts';
import { CONTENT_DIR } from './world.ts';

const readJson = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

/** Turns a loaded save's data into data today's content can play. */
export type SaveRepair = (playerId: number, data: SaveData) => SaveData;

const questsOf = (story: StoryProgress) => [...story.active.map((entry) => entry.quest), ...story.done];

/** The quest and flag ids `pruneStory` dropped, for the log. */
function droppedStory(before: StoryProgress, after: StoryProgress) {
  const kept = new Set([...questsOf(after), ...after.flags]);
  return { droppedQuests: questsOf(before).filter((id) => !kept.has(id)), droppedFlags: before.flags.filter((id) => !kept.has(id)) };
}

/**
 * Reads content/creatures/renamed.json and the creatures, items, quests and story flags it is
 * checked against, and returns what every loaded save goes through: renamed species become
 * today's, then `sanitizeProgress` drops or replaces what content no longer has, then `pruneStory`
 * drops quests and flags the story no longer has, so an old save still loads and plays. A repair is
 * logged with the player's id and the content ids involved, never more.
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
  const story = {
    quests: new Map(QuestsFile.parse(readJson(dir, 'quests.json')).quests.map((quest) => [quest.id, quest])),
    flags: new Set(StoryFile.parse(readJson(dir, 'story.json')).flags.map((flag) => flag.id)),
  };
  return (playerId, data) => {
    const { progress, repairs } = sanitizeProgress(renameSpecies(data, renamed, content), content);
    const pruned = pruneStory(progress.story, story);
    const dropped = droppedStory(progress.story, pruned);
    const storyRepaired = dropped.droppedQuests.length + dropped.droppedFlags.length > 0 || pruned.active.length !== progress.story.active.length;
    if (isRepaired(repairs) || storyRepaired) log.warn('save repaired', { playerId, ...repairs, ...dropped });
    return storyRepaired ? { ...progress, story: pruned } : progress;
  };
}
