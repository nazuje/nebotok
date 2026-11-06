/**
 * Playing the story without a client: a command is a talk (the answers given in order, and the
 * starter to choose when a node offers it) or a world event. `storyBotCommand` picks the command
 * that `nextGoal` asks for, so tests, goldens and bots can play the whole story through.
 */
import { z } from 'zod';
import { ContentId, type StartersFile } from './content.ts';
import { chooseStarter, needsStarter, type Progress } from './creatures.ts';
import { advanceConversation, conversationView, offersStarter, openConversation, type Conversation, type TalkStep, type TalkView } from './dialogue.ts';
import type { ItemCount } from './inventory.ts';
import { nextGoal, questEvent, type QuestChange, type QuestEvent } from './quests.ts';
import type { StoryContent } from './story.ts';
import { MAX_CHOICES } from './story-content.ts';

export const QuestEventSchema = z.union([
  z.strictObject({ kind: z.literal('battleWon'), zone: ContentId.nullable() }),
  z.strictObject({ kind: z.literal('befriended'), species: ContentId }),
  z.strictObject({ kind: z.literal('rested'), shrine: ContentId }),
  z.strictObject({ kind: z.literal('reached'), mark: ContentId }),
]);

/** Talk to `talk`, answering each node in turn (a choice's place, or null to go on), choosing `starter` where a node offers it; or count `event`. */
export const StoryCommand = z.union([
  z.strictObject({ talk: ContentId, answers: z.array(z.number().int().min(0).max(MAX_CHOICES - 1).nullable()).max(50), starter: ContentId.optional() }),
  z.strictObject({ event: QuestEventSchema }),
]);
export type StoryCommand = z.infer<typeof StoryCommand>;

/** What a command did, for goldens: every node shown, every quest change and every item that did not fit. */
export type StoryRecord = { readonly views: readonly TalkView[]; readonly changes: readonly QuestChange[]; readonly extra: readonly ItemCount[]; readonly starter: string | null };

export type StoryWorldRules = { readonly content: StoryContent; readonly starters: StartersFile };

export class StoryCommandError extends Error {
  override name = 'StoryCommandError';
}

type Walk = { conversation: Conversation | null; progress: Progress; views: TalkView[]; changes: QuestChange[]; extra: ItemCount[]; starter: string | null };

function step(walk: Walk, result: TalkStep, rules: StoryWorldRules, starter: string | undefined): void {
  walk.conversation = result.conversation;
  walk.progress = result.progress;
  walk.changes.push(...result.changes);
  walk.extra.push(...result.extra);
  if (!walk.conversation) return;
  const view = conversationView(walk.conversation, walk.progress, rules.content);
  if (view) walk.views.push(view);
  if (starter !== undefined && needsStarter(walk.progress) && offersStarter(walk.conversation, rules.content)) {
    const chosen = chooseStarter(walk.progress, starter, rules.starters, rules.content.battle);
    if (!chosen) throw new StoryCommandError(`"${starter}" is not a starter`);
    walk.progress = chosen;
    walk.starter = starter;
  }
}

/** Plays one command. A talk left open after its answers is walked away from. Throws on an answer the node does not take. */
export function runStoryCommand(progress: Progress, command: StoryCommand, rules: StoryWorldRules): { readonly progress: Progress; readonly record: StoryRecord } {
  if ('event' in command) {
    const result = questEvent(progress, command.event, rules.content);
    return { progress: result.progress, record: { views: [], changes: result.changes, extra: result.extra, starter: null } };
  }
  const opened = openConversation(command.talk, progress, rules.content);
  if (!opened) throw new StoryCommandError(`"${command.talk}" has no dialogue`);
  const walk: Walk = { conversation: null, progress, views: [], changes: [], extra: [], starter: null };
  step(walk, opened, rules, command.starter);
  for (const [at, answer] of command.answers.entries()) {
    if (!walk.conversation) throw new StoryCommandError(`answer ${at} to "${command.talk}" comes after the talk ended`);
    const next = advanceConversation(walk.conversation, answer, walk.progress, rules.content);
    if (!next) throw new StoryCommandError(`answer ${at} (${String(answer)}) does not fit node "${walk.conversation.node}" of "${command.talk}"`);
    step(walk, next, rules, command.starter);
  }
  return { progress: walk.progress, record: { views: walk.views, changes: walk.changes, extra: walk.extra, starter: walk.starter } };
}

