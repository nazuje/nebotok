/**
 * Quest rules, pure functions on a Progress: starting a quest, completing its steps (by dialogue,
 * `completeStep`, or by counting events, `questEvent`), its rewards, the journal (`questLog`), the
 * marks over characters (`npcMarks`) and what to do next (`nextGoal`). docs/protocol.md explains
 * how the server sends what changed.
 */
import { needsStarter, type Progress } from './creatures.ts';
import { jobReady } from './deliveries.ts';
import { gainXp } from './growth.ts';
import { giveItems, type ItemCount } from './inventory.ts';
import type { CreatureReward } from './messages.ts';
import { MAX_ACTIVE_QUESTS, MAX_STORY_IDS, type QuestProgress, type StoryProgress } from './save.ts';
import { gainSkillXp, type SkillGain } from './skills.ts';
import type { StoryContent } from './story.ts';
import type { Quest, QuestStep, StepEffect, StoryCue } from './story-content.ts';

/** Where a player stands with a quest: `available` once every quest it requires is done. */
export type QuestState = 'locked' | 'available' | 'active' | 'done';

export function questState(story: StoryProgress, quest: Quest): QuestState {
  if (story.done.includes(quest.id)) return 'done';
  if (story.active.some((entry) => entry.quest === quest.id)) return 'active';
  return quest.requires.every((id) => story.done.includes(id)) ? 'available' : 'locked';
}

/** The step a player is on in an active quest, or null. */
export function currentStep(story: StoryProgress, quest: Quest): { readonly step: QuestStep; readonly entry: QuestProgress } | null {
  const entry = story.active.find((candidate) => candidate.quest === quest.id);
  const step = entry ? quest.steps[entry.step] : undefined;
  return entry && step ? { step, entry } : null;
}

/** What finishing a quest gave: items in the bag, what did not fit, the experience each team creature got, and the skills' XP and levels after. */
export type QuestRewards = {
  readonly items: readonly ItemCount[];
  readonly extra: readonly ItemCount[];
  readonly xp: number;
  readonly creatures: readonly CreatureReward[];
  readonly skills: readonly SkillGain[];
};

/**
 * `quest.changed`: a quest started, moved to its next step (`step` is the index of the step now
 * current), or was done (`step` is its number of steps, and `rewards` what it gave). `cue` is a
 * scene to play.
 */
export type QuestChange = {
  readonly quest: string;
  readonly change: 'started' | 'step' | 'done';
  readonly step: number;
  readonly rewards: QuestRewards | null;
  readonly cue: StoryCue | null;
};

/** A Progress after a quest rule, the quests that changed in order, and items that did not fit in the bag. */
export type QuestResult = { readonly progress: Progress; readonly changes: readonly QuestChange[]; readonly extra: readonly ItemCount[] };

function questOf(content: StoryContent, id: string): Quest | null {
  return content.quests.get(id) ?? null;
}

/** The story with each of these flags set once. Flags are never unset. */
function withFlags(story: StoryProgress, effects: readonly StepEffect[]): StoryProgress {
  const flags = [...story.flags];
  for (const effect of effects) if ('setFlag' in effect && !flags.includes(effect.setFlag) && flags.length < MAX_STORY_IDS) flags.push(effect.setFlag);
  return { ...story, flags };
}

const cueOf = (effects: readonly StepEffect[] | undefined): StoryCue | null => {
  const found = (effects ?? []).find((effect) => 'cue' in effect);
  return found && 'cue' in found ? found.cue : null;
};

/** Starts a quest at its first step. Null unless it is available and the player has room for another. */
export function startQuest(progress: Progress, id: string, content: StoryContent): QuestResult | null {
  const quest = questOf(content, id);
  if (!quest || questState(progress.story, quest) !== 'available' || progress.story.active.length >= MAX_ACTIVE_QUESTS) return null;
  const story = { ...progress.story, active: [...progress.story.active, { quest: id, step: 0, count: 0 }] };
  return { progress: { ...progress, story }, changes: [{ quest: id, change: 'started', step: 0, rewards: null, cue: null }], extra: [] };
}

/**
 * Gives a finished quest's rewards: its items, within stack limits, its experience to every team
 * creature (fainted ones too, whose health stays 0) and its skill XP. Learning the moves a level up
 * teaches is the server's part, as after a battle (`learnTeamMoves`).
 */
export function questRewards(progress: Progress, quest: Quest, content: StoryContent): { readonly progress: Progress; readonly rewards: QuestRewards } {
  const gift = giveItems(progress, quest.rewards.items, content);
  const creatures: CreatureReward[] = [];
  const team = gift.progress.team.map((creature, index) => {
    if (quest.rewards.xp === 0) return creature;
    const grown = gainXp(creature, quest.rewards.xp, content.battle);
    creatures.push({ index, xp: quest.rewards.xp, level: grown.level });
    return grown;
  });
  let progressed: Progress = { ...gift.progress, team };
  const skills: SkillGain[] = [];
  for (const { skill, xp } of quest.rewards.skills ?? []) {
    if (!content.skills) break;
    const grown = gainSkillXp(progressed, skill, xp, content.skills);
    progressed = grown.progress;
    skills.push(grown.gain);
  }
  return { progress: progressed, rewards: { items: gift.given, extra: gift.extra, xp: quest.rewards.xp, creatures, skills } };
}

