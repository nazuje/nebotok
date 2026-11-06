import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StartersFile, loadBattleContent, loadStoryContent, type StoryContent, type StoryContentFiles, type StoryWorldRules } from '../../src/index.ts';
import { battleContent } from './battle-content.ts';

const CONTENT = fileURLToPath(new URL('../../../../content/', import.meta.url));
const GOLDEN = fileURLToPath(new URL('../../fixtures/golden/story/content/', import.meta.url));

const json = (dir: string, file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));

function storyFiles(dir: string): StoryContentFiles {
  const dialogue = Object.fromEntries(
    readdirSync(join(dir, 'dialogue'))
      .filter((name) => name.endsWith('.json'))
      .toSorted()
      .map((name) => [name.replace(/\.json$/, ''), json(dir, `dialogue/${name}`)]),
  );
  return { npcs: json(dir, 'npcs.json'), quests: json(dir, 'quests.json'), story: json(dir, 'story.json'), inventory: json(dir, 'inventory.json'), dialogue };
}

/** The real story files in content/, so tests play the placeholder story players see. */
export const liveStoryFiles: StoryContentFiles = storyFiles(CONTENT);
export const storyContent: StoryContent = loadStoryContent(liveStoryFiles, battleContent);
export const liveStory: StoryWorldRules = { content: storyContent, starters: StartersFile.parse(json(CONTENT, 'starters.json')) };

/**
 * The frozen story that story goldens replay against, with its own creatures and items in
 * fixtures/golden/story/content/, so editing the real story never moves a golden hash. It plays
 * every kind of step. Only change it together with re-recording the goldens.
 */
const goldenBattle = loadBattleContent({
  weather: json(GOLDEN, 'weather.json'),
  moves: json(GOLDEN, 'moves.json'),
  species: json(GOLDEN, 'species.json'),
  rules: json(GOLDEN, 'battle-rules.json'),
  befriending: json(GOLDEN, 'befriending.json'),
  items: json(GOLDEN, 'items.json'),
});
export const goldenStoryFiles: StoryContentFiles = storyFiles(GOLDEN);
export const goldenStory: StoryWorldRules = { content: loadStoryContent(goldenStoryFiles, goldenBattle), starters: StartersFile.parse(json(GOLDEN, 'starters.json')) };
