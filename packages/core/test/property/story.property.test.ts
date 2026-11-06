import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  SaveData,
  advanceConversation,
  conversationView,
  createSave,
  emptyProgress,
  nextGoal,
  openConversation,
  playStory,
  questEvent,
  stackLimit,
  type Progress,
  type QuestEvent,
  type StoryWorldRules,
} from '../../src/index.ts';
import { goldenStory, liveStory } from '../support/story-content.ts';

const stories: [string, StoryWorldRules][] = [
  ['the placeholder story in content/', liveStory],
  ['the frozen golden story', goldenStory],
];

const saveOf = (progress: Progress) => ({ name: 'Story Courier', language: 'en' as const, createdAt: '2026-05-01T09:00:00.000Z', position: null, ...progress });

describe.each(stories)('the story sim on %s', (_label, rules) => {
  it('plays nextGoal from a new player to the end of every chapter', () => {
    const played = playStory(emptyProgress(), rules, 300);
    expect(played.stuck).toBe(false);
    expect(nextGoal(played.progress, rules.content)).toBeNull();
    const { story } = played.progress;
    expect(rules.content.chapters.flatMap((chapter) => chapter.quests).filter((id) => !story.done.includes(id))).toEqual([]);
    expect(rules.content.chapters.flatMap((chapter) => chapter.endsWith ?? []).filter((flag) => !story.flags.includes(flag))).toEqual([]);
    expect(story.active).toEqual([]);
    expect(createSave(saveOf(played.progress)).data.story).toEqual(story);
  });
});

/** A player somewhere along the story: the bot's first `steps` commands. */
const somewhere = (rules: StoryWorldRules) => fc.integer({ min: 0, max: 40 }).map((steps) => playStory(emptyProgress(), rules, steps).progress);

function eventsOf(rules: StoryWorldRules): fc.Arbitrary<QuestEvent> {
  const quests = [...rules.content.quests.values()];
  const zones = [null, ...quests.flatMap((quest) => quest.steps.flatMap((step) => (step.kind === 'winBattles' && step.zone ? [step.zone] : [])))];
  const shrines = quests.flatMap((quest) => quest.steps.flatMap((step) => (step.kind === 'visitShrine' ? [step.shrine] : [])));
  const marks = quests.flatMap((quest) => quest.steps.flatMap((step) => (step.kind === 'reach' ? [step.mark] : [])));
  const species = [...rules.content.battle.species.keys()];
  return fc.oneof(
    fc.constantFrom(...zones).map((zone): QuestEvent => ({ kind: 'battleWon', zone })),
    fc.constantFrom(...species).map((id): QuestEvent => ({ kind: 'befriended', species: id })),
    fc.constantFrom('nowhere', ...shrines).map((shrine): QuestEvent => ({ kind: 'rested', shrine })),
    fc.constantFrom('nowhere', ...marks).map((mark): QuestEvent => ({ kind: 'reached', mark })),
  );
}

/** Talks to a character, answering with picks among what each node takes, as long as the talk lasts. */
function talk(progress: Progress, npc: string, picks: readonly number[], rules: StoryWorldRules): Progress {
  const opened = openConversation(npc, progress, rules.content);
  if (!opened) throw new Error(`${npc} has no dialogue`);
  let { conversation, progress: current } = opened;
  for (const pick of picks) {
    if (!conversation) break;
    const view = conversationView(conversation, current, rules.content);
    if (!view) throw new Error(`node ${conversation.node} is gone`);
    const answer = view.choices.length > 0 ? (view.choices[pick % view.choices.length] ?? null) : null;
    const next = advanceConversation(conversation, answer, current, rules.content);
    if (!next) throw new Error(`answer ${String(answer)} refused at ${conversation.node}`);
    ({ conversation, progress: current } = next);
  }
  return current;
}

describe.each(stories)('random talks and events on %s', (_label, rules) => {
  const npcs = [...rules.content.npcs.keys()];
  const action = fc.oneof(
    fc.record({ npc: fc.constantFrom(...npcs), picks: fc.array(fc.nat(5), { maxLength: 12 }) }),
    eventsOf(rules).map((event) => ({ event })),
  );

  it('never break the save, never overfill a stack, and never answer a shown choice with a refusal', () => {
    fc.assert(
      fc.property(somewhere(rules), fc.array(action, { maxLength: 25 }), (start, actions) => {
        let progress = start;
        for (const next of actions) {
          progress = 'event' in next ? questEvent(progress, next.event, rules.content).progress : talk(progress, next.npc, next.picks, rules);
          expect(SaveData.safeParse(saveOf(progress)).success).toBe(true);
          for (const entry of progress.inventory) expect(entry.count).toBeLessThanOrEqual(Math.max(stackLimit(entry.item, rules.content), start.inventory.find((had) => had.item === entry.item)?.count ?? 0));
          for (const active of progress.story.active) expect(progress.story.done).not.toContain(active.quest);
        }
      }),
      { numRuns: 150 },
    );
  });
});
