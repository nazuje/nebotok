/**
 * Schemas of the story content: the characters (`npcs.json`), what each one says
 * (`dialogue/<npc>.json`), the quests (`quests.json`), the chapters and story flags (`story.json`)
 * and how many of each kind of item fit in one stack (`inventory.json`). The links between these
 * files are checked by `storyProblems` in story.ts; docs/protocol.md explains how talks and quests run.
 */
import { z } from 'zod';
import { ContentId, ITEM_KINDS, LocalizedText, noRepeatedIds } from './content.ts';

/** Moments the client plays as a little scene: `effects/<cue>` in content/art/ is its picture. */
export const STORY_CUES = ['storm-glimpse'] as const;
export type StoryCue = (typeof STORY_CUES)[number];

/** How a character looks while saying a line: a portrait frame (`neutral` when the portrait lacks it) and a hint for their babble. */
export const MOODS = ['calm', 'happy', 'worried', 'surprised'] as const;
export type Mood = (typeof MOODS)[number];

/** A line's speaker that is no character: the story telling itself. */
export const NARRATOR = 'narrator';

/** A node offers at most this many choices. */
export const MAX_CHOICES = 3;
/** A quest has at most this many steps. */
export const MAX_QUEST_STEPS = 10;

const Count = z.number().int().min(1).max(99);
const StoryCueSchema = z.enum(STORY_CUES);

/** A character players talk to. A map's `npcs` layer places them; they never move. */
export const Npc = z.strictObject({
  id: ContentId,
  name: LocalizedText,
  role: LocalizedText,
  /** `pitch` 1 (low) to 5 (high) and `pace` 1 (slow) to 3 (quick): the typewriter's speed now, their babble later. */
  voice: z.strictObject({ pitch: z.number().int().min(1).max(5), pace: z.number().int().min(1).max(3) }),
  /** Stands in until the real story replaces it. */
  placeholder: z.boolean().optional(),
});
export type Npc = z.infer<typeof Npc>;

export const NpcsFile = z.strictObject({ npcs: z.array(Npc).min(1).max(100) }).superRefine(({ npcs }, ctx) => noRepeatedIds(npcs, 'npcs', ctx));
export type NpcsFile = z.infer<typeof NpcsFile>;

/**
 * Something that is true or not for the player now. `is: available` means the quest's `requires`
 * are all done and it has not been started; `at` means the quest is active at that step.
 * `needsStarter` is whether the player has no creature yet. `jobReady` holds when a delivery job
 * to this character is on the player's board and they carry all of it; `jobWaiting` when one is on
 * the board and they do not. `{ skill, level }` holds when that skill is at least that level.
 */
export const Condition = z.union([
  z.strictObject({ quest: ContentId, is: z.enum(['available', 'active', 'done']) }),
  z.strictObject({ quest: ContentId, at: ContentId }),
  z.strictObject({ has: ContentId, count: z.number().int().min(1).max(999).optional() }),
  z.strictObject({ lacks: ContentId }),
  z.strictObject({ flag: ContentId, set: z.boolean() }),
  z.strictObject({ needsStarter: z.boolean() }),
  z.strictObject({ jobReady: z.literal(true) }),
  z.strictObject({ jobWaiting: z.literal(true) }),
  z.strictObject({ skill: ContentId, level: z.number().int().min(1).max(99) }),
]);
export type Condition = z.infer<typeof Condition>;
const Conditions = z.array(Condition).min(1).max(4);

const SetFlag = z.strictObject({ setFlag: ContentId });
const PlayCue = z.strictObject({ cue: StoryCueSchema });

/**
 * What entering a node does. A node's effects happen all together or not at all: one that cannot
 * happen (a quest not available, a step not current, an item the player lacks) stops the node.
 * `offerStarter` lets a player with no creature choose their starter. `deliverJob` hands this
 * character the first delivery job on the board the player carries all of (`deliverJob` in jobs.ts).
 */
export const Effect = z.union([
  z.strictObject({ startQuest: ContentId }),
  z.strictObject({ completeStep: ContentId, step: ContentId }),
  z.strictObject({ give: ContentId, count: Count }),
  z.strictObject({ take: ContentId, count: Count }),
  SetFlag,
  PlayCue,
  z.strictObject({ offerStarter: z.literal(true) }),
  z.strictObject({ deliverJob: z.literal(true) }),
]);
export type Effect = z.infer<typeof Effect>;

