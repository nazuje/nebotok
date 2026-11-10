import { mapFromRows, type Goal, type QuestChanged, type QuestStep, type WorldMap } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { itemAbout } from '../src/bag-screen.ts';
import { stepProgress, toBeContinued } from '../src/journal-screen.ts';
import { questToastLines } from '../src/quest-toast.ts';
import { STORY } from '../src/story-content.ts';
import { goalTile } from '../src/story-link.ts';
import { format, text } from '../src/strings.ts';

const hint = { en: 'Go on.', sl: 'Kar naprej.' };
const step = (fields: Record<string, unknown>) => ({ id: 'a-step', hint, ...fields }) as QuestStep;
const map: WorldMap = {
  ...mapFromRows('test', ['.........', '.........', '.........', '.........']),
  npcs: { bavko: { x: 1, y: 1 }, tobolko: { x: 2, y: 1 } },
  shrines: { 'post-shrine': { x: 3, y: 0 } },
  marks: { lookout: { x: 8, y: 3 } },
  encounterAreas: [
    { zone: 'post-meadow', x: 4, y: 0, width: 3, height: 3 },
    { zone: 'windy-rise', x: 0, y: 2, width: 2, height: 2 },
  ],
};
const goal = (questStep: QuestStep): Goal => ({ kind: 'step', quest: 'q', step: questStep, left: 1 });

describe('where next', () => {
  it('goes to the character a starter, a new quest, a talk or a delivery needs', () => {
    expect(goalTile({ kind: 'starter', npc: 'bavko' }, map)).toEqual({ x: 1, y: 1 });
    expect(goalTile({ kind: 'newQuest', quest: 'q', npc: 'tobolko' }, map)).toEqual({ x: 2, y: 1 });
    expect(goalTile(goal(step({ kind: 'talk', npc: 'tobolko' })), map)).toEqual({ x: 2, y: 1 });
    expect(goalTile(goal(step({ kind: 'deliver', item: 'hello-note', count: 1, to: 'bavko' })), map)).toEqual({ x: 1, y: 1 });
  });

  it('goes to the shrine, the mark or the middle of the tall grass a step needs', () => {
    expect(goalTile(goal(step({ kind: 'visitShrine', shrine: 'post-shrine' })), map)).toEqual({ x: 3, y: 0 });
    expect(goalTile(goal(step({ kind: 'reach', mark: 'lookout' })), map)).toEqual({ x: 8, y: 3 });
    expect(goalTile(goal(step({ kind: 'winBattles', count: 2, zone: 'windy-rise' })), map)).toEqual({ x: 1, y: 3 });
    expect(goalTile(goal(step({ kind: 'winBattles', count: 2 })), map)).toEqual({ x: 5, y: 1 });
    expect(goalTile(goal(step({ kind: 'befriend', count: 1 })), map)).toEqual({ x: 5, y: 1 });
  });

  it('has nowhere to go for what is not on this map', () => {
    expect(goalTile({ kind: 'starter', npc: 'vetrinka' }, map)).toBeNull();
    expect(goalTile(goal(step({ kind: 'reach', mark: 'far-away' })), map)).toBeNull();
    expect(goalTile(goal(step({ kind: 'winBattles', count: 1, zone: 'nowhere' })), map)).toBeNull();
  });
});

describe('the journal', () => {
  it('counts battles and new friends when a step needs more than one', () => {
    expect(stepProgress('winBattles', 1, 2, 'en')).toBe('1 of 2 battles');
    expect(stepProgress('befriend', 0, 3, 'sl')).toBe(format('journal.befriends', 'sl', { count: 0, of: 3 }));
    expect(stepProgress('winBattles', 0, 1, 'en')).toBeNull();
    expect(stepProgress('talk', 0, 1, 'en')).toBeNull();
    expect(stepProgress(undefined, 0, 2, 'en')).toBeNull();
  });

  it('says the story goes on later only once the last chapter is done', () => {
    const last = STORY.chapters.at(-1)?.id ?? '';
    const log = (done: boolean) => ({ chapters: [{ chapter: last, done, quests: [] }], next: null });
    expect(toBeContinued(log(true))).toBe(true);
    expect(toBeContinued(log(false))).toBe(false);
    expect(toBeContinued({ chapters: [], next: null })).toBe(false);
  });
});

describe('the bag', () => {
  it('says what a quest item is and which quest it is for', () => {
    const about = itemAbout('hello-note', 'sl');
    expect(about.description).toBe(STORY.items.get('hello-note')?.description?.sl);
    expect(about.quest).toBe(format('bag.forQuest', 'sl', { quest: STORY.quests.get('first-round')?.name.sl ?? '' }));
  });

  it('says what a treat is for when it has no description of its own', () => {
    expect(itemAbout('plain-treat', 'en')).toEqual({ description: text('bag.treatAbout', 'en'), quest: null });
  });
});

describe('quest toasts', () => {
  const name = STORY.quests.get('first-round')?.name.en ?? '';
  const firstHint = STORY.quests.get('first-round')?.steps[0]?.hint.en ?? '';

  it('names a new quest and its first step', () => {
    const change: QuestChanged = { quest: 'first-round', change: 'started', step: 0, rewards: null, cue: null };
    expect(questToastLines(change, 'en')).toEqual([`New quest: ${name}`, firstHint]);
  });

  it('lists what a done quest gave, and what did not fit', () => {
    const change: QuestChanged = {
      quest: 'first-round',
      change: 'done',
      step: 1,
      rewards: { items: [{ item: 'plain-treat', count: 3 }], extra: [{ item: 'sun-treat', count: 1 }], xp: 20, creatures: [] },
      cue: null,
    };
    expect(questToastLines(change, 'en')).toEqual([`Quest done: ${name}`, 'Plain Treat ×3, 20 XP for each creature', 'No room in the bag for: Sun Treat ×1']);
  });

  it('says only the headline for a done quest with no rewards', () => {
    expect(questToastLines({ quest: 'first-round', change: 'done', step: 1, rewards: null, cue: null }, 'sl')).toEqual([format('quest.done', 'sl', { quest: STORY.quests.get('first-round')?.name.sl ?? '' })]);
  });
});
