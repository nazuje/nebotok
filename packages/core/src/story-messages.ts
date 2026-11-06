/**
 * Payloads of the talking, quest and bag messages: zod schemas for what a client sends (the server
 * validates each with them) and types for what the server sends. The type names are in
 * CLIENT_MESSAGES and SERVER_MESSAGES (protocol.ts); docs/protocol.md, "Talking, quests and the
 * bag", explains the flow. Text never travels: the client bundles content/ and looks words up by id.
 */
import { z } from 'zod';
import { ContentId } from './content.ts';
import { conversationView, type Conversation, type TalkCue } from './dialogue.ts';
import type { Progress } from './creatures.ts';
import type { QuestChange } from './quests.ts';
import type { StoryProgress } from './save.ts';
import type { StoryContent } from './story.ts';
import { MAX_CHOICES } from './story-content.ts';

/** The server's number for one talk, so an answer cannot land on a later one. */
export const ConversationId = z.number().int().min(1).max(2 ** 31 - 1);

/** Start talking to the character `npc`, standing next to it (`npcInReach` in map.ts). */
export const TalkStartMessage = z.strictObject({ npc: ContentId });
export type TalkStartMessage = z.infer<typeof TalkStartMessage>;

/** Go on in talk `conversation`: `choice` is one of the shown `choices` of `talk.node`, or null to continue (or end) a node without choices. */
export const TalkNextMessage = z.strictObject({ conversation: ConversationId, choice: z.number().int().min(0).max(MAX_CHOICES - 1).nullable() });
export type TalkNextMessage = z.infer<typeof TalkNextMessage>;

/** Walk away from talk `conversation`. Nothing the node after would do happens. */
export const TalkEndMessage = z.strictObject({ conversation: ConversationId });
export type TalkEndMessage = z.infer<typeof TalkEndMessage>;

/** `story`: the player's whole story, sent on joining and after any change. */
export type StoryMessage = StoryProgress;

/**
 * `talk.node`: the player is at `node` of `dialogue/<npc>.json`. `choices` are the places in the
 * node's `choices` to show, in order (empty: continue with null). `cue` is a scene to play, or
 * `offerStarter` for the starter screen.
 */
export type TalkNode = { readonly conversation: number; readonly npc: string; readonly node: string; readonly choices: readonly number[]; readonly cue: TalkCue | null };

/** `talk.ended`: talk `conversation` is over, ended by its last node, `talk.end`, a node that could not happen, or the server. */
export type TalkEnded = { readonly conversation: number };

/** `quest.changed`: see `QuestChange` in quests.ts. */
export type QuestChanged = QuestChange;

/** The `talk.node` for a conversation, or null when its node no longer exists. */
export function talkNodeMessage(id: number, conversation: Conversation, progress: Progress, content: StoryContent): TalkNode | null {
  const view = conversationView(conversation, progress, content);
  return view ? { conversation: id, npc: view.npc, node: view.node, choices: view.choices, cue: view.cue } : null;
}
