import { emptyStory, loadStoryContent, type Language, type Progress, type ProgressMessage, type StoryContent, type StoryMessage } from '@nebotok/core';
import inventory from '../../../content/inventory.json';
import jobs from '../../../content/jobs.json';
import npcs from '../../../content/npcs.json';
import quests from '../../../content/quests.json';
import recipes from '../../../content/recipes.json';
import skills from '../../../content/skills.json';
import spots from '../../../content/spots.json';
import stations from '../../../content/stations.json';
import story from '../../../content/story.json';
import { CONTENT } from './battle-content.ts';

const dialogueFiles = import.meta.glob<unknown>('../../../content/dialogue/*.json', { eager: true, import: 'default' });
const dialogue = Object.fromEntries(Object.entries(dialogueFiles).map(([path, raw]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), raw]));

/** The characters, dialogue, quests, chapters, bag rules and skill content, by id, for naming and laying out what the server sends. */
export const STORY: StoryContent = loadStoryContent({ npcs, dialogue, quests, story, inventory, skills: { skills, spots, recipes, stations, jobs } }, CONTENT);

export const questName = (id: string, language: Language): string => STORY.quests.get(id)?.name[language] ?? id;

/**
 * The player's progress as the core rules read it, from what the server sent. Storage never
 * decides a quest or the bag, so it stays empty; skills and the board are not read here yet.
 */
export function storyProgress(progress: ProgressMessage, saved: StoryMessage | null): Progress {
  const { team, inventory: items, lastShrine, seen, befriended } = progress;
  return { team, storage: [], inventory: items, lastShrine, seen, befriended, story: saved ?? emptyStory(), skills: [], jobs: null };
}
