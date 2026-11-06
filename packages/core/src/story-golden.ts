import { z } from 'zod';
import { emptyProgress, type Progress } from './creatures.ts';
import { stableHash, type Json } from './hash.ts';
import { playStory, runStoryCommand, StoryCommand, type StoryRecord, type StoryWorldRules } from './story-bot.ts';

/**
 * Story goldens live in `fixtures/golden/story/` and replay against the frozen story content in
 * `fixtures/golden/story/content/`. A new player plays `commands`, then the bot plays on for up to
 * `botCommands` more. The hash covers every record and the final Progress.
 */
export const StoryGoldenFile = z.strictObject({
  description: z.string().min(1),
  commands: z.array(StoryCommand).max(500),
  botCommands: z.number().int().min(0).max(500),
  expectedHash: z.string().regex(/^[0-9a-f]{14}$/),
});
export type StoryGoldenFile = z.infer<typeof StoryGoldenFile>;

export type StoryReplay = { readonly progress: Progress; readonly records: readonly StoryRecord[]; readonly stuck: boolean };

export function storyReplay(golden: Pick<StoryGoldenFile, 'commands' | 'botCommands'>, rules: StoryWorldRules): StoryReplay {
  let progress = emptyProgress();
  const records: StoryRecord[] = [];
  for (const command of golden.commands) {
    const played = runStoryCommand(progress, command, rules);
    progress = played.progress;
    records.push(played.record);
  }
  const bot = playStory(progress, rules, golden.botCommands);
  return { progress: bot.progress, records: [...records, ...bot.records], stuck: bot.stuck };
}

export function storyReplayHash(golden: Pick<StoryGoldenFile, 'commands' | 'botCommands'>, rules: StoryWorldRules): string {
  const { progress, records } = storyReplay(golden, rules);
  // Optional fields (a creature's nickname) make Progress wider than Json; JSON drops the missing ones, as the hash would.
  const plain: Json = JSON.parse(JSON.stringify({ records, progress }));
  return stableHash(plain);
}
