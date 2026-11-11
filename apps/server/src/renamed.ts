import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  JobsFile,
  NpcsFile,
  QuestsFile,
  RecipesFile,
  RenamedFile,
  SkillsFile,
  SpotsFile,
  StationsFile,
  StoryFile,
  isRepaired,
  loadBattleContent,
  pruneJobs,
  pruneSkills,
  pruneStory,
  renameSpecies,
  sanitizeProgress,
  skillContentOf,
  type SaveData,
  type StoryProgress,
} from '@nebotok/core';
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
 * Reads content/creatures/renamed.json and the creatures, items, quests, story flags, characters
 * and skill files it is checked against, and returns what every loaded save goes through: renamed
 * species become today's, then `sanitizeProgress` drops or replaces what content no longer has,
 * then `pruneStory` drops quests and flags the story no longer has, `pruneSkills` skills it no
 * longer has (holding levels at `maxLevel`) and `pruneJobs` board jobs whose template, item or
 * character is gone, so an old save still loads and plays. A repair is logged with the player's id
 * and the content ids involved, never more.
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
  const skills = skillContentOf({
    skills: SkillsFile.parse(readJson(dir, 'skills.json')),
    spots: SpotsFile.parse(readJson(dir, 'spots.json')),
    recipes: RecipesFile.parse(readJson(dir, 'recipes.json')),
    stations: StationsFile.parse(readJson(dir, 'stations.json')),
    jobs: JobsFile.parse(readJson(dir, 'jobs.json')),
  });
  const board = { items: content.items, npcs: new Map(NpcsFile.parse(readJson(dir, 'npcs.json')).npcs.map((npc) => [npc.id, npc])), skills };
  return (playerId, data) => {
    const { progress, repairs } = sanitizeProgress(renameSpecies(data, renamed, content), content);
    const pruned = pruneStory(progress.story, story);
    const dropped = droppedStory(progress.story, pruned);
    const storyRepaired = dropped.droppedQuests.length + dropped.droppedFlags.length > 0 || pruned.active.length !== progress.story.active.length;
    const levels = pruneSkills(progress.skills, skills);
    const skillsRepaired = levels.dropped.length > 0 || levels.skills.some((entry, at) => entry !== progress.skills[at]);
    const jobs = pruneJobs(progress.jobs, board);
    const skillDrops = { droppedSkills: levels.dropped, droppedJobs: jobs.dropped };
    if (isRepaired(repairs) || storyRepaired || skillsRepaired || jobs.dropped.length > 0) log.warn('save repaired', { playerId, ...repairs, ...dropped, ...skillDrops });
    const repaired = storyRepaired ? { ...progress, story: pruned } : progress;
    return skillsRepaired || jobs.dropped.length > 0 ? { ...repaired, skills: levels.skills, jobs: jobs.jobs } : repaired;
  };
}
