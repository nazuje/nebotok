import { DIALOGUE_FILE, loadStoryContent, type StoryContent } from '@nebotok/core';
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

const CONTENT_DIR = '../../../content/';
const dialogueFiles = import.meta.glob<unknown>('../../../content/dialogue/*.json', { eager: true, import: 'default' });
const dialogue = Object.fromEntries(
  Object.entries(dialogueFiles).flatMap(([path, raw]) => {
    const npc = DIALOGUE_FILE.exec(path.slice(CONTENT_DIR.length))?.[1];
    return npc === undefined ? [] : [[npc, raw]];
  }),
);

/** The characters, their dialogue and the quests, by id, for showing what `talk.node` and `story` name. */
export const STORY: StoryContent = loadStoryContent({ npcs, dialogue, quests, story, inventory, skills: { skills, spots, recipes, stations, jobs } }, CONTENT);