/** What finishing a quest step or a whole quest does. */
export const StepEffect = z.union([SetFlag, PlayCue]);
export type StepEffect = z.infer<typeof StepEffect>;

const NodeId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'node ids are short lowercase words, such as "offer"');

/** A choice the player can pick, shown only while its `if` holds. */
export const DialogueChoice = z.strictObject({ say: LocalizedText, next: NodeId, if: Conditions.optional() });
export type DialogueChoice = z.infer<typeof DialogueChoice>;

const cueCount = (node: { cue?: unknown; effects?: readonly Effect[] | undefined }) =>
  (node.cue === undefined ? 0 : 1) + (node.effects ?? []).filter((effect) => 'cue' in effect || 'offerStarter' in effect).length;

/**
 * One line of a talk. After it the talk goes on to `next`, offers `choices`, or ends (neither).
 * `speaker` is an npc id or `narrator`; without it, the character whose file this is speaks.
 */
export const DialogueNode = z
  .strictObject({
    say: LocalizedText,
    speaker: ContentId.optional(),
    mood: z.enum(MOODS).optional(),
    choices: z.array(DialogueChoice).min(1).max(MAX_CHOICES).optional(),
    next: NodeId.optional(),
    effects: z.array(Effect).min(1).max(8).optional(),
    cue: StoryCueSchema.optional(),
  })
  .refine((node) => !(node.choices && node.next), 'a node has choices or next, not both')
  .refine((node) => cueCount(node) <= 1, 'a node plays at most one cue: its cue, one cue effect or offerStarter');
export type DialogueNode = z.infer<typeof DialogueNode>;

/** Where a talk starts: the first entry whose `if` holds. */
export const DialogueEntry = z.strictObject({ if: Conditions.optional(), node: NodeId });
export type DialogueEntry = z.infer<typeof DialogueEntry>;

/** The node ids a node leads to, in order. */
export function nodeTargets(node: DialogueNode): string[] {
  return [...(node.next === undefined ? [] : [node.next]), ...(node.choices ?? []).map((choice) => choice.next)];
}

/** Every node an entry can lead to. */
export function reachableNodes(dialogue: { readonly entries: readonly DialogueEntry[]; readonly nodes: Readonly<Record<string, DialogueNode>> }): Set<string> {
  const reached = new Set<string>();
  const queue = dialogue.entries.map((entry) => entry.node);
  for (let at = 0; at < queue.length; at += 1) {
    const id = queue[at] as string;
    const node = Object.hasOwn(dialogue.nodes, id) ? dialogue.nodes[id] : undefined;
    if (reached.has(id) || !node) continue;
    reached.add(id);
    queue.push(...nodeTargets(node));
  }
  return reached;
}

/**
 * Everything one character says, `content/dialogue/<npc>.json`: one file per character, so each has
 * one owner. Entries are tried in order and only the last has no `if`. Every node an entry or
 * another node names exists, and every node can be reached.
 */
export const DialogueFile = z
  .strictObject({
    npc: ContentId,
    entries: z.array(DialogueEntry).min(1).max(20),
    nodes: z.record(NodeId, DialogueNode),
  })
  .superRefine((dialogue, ctx) => {
    const ids = Object.keys(dialogue.nodes);
    if (ids.length < 1 || ids.length > 100) ctx.addIssue({ code: 'custom', message: `has 1 to 100 nodes, not ${ids.length}`, path: ['nodes'] });
    dialogue.entries.forEach((entry, at) => {
      const last = at === dialogue.entries.length - 1;
      if (last && entry.if) ctx.addIssue({ code: 'custom', message: 'the last entry has no "if", so every talk opens somewhere', path: ['entries', at] });
      if (!last && !entry.if) ctx.addIssue({ code: 'custom', message: 'only the last entry may have no "if"; the entries after it could never open', path: ['entries', at] });
      if (!Object.hasOwn(dialogue.nodes, entry.node)) ctx.addIssue({ code: 'custom', message: `entry opens "${entry.node}", which is not a node`, path: ['entries', at, 'node'] });
    });
    for (const [id, node] of Object.entries(dialogue.nodes)) {
      for (const target of nodeTargets(node)) {
        if (!Object.hasOwn(dialogue.nodes, target)) ctx.addIssue({ code: 'custom', message: `node "${id}" leads to "${target}", which is not a node`, path: ['nodes', id] });
      }
    }
    const reached = reachableNodes(dialogue);
    for (const id of ids) if (!reached.has(id)) ctx.addIssue({ code: 'custom', message: `node "${id}" cannot be reached from any entry`, path: ['nodes', id] });
  });