/** Moves an active quest past its current step: to the next one, or to done with its rewards. */
function finishStep(progress: Progress, quest: Quest, entry: QuestProgress, step: QuestStep, content: StoryContent): QuestResult {
  const next = entry.step + 1;
  const story = withFlags(progress.story, step.effects ?? []);
  if (next < quest.steps.length) {
    const active = story.active.map((candidate) => (candidate.quest === quest.id ? { quest: quest.id, step: next, count: 0 } : candidate));
    return { progress: { ...progress, story: { ...story, active } }, changes: [{ quest: quest.id, change: 'step', step: next, rewards: null, cue: cueOf(step.effects) }], extra: [] };
  }
  const finished = withFlags({ ...story, active: story.active.filter((candidate) => candidate.quest !== quest.id), done: [...story.done, quest.id] }, quest.effects);
  const rewarded = questRewards({ ...progress, story: finished }, quest, content);
  const change: QuestChange = { quest: quest.id, change: 'done', step: quest.steps.length, rewards: rewarded.rewards, cue: cueOf(step.effects) ?? cueOf(quest.effects) };
  return { progress: rewarded.progress, changes: [change], extra: rewarded.rewards.extra };
}

/** Completes a quest's current step from dialogue. Null unless the quest is active at exactly that step. */
export function completeStep(progress: Progress, id: string, stepId: string, content: StoryContent): QuestResult | null {
  const quest = questOf(content, id);
  const current = quest ? currentStep(progress.story, quest) : null;
  if (!quest || !current || current.step.id !== stepId) return null;
  return finishStep(progress, quest, current.entry, current.step, content);
}

/** Something that happened in the world that a quest step may count. */
export type QuestEvent =
  | { readonly kind: 'battleWon'; readonly zone: string | null }
  | { readonly kind: 'befriended'; readonly species: string }
  | { readonly kind: 'rested'; readonly shrine: string }
  | { readonly kind: 'reached'; readonly mark: string }
  | { readonly kind: 'gathered' | 'cooked'; readonly item: string; readonly count: number }
  | { readonly kind: 'jobDone' };

/** How many events a step needs: its count for battles, befriending, gathering, cooking and jobs, else 1 (talk and deliver steps are done by dialogue). */
export function stepTarget(step: QuestStep): number {
  return 'count' in step && step.kind !== 'deliver' ? step.count : 1;
}

/** How much an event counts for a step: 0 when it is not for that step, and a gather or cook counts each item. */
function counts(step: QuestStep, event: QuestEvent, content: StoryContent): number {
  if (step.kind === 'winBattles') return Number(event.kind === 'battleWon' && (step.zone === undefined || step.zone === event.zone));
  if (step.kind === 'befriend') {
    if (event.kind !== 'befriended') return 0;
    return Number((step.species === undefined || step.species === event.species) && (step.type === undefined || content.battle.species.get(event.species)?.type === step.type));
  }
  if (step.kind === 'visitShrine') return Number(event.kind === 'rested' && step.shrine === event.shrine);
  if (step.kind === 'reach') return Number(event.kind === 'reached' && step.mark === event.mark);
  if (step.kind === 'gather') return event.kind === 'gathered' && event.item === step.item ? event.count : 0;
  if (step.kind === 'cook') return event.kind === 'cooked' && event.item === step.treat ? event.count : 0;
  if (step.kind === 'finishJobs') return Number(event.kind === 'jobDone');
  return 0;
}

/**
 * Counts an event for every active quest whose current step it is for, in the order the quests
 * were started. A step is done once its count is reached (a rest or a mark at once); the event
 * does not count again for the step after.
 */
export function questEvent(progress: Progress, event: QuestEvent, content: StoryContent): QuestResult {
  let next = progress;
  const changes: QuestChange[] = [];
  const extra: ItemCount[] = [];
  for (const { quest: id } of progress.story.active) {
    const quest = questOf(content, id);
    const current = quest ? currentStep(next.story, quest) : null;
    const amount = current ? counts(current.step, event, content) : 0;
    if (!quest || !current || amount <= 0) continue;
    const target = stepTarget(current.step);
    const count = Math.min(current.entry.count + amount, target);
    if (count >= target) {
      const done = finishStep(next, quest, current.entry, current.step, content);
      next = done.progress;
      changes.push(...done.changes);
      extra.push(...done.extra);
    } else {
      const active = next.story.active.map((entry) => (entry.quest === id ? { ...entry, count } : entry));
      next = { ...next, story: { ...next.story, active } };
    }
  }
  return { progress: next, changes, extra };
}