const MAX_TALK_DEPTH = 30;

/**
 * The answers that take a talk with `npc` to a node that changes the story (or, with `starter`,
 * to the starter), trying choices in order, depth first. Null when no path does.
 */
function talkPlan(npc: string, progress: Progress, rules: StoryWorldRules, starter: string | undefined): (number | null)[] | null {
  const before = JSON.stringify(progress.story);
  const done = (walk: Walk) => (starter === undefined ? JSON.stringify(walk.progress.story) !== before : walk.starter !== null);
  const search = (walk: Walk, answers: (number | null)[]): (number | null)[] | null => {
    if (done(walk)) return answers;
    if (!walk.conversation || answers.length >= MAX_TALK_DEPTH) return null;
    const view = conversationView(walk.conversation, walk.progress, rules.content);
    const options = view && view.choices.length > 0 ? view.choices : [null];
    for (const answer of options) {
      const next = advanceConversation(walk.conversation, answer, walk.progress, rules.content);
      if (!next) continue;
      const branch: Walk = { ...walk, views: [], changes: [], extra: [] };
      step(branch, next, rules, starter);
      const found = search(branch, [...answers, answer]);
      if (found) return found;
    }
    return null;
  };
  const opened = openConversation(npc, progress, rules.content);
  if (!opened) return null;
  const walk: Walk = { conversation: null, progress, views: [], changes: [], extra: [], starter: null };
  step(walk, opened, rules, starter);
  return search(walk, []);
}

/** The species a befriend step can count: the one it names, else the first of its type, else the first species. */
function befriendable(type: string | undefined, species: string | undefined, rules: StoryWorldRules): string | null {
  if (species !== undefined) return species;
  const ids = [...rules.content.battle.species.values()].filter((entry) => type === undefined || entry.type === type).map((entry) => entry.id);
  return ids.toSorted()[0] ?? null;
}

/** The command that does what `nextGoal` asks, as a player would: null when the story has nothing left, or the bot is stuck. */
export function storyBotCommand(progress: Progress, rules: StoryWorldRules): StoryCommand | null {
  const goal = nextGoal(progress, rules.content);
  if (!goal) return null;
  const talk = (npc: string, starter?: string): StoryCommand | null => {
    const answers = talkPlan(npc, progress, rules, starter);
    if (!answers) return null;
    return starter === undefined ? { talk: npc, answers } : { talk: npc, answers, starter };
  };
  if (goal.kind === 'starter') return talk(goal.npc, rules.starters.species[0]);
  if (goal.kind === 'newQuest') return talk(goal.npc);
  const { step: questStep } = goal;
  const events: Record<string, () => QuestEvent | null> = {
    winBattles: () => (questStep.kind === 'winBattles' ? { kind: 'battleWon', zone: questStep.zone ?? null } : null),
    befriend: () => {
      const species = questStep.kind === 'befriend' ? befriendable(questStep.type, questStep.species, rules) : null;
      return species === null ? null : { kind: 'befriended', species };
    },
    visitShrine: () => (questStep.kind === 'visitShrine' ? { kind: 'rested', shrine: questStep.shrine } : null),
    reach: () => (questStep.kind === 'reach' ? { kind: 'reached', mark: questStep.mark } : null),
  };
  if (questStep.kind === 'talk') return talk(questStep.npc);
  if (questStep.kind === 'deliver') return talk(questStep.to);
  const event = events[questStep.kind]?.() ?? null;
  return event ? { event } : null;
}

/** Plays the bot until the story has nothing left, it is stuck (no command does what `nextGoal` asks), or `limit` commands. */
export function playStory(progress: Progress, rules: StoryWorldRules, limit: number): { readonly progress: Progress; readonly commands: readonly StoryCommand[]; readonly records: readonly StoryRecord[]; readonly stuck: boolean } {
  let current = progress;
  const commands: StoryCommand[] = [];
  const records: StoryRecord[] = [];
  while (commands.length < limit) {
    if (!nextGoal(current, rules.content)) return { progress: current, commands, records, stuck: false };
    const command = storyBotCommand(current, rules);
    if (!command) return { progress: current, commands, records, stuck: true };
    const played = runStoryCommand(current, command, rules);
    commands.push(command);
    records.push(played.record);
    current = played.progress;
  }
  return { progress: current, commands, records, stuck: false };
}
