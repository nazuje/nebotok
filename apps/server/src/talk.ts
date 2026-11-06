import {
  PLAYER_SIDE,
  advanceConversation,
  conversationView,
  learnTeamMoves,
  needsStarter,
  npcInReach,
  offersStarter,
  openConversation,
  questEvent,
  type BattleContent,
  type BattleOutcome,
  type Conversation,
  type PendingMove,
  type Point,
  type Progress,
  type QuestChange,
  type QuestEvent,
  type RefusalReason,
  type StoryContent,
  type TalkStep,
  type WorldMap,
} from '@nebotok/core';

/** A talk with no request from its player for this long ends, connected or not, like an idle battle. */
export const TALK_IDLE_MS = 120_000;

/**
 * Whether `starter.choose` is allowed only while talking at a node that offers the starter. The
 * client opens its starter screen only from that talk, so a starter chosen any other way is refused.
 */
export const STARTER_NEEDS_TALK = true;

/**
 * A talk in progress. Like a move offer it lives only in the seat's memory and is never saved:
 * effects are saved as each node is entered, so a talk lost with its seat loses nothing.
 */
export type LiveTalk = {
  /** Counted across the room, so an answer to an old talk never matches a new one. */
  readonly id: number;
  conversation: Conversation;
  /** When the player last sent a talk request, by the room's clock. */
  lastInputAt: number;
};

/** What the player is doing that a new talk must wait for. */
export type Busy = { readonly battle: boolean; readonly offer: boolean; readonly talking: boolean };

/** Why `talk.start` with `npc` from `at` is refused, or null when it may open. */
export function talkStartRefusal(npc: string, at: Point, busy: Busy, map: WorldMap, content: StoryContent): RefusalReason | null {
  if (busy.battle) return 'inBattle';
  if (busy.offer || busy.talking) return 'notNow';
  if (!content.npcs.has(npc)) return 'invalid';
  return npcInReach(map, at, npc) ? null : 'tooFar';
}

/**
 * Why `starter.choose` is refused before its species is looked at, or null: a player who has a
 * creature never gets another (`notNow`), and with `needsTalk` one who is not at a node that
 * offers the starter must talk to its character first (`notTalking`).
 */
export function starterRefusal(progress: Progress, talk: Conversation | null, content: StoryContent, needsTalk: boolean = STARTER_NEEDS_TALK): RefusalReason | null {
  if (!needsStarter(progress)) return 'notNow';
  if (needsTalk && (talk === null || !offersStarter(talk, content))) return 'notTalking';
  return null;
}

/**
 * Where a talk request leads: `refused` when the answer does not fit the node (or the character
 * has no dialogue), `failed` when the node it leads to has an effect that cannot happen (a content
 * bug: nothing is done and the talk ends), `stays` at a node, or `ended` by the player continuing
 * from a last node.
 */
export type TalkOutcome =
  | { readonly kind: 'refused' }
  | { readonly kind: 'failed' }
  | { readonly kind: 'stays'; readonly conversation: Conversation; readonly step: TalkStep }
  | { readonly kind: 'ended'; readonly step: TalkStep };

/** Opens a talk with `npc` at its first entry that holds, doing that node's effects. */
export function openTalk(npc: string, progress: Progress, content: StoryContent): TalkOutcome {
  const step = openConversation(npc, progress, content);
  if (!step) return { kind: 'refused' };
  return step.conversation ? { kind: 'stays', conversation: step.conversation, step } : { kind: 'failed' };
}

/** Goes on from the node the player is at, with one of its shown choices or null. */
export function continueTalk(conversation: Conversation, choice: number | null, progress: Progress, content: StoryContent): TalkOutcome {
  const view = conversationView(conversation, progress, content);
  const step = advanceConversation(conversation, choice, progress, content);
  if (!view || !step) return { kind: 'refused' };
  if (step.conversation) return { kind: 'stays', conversation: step.conversation, step };
  // advanceConversation ends a talk both when the player continues from a last node and when the
  // next node's effects cannot happen; only the first is an answer the node expects.
  return choice === null && view.ends ? { kind: 'ended', step } : { kind: 'failed' };
}

/** The quest events a finished battle counts: a won battle in its zone, and a befriending as well. A refused treat after the creature fainted is a win too. */
export function battleEvents(outcome: BattleOutcome | null, zone: string, befriended: string | null): QuestEvent[] {
  if (outcome?.winner !== PLAYER_SIDE) return [];
  const won: QuestEvent = { kind: 'battleWon', zone };
  return befriended === null ? [won] : [won, { kind: 'befriended', species: befriended }];
}

/** What changed the story: the progress after, and the quests that changed, in order. */
export type StoryResult = { readonly progress: Progress; readonly changes: readonly QuestChange[] };

/** Counts events one after another, as `questEvent` does each. */
export function countEvents(progress: Progress, events: readonly QuestEvent[], content: StoryContent): StoryResult {
  let next = progress;
  const changes: QuestChange[] = [];
  for (const event of events) {
    const counted = questEvent(next, event, content);
    next = counted.progress;
    changes.push(...counted.changes);
  }
  return { progress: next, changes };
}

/**
 * A story result made ready to apply: the experience quest rewards gave teaches the moves of the
 * new levels as after a battle (`learnTeamMoves`), at once with room for them, else as moves to
 * offer. `storyChanged` says whether `story` must be sent.
 */
export type StoryChange = { readonly progress: Progress; readonly offers: readonly PendingMove[]; readonly changes: readonly QuestChange[]; readonly storyChanged: boolean };

export function storyChange(before: Progress, result: StoryResult, content: BattleContent): StoryChange {
  const taught = learnTeamMoves(before.team, result.progress.team, content);
  return { progress: { ...result.progress, team: taught.team }, offers: taught.offers, changes: result.changes, storyChanged: result.progress.story !== before.story };
}