/** Every quest in story order: chapter by chapter, each chapter's quests in its order; with `side`, only the main or only the side chapters'. */
function questsInOrder(content: StoryContent, side?: boolean): Quest[] {
  return content.chapters.filter((chapter) => side === undefined || (chapter.side === true) === side).flatMap((chapter) => chapter.quests.flatMap((id) => content.quests.get(id) ?? []));
}

/** One quest in the journal: `step` and `count` are where an active one stands, `of` what its step needs (`stepTarget`). */
export type QuestLogEntry = { readonly quest: string; readonly state: 'active' | 'done'; readonly step: number; readonly count: number; readonly of: number };
/** The journal: each chapter the player has begun, with the quests they started, and what to do next. */
export type QuestLog = { readonly chapters: readonly { readonly chapter: string; readonly done: boolean; readonly quests: readonly QuestLogEntry[] }[]; readonly next: Goal | null };

export function questLog(progress: Progress, content: StoryContent): QuestLog {
  const { story } = progress;
  const chapters = content.chapters.flatMap((chapter) => {
    const quests = chapter.quests.flatMap((id): QuestLogEntry[] => {
      const quest = content.quests.get(id);
      if (!quest) return [];
      if (story.done.includes(id)) return [{ quest: id, state: 'done', step: quest.steps.length, count: 0, of: 0 }];
      const current = currentStep(story, quest);
      if (!current) return [];
      return [{ quest: id, state: 'active', step: current.entry.step, count: current.entry.count, of: stepTarget(current.step) }];
    });
    const done = chapter.quests.every((id) => story.done.includes(id)) && (chapter.endsWith === undefined || story.flags.includes(chapter.endsWith));
    return quests.length > 0 ? [{ chapter: chapter.id, done, quests }] : [];
  });
  return { chapters, next: nextGoal(progress, content) };
}

/** A mark over a character: `turnIn` when a quest's current step is to talk to them or bring them something, or the player carries all of a delivery job to them; `newQuest` when they have one to give. */
export type NpcMark = { readonly npc: string; readonly mark: 'turnIn' | 'newQuest' };

/** The marks over characters, in npcs.json order. A character with nothing for the player has none. */
export function npcMarks(progress: Progress, content: StoryContent): NpcMark[] {
  const quests = questsInOrder(content);
  const turnIn = new Set<string>();
  const newQuest = new Set<string>();
  for (const quest of quests) {
    const state = questState(progress.story, quest);
    const step = state === 'active' ? currentStep(progress.story, quest)?.step : undefined;
    if (step?.kind === 'talk') turnIn.add(step.npc);
    if (step?.kind === 'deliver') turnIn.add(step.to);
    if (state === 'available' && !needsStarter(progress)) newQuest.add(quest.giver);
  }
  return [...content.npcs.keys()].flatMap((npc): NpcMark[] => {
    if (turnIn.has(npc) || jobReady(progress, npc)) return [{ npc, mark: 'turnIn' }];
    return newQuest.has(npc) ? [{ npc, mark: 'newQuest' }] : [];
  });
}

/**
 * What the player should do next, for the journal's "where next" and for bots: choose a starter
 * (from the character whose dialogue offers it), the current step of the first active quest in
 * story order (with how many it still needs), or to collect the first available quest from its
 * giver. Side chapters come in only when the main story has nothing for the player. Null when
 * there is nothing left for now.
 */
export type Goal =
  | { readonly kind: 'starter'; readonly npc: string }
  | { readonly kind: 'step'; readonly quest: string; readonly step: QuestStep; readonly left: number }
  | { readonly kind: 'newQuest'; readonly quest: string; readonly npc: string };

export function nextGoal(progress: Progress, content: StoryContent): Goal | null {
  if (needsStarter(progress)) {
    const npc = [...content.dialogue].find(([, dialogue]) => Object.values(dialogue.nodes).some((node) => (node.effects ?? []).some((effect) => 'offerStarter' in effect)))?.[0];
    return npc === undefined ? null : { kind: 'starter', npc };
  }
  return goalAmong(progress, questsInOrder(content, false)) ?? goalAmong(progress, questsInOrder(content, true));
}

/** The current step of the first active quest of `quests`, else the first available one. */
function goalAmong(progress: Progress, quests: readonly Quest[]): Goal | null {
  for (const quest of quests) {
    const current = currentStep(progress.story, quest);
    if (current) return { kind: 'step', quest: quest.id, step: current.step, left: stepTarget(current.step) - current.entry.count };
  }
  const available = quests.find((quest) => questState(progress.story, quest) === 'available');
  return available ? { kind: 'newQuest', quest: available.id, npc: available.giver } : null;
}
