import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { StoryGoldenFile, nextGoal, storyReplay, storyReplayHash } from '../../src/index.ts';
import { goldenStory } from '../support/story-content.ts';

const STORY_DIR = fileURLToPath(new URL('../../fixtures/golden/story/', import.meta.url));
const files = readdirSync(STORY_DIR).filter((name) => name.endsWith('.json')).toSorted();
const golden = (name: string) => StoryGoldenFile.parse(JSON.parse(readFileSync(join(STORY_DIR, name), 'utf8')));

describe('story golden replays', () => {
  it('has several scripted stories', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s replays to its recorded hash', (name) => {
    // A mismatch means story rules or the frozen content in fixtures/golden/story/content/ changed. If that was
    // intended, put the hash this test received into the file, and say why in the commit.
    expect(storyReplayHash(golden(name), goldenStory)).toBe(golden(name).expectedHash);
  });

  it.each(files)('%s never gets stuck', (name) => {
    expect(storyReplay(golden(name), goldenStory).stuck).toBe(false);
  });

  it('plays the whole frozen story, every step kind, its cue and its closing flag', () => {
    const { progress, records } = storyReplay(golden('bot-plays-everything.json'), goldenStory);
    expect(nextGoal(progress, goldenStory.content)).toBeNull();
    expect(progress.story.done).toEqual(['first-round', 'restless-grass', 'bell', 'new-friend', 'wind-readings', 'grey-letter']);
    expect(progress.story.flags).toEqual(['met-bavko', 'grey-letter-read', 'storm-seen', 'chapter-1-done']);
    const changes = records.flatMap((record) => record.changes);
    expect(changes.filter((change) => change.change === 'done')).toHaveLength(6);
    expect(changes.flatMap((change) => (change.cue ? [change.cue] : []))).toEqual(['storm-glimpse']);
    expect(records.flatMap((record) => record.extra)).toEqual([{ item: 'plain-treat', count: 8 }]);
    expect(progress.team[0]).toMatchObject({ species: 'sun-blob' });
    expect(progress.team[0]!.level).toBeGreaterThan(goldenStory.starters.level);
  });
});