export type DialogueFile = z.infer<typeof DialogueFile>;

/** Dialogue files are `content/dialogue/<npc>.json`. */
export const DIALOGUE_FILE = /^dialogue\/([a-z][a-z0-9-]*)\.json$/;

/** The schema of `dialogue/<npc>.json`: a dialogue file whose `npc` is the one its name says. */
export function dialogueFile(npc: string): z.ZodType {
  return DialogueFile.refine((dialogue) => dialogue.npc === npc, `this is dialogue/${npc}.json, so its npc must be "${npc}"`);
}

const stepBase = { id: ContentId, hint: LocalizedText, effects: z.array(StepEffect).min(1).max(4).optional() };

/**
 * One step of a quest. `talk` and `deliver` steps are completed by a dialogue node of their
 * character (`completeStep`); the others count events from the moment the step begins: battles
 * won (in `zone`, or anywhere), creatures befriended (of `species` or `type`, or any), a rest at
 * `shrine`, reaching the map mark `mark`, `item`s gathered (a perfect counts 2), `treat`s cooked,
 * or jobs from the board finished.
 */
export const QuestStep = z.discriminatedUnion('kind', [
  z.strictObject({ ...stepBase, kind: z.literal('talk'), npc: ContentId }),
  z.strictObject({ ...stepBase, kind: z.literal('deliver'), item: ContentId, count: Count, to: ContentId }),
  z.strictObject({ ...stepBase, kind: z.literal('winBattles'), count: Count, zone: ContentId.optional() }),
  z.strictObject({ ...stepBase, kind: z.literal('befriend'), count: Count, species: ContentId.optional(), type: ContentId.optional() }),
  z.strictObject({ ...stepBase, kind: z.literal('visitShrine'), shrine: ContentId }),
  z.strictObject({ ...stepBase, kind: z.literal('reach'), mark: ContentId }),
  z.strictObject({ ...stepBase, kind: z.literal('gather'), item: ContentId, count: Count }),
  z.strictObject({ ...stepBase, kind: z.literal('cook'), treat: ContentId, count: Count }),
  z.strictObject({ ...stepBase, kind: z.literal('finishJobs'), count: Count }),
]);
export type QuestStep = z.infer<typeof QuestStep>;

/** Items for the bag, experience for every team creature and, optionally, skill XP, given when the last step is done. */
export const QuestRewardsSchema = z.strictObject({
  items: z.array(z.strictObject({ item: ContentId, count: Count })).max(5),
  xp: z.number().int().min(0).max(10_000),
  skills: z
    .array(z.strictObject({ skill: ContentId, xp: z.number().int().min(1).max(10_000) }))
    .max(3)
    .refine((entries) => new Set(entries.map((entry) => entry.skill)).size === entries.length, 'each skill appears once')
    .optional(),
});

/**
 * A quest: given by `giver` once every quest in `requires` is done, its `steps` done one after
 * another, each quest once per player. It sits in the chapter `chapter` of story.json.
 */
export const Quest = z
  .strictObject({
    id: ContentId,
    chapter: ContentId,
    giver: ContentId,
    requires: z.array(ContentId).max(10),
    placeholder: z.boolean().optional(),
    name: LocalizedText,
    summary: LocalizedText,
    steps: z.array(QuestStep).min(1).max(MAX_QUEST_STEPS),
    rewards: QuestRewardsSchema,
    effects: z.array(StepEffect).max(4),
  })
  .superRefine((quest, ctx) => {
    noRepeatedIds(quest.steps, 'steps', ctx);
    if (quest.requires.includes(quest.id)) ctx.addIssue({ code: 'custom', message: 'a quest cannot require itself', path: ['requires'] });
    if (new Set(quest.requires).size !== quest.requires.length) ctx.addIssue({ code: 'custom', message: 'each required quest appears once', path: ['requires'] });
  });
