/**
 * Talking to a character, as pure functions on a Progress: which talk opens (`openConversation`),
 * what the player sees at a node (`conversationView`) and going on (`advanceConversation`).
 * Entering a node does its effects, all of them or none. docs/protocol.md has the messages.
 */
import { needsStarter, itemCount, type Progress } from './creatures.ts';
import { giveItems, takeItems, type ItemCount } from './inventory.ts';
import { completeStep, currentStep, questState, startQuest, type QuestChange } from './quests.ts';
import { MAX_STORY_IDS } from './save.ts';
import type { StoryContent } from './story.ts';
import type { Condition, DialogueNode, Effect, StoryCue } from './story-content.ts';

/** A talk in progress: the character's file and the node the player is at. */
export type Conversation = { readonly npc: string; readonly node: string };

/** What the client plays at a node: a story cue, or `offerStarter`, which opens the starter screen. */
export type TalkCue = StoryCue | 'offerStarter';

export function conditionHolds(condition: Condition, progress: Progress, content: StoryContent): boolean {
  const { story } = progress;
  if ('is' in condition) {
    const quest = content.quests.get(condition.quest);
    return quest !== undefined && questState(story, quest) === condition.is;
  }
  if ('at' in condition) {
    const quest = content.quests.get(condition.quest);
    return quest !== undefined && currentStep(story, quest)?.step.id === condition.at;
  }
  if ('has' in condition) return itemCount(progress, condition.has) >= (condition.count ?? 1);
  if ('lacks' in condition) return itemCount(progress, condition.lacks) === 0;
  if ('flag' in condition) return story.flags.includes(condition.flag) === condition.set;
  return needsStarter(progress) === condition.needsStarter;
}

/** Whether every condition holds; no conditions always hold. */
export function conditionsHold(conditions: readonly Condition[] | undefined, progress: Progress, content: StoryContent): boolean {
  return (conditions ?? []).every((condition) => conditionHolds(condition, progress, content));
}

function nodeOf(conversation: Conversation, content: StoryContent): DialogueNode | null {
  const nodes = content.dialogue.get(conversation.npc)?.nodes;
  return nodes && Object.hasOwn(nodes, conversation.node) ? (nodes[conversation.node] ?? null) : null;
}

/** The cue a node plays: its own, a cue effect, or the starter screen. Validation allows one at most. */
function cueOfNode(node: DialogueNode): TalkCue | null {
  for (const effect of node.effects ?? []) {
    if ('cue' in effect) return effect.cue;
    if ('offerStarter' in effect) return 'offerStarter';
  }
  return node.cue ?? null;
}

/** Whether the node the player is at offers the starter: `starter.choose` is allowed only there, by a player with no creature. */
export function offersStarter(conversation: Conversation, content: StoryContent): boolean {
  return (nodeOf(conversation, content)?.effects ?? []).some((effect) => 'offerStarter' in effect);
}

/**
 * What the player sees at a node: who speaks, the places in the node's `choices` of those whose
 * `if` holds (the client shows those, and answers with one of these numbers), and the cue to play.
 * `ends` means continuing ends the talk: the node has neither `next` nor a choice to show.
 */
export type TalkView = { readonly npc: string; readonly node: string; readonly speaker: string; readonly choices: readonly number[]; readonly cue: TalkCue | null; readonly ends: boolean };

export function conversationView(conversation: Conversation, progress: Progress, content: StoryContent): TalkView | null {
  const node = nodeOf(conversation, content);
  if (!node) return null;
  const choices = (node.choices ?? []).flatMap((choice, at) => (conditionsHold(choice.if, progress, content) ? [at] : []));
  return { ...conversation, speaker: node.speaker ?? conversation.npc, choices, cue: cueOfNode(node), ends: node.next === undefined && choices.length === 0 };
}

/**
 * Where a talk is after a step: at a node (null when it ended), the Progress after the node's
 * effects, the quests that changed, and items that did not fit in the bag.
 */
export type TalkStep = { readonly conversation: Conversation | null; readonly progress: Progress; readonly changes: readonly QuestChange[]; readonly extra: readonly ItemCount[] };

type Draft = { progress: Progress; changes: QuestChange[]; extra: ItemCount[] };

/** One effect on the draft; false when it cannot happen. */
function applyEffect(draft: Draft, effect: Effect, content: StoryContent): boolean {
  if ('startQuest' in effect || 'completeStep' in effect) {
    const result = 'startQuest' in effect ? startQuest(draft.progress, effect.startQuest, content) : completeStep(draft.progress, effect.completeStep, effect.step, content);
    if (!result) return false;
    draft.progress = result.progress;
    draft.changes.push(...result.changes);
    draft.extra.push(...result.extra);
    return true;
  }
  if ('give' in effect) {
    const gift = giveItems(draft.progress, [{ item: effect.give, count: effect.count }], content);
    draft.progress = gift.progress;
    draft.extra.push(...gift.extra);
    return true;
  }
  if ('take' in effect) {
    const taken = takeItems(draft.progress, effect.take, effect.count);
    if (taken) draft.progress = taken;
    return taken !== null;
  }
  if ('setFlag' in effect) {
    const { story } = draft.progress;
    if (!story.flags.includes(effect.setFlag) && story.flags.length < MAX_STORY_IDS) draft.progress = { ...draft.progress, story: { ...story, flags: [...story.flags, effect.setFlag] } };
    return true;
  }
  if ('offerStarter' in effect) return needsStarter(draft.progress);
  return true;
}

/**
 * Enters a node: does its effects in order, all of them or, when one cannot happen (a quest not
 * available, a step not current, an item the player lacks, a starter for a player who has one),
 * none, and the talk ends there.
 */
function enter(conversation: Conversation, progress: Progress, content: StoryContent): TalkStep {
  const node = nodeOf(conversation, content);
  const draft: Draft = { progress, changes: [], extra: [] };
  const done = node !== null && (node.effects ?? []).every((effect) => applyEffect(draft, effect, content));
  return done ? { conversation, ...draft } : { conversation: null, progress, changes: [], extra: [] };
}

/** Opens a talk with a character at the first entry of their file whose `if` holds. Null when they have no dialogue. */
export function openConversation(npc: string, progress: Progress, content: StoryContent): TalkStep | null {
  const dialogue = content.dialogue.get(npc);
  const entry = dialogue?.entries.find((candidate) => conditionsHold(candidate.if, progress, content));
  return entry ? enter({ npc, node: entry.node }, progress, content) : null;
}

/**
 * Goes on from the node the player is at: to the choice they picked (one of the view's `choices`),
 * to `next` (with `choice` null), or out of the talk (with `choice` null, when the view `ends`).
 * Null when the answer does not fit the node, so the server can refuse it.
 */
export function advanceConversation(conversation: Conversation, choice: number | null, progress: Progress, content: StoryContent): TalkStep | null {
  const node = nodeOf(conversation, content);
  const view = conversationView(conversation, progress, content);
  if (!node || !view) return null;
  if (choice !== null) {
    const picked = view.choices.includes(choice) ? node.choices?.[choice] : undefined;
    return picked ? enter({ npc: conversation.npc, node: picked.next }, progress, content) : null;
  }
  if (view.choices.length > 0) return null;
  if (node.next !== undefined) return enter({ npc: conversation.npc, node: node.next }, progress, content);
  return { conversation: null, progress, changes: [], extra: [] };
}