export type Quest = z.infer<typeof Quest>;

/** The quests that a chain of `requires` leads back to. */
function requiresCycle(quests: readonly Quest[]): string[] {
  const byId = new Map(quests.map((quest) => [quest.id, quest]));
  const state = new Map<string, 'open' | 'closed'>();
  const looped = new Set<string>();
  const visit = (id: string): void => {
    if (state.get(id) === 'closed') return;
    if (state.get(id) === 'open') {
      looped.add(id);
      return;
    }
    state.set(id, 'open');
    for (const next of byId.get(id)?.requires ?? []) visit(next);
    state.set(id, 'closed');
  };
  for (const quest of quests) visit(quest.id);
  return [...looped].toSorted();
}

export const QuestsFile = z.strictObject({ quests: z.array(Quest).min(1).max(200) }).superRefine(({ quests }, ctx) => {
  noRepeatedIds(quests, 'quests', ctx);
  const known = new Set(quests.map((quest) => quest.id));
  quests.forEach((quest, at) => {
    for (const id of quest.requires) if (!known.has(id)) ctx.addIssue({ code: 'custom', message: `"${quest.id}" requires "${id}", which is not a quest`, path: ['quests', at, 'requires'] });
  });
  for (const id of requiresCycle(quests)) ctx.addIssue({ code: 'custom', message: `"${id}" requires itself through other quests`, path: ['quests'] });
});
export type QuestsFile = z.infer<typeof QuestsFile>;

/**
 * A chapter of the story: its quests, in the order the journal lists them, and the flag that marks
 * it finished. A `side` chapter stands beside the main story: it comes after the main chapters,
 * and `nextGoal` offers it only when the main story has nothing for the player.
 */
export const Chapter = z.strictObject({ id: ContentId, name: LocalizedText, quests: z.array(ContentId).min(1).max(50), endsWith: ContentId.optional(), side: z.literal(true).optional() });
export type Chapter = z.infer<typeof Chapter>;

/** A story flag, set once for a player and never unset. `about` is a note for authors; players never see it. */
export const StoryFlag = z.strictObject({ id: ContentId, about: z.string().trim().min(1).max(200) });
export type StoryFlag = z.infer<typeof StoryFlag>;

/** The chapters in order, and every story flag, declared so that a typo in a flag fails validation. */
export const StoryFile = z
  .strictObject({ chapters: z.array(Chapter).min(1).max(20), flags: z.array(StoryFlag).max(500) })
  .superRefine(({ chapters, flags }, ctx) => {
    noRepeatedIds(chapters, 'chapters', ctx);
    noRepeatedIds(flags, 'flags', ctx);
    const listed = chapters.flatMap((chapter) => chapter.quests);
    listed.forEach((id, at) => {
      if (listed.indexOf(id) !== at) ctx.addIssue({ code: 'custom', message: `quest "${id}" is in more than one chapter, or twice in one`, path: ['chapters'] });
    });
    chapters.forEach((chapter, at) => {
      if (!chapter.side && chapters.slice(0, at).some((before) => before.side)) ctx.addIssue({ code: 'custom', message: `main chapter "${chapter.id}" comes after a side chapter; side chapters come last`, path: ['chapters', at] });
    });
    if (chapters.every((chapter) => chapter.side)) ctx.addIssue({ code: 'custom', message: 'the story needs a main chapter, not only side ones', path: ['chapters'] });
  });
export type StoryFile = z.infer<typeof StoryFile>;

/** How many of one item fit in a stack of the bag; extra is not taken. The save allows 999 at most. */
const KindRule = z.strictObject({ stack: z.number().int().min(1).max(999) });

/** The bag's rules for each item kind (ITEM_KINDS in content.ts), and the order its sections show in. */
export const InventoryFile = z
  .strictObject({
    kinds: z.strictObject({ quest: KindRule, treat: KindRule, ingredient: KindRule, material: KindRule }),
    order: z.array(z.enum(ITEM_KINDS)).length(ITEM_KINDS.length),
  })
  .refine(({ order }) => new Set(order).size === order.length, 'order lists each kind once');
export type InventoryFile = z.infer<typeof InventoryFile>;
