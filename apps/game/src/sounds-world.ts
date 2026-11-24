import type { BattleResult, BattleView, BefriendResult, JobChanged, QuestChanged, SkillAttemptMessage, SkillOutcome, StoryContent, TalkNode } from '@nebotok/core';
import { resultLines } from './battle-model.ts';

const QUEST_SOUNDS: Readonly<Record<QuestChanged['change'], string>> = { started: 'world.quest.new', step: 'world.quest.step', done: 'quest.done' };

/** The sound a quest's banner plays as it comes into view: a new quest, a step done, or the fanfare of a quest done. */
export const questSound = (change: Pick<QuestChanged, 'change'>): string => QUEST_SOUNDS[change.change];

/** How each judged outcome of a tiny game is heard; a game cancelled makes no sound. */
const OUTCOME_SOUNDS: Partial<Readonly<Record<SkillOutcome, 'hit' | 'perfect' | 'miss'>>> = { perfect: 'perfect', success: 'hit', miss: 'miss', late: 'miss' };

/** The sound of a tiny game's result, `skill.<game>.<hit|perfect|miss>`, or null for one cancelled. */
export function skillSound(game: SkillAttemptMessage['game'], outcome: SkillOutcome): string | null {
  const heard = OUTCOME_SOUNDS[outcome];
  return heard === undefined ? null : `skill.${game}.${heard}`;
}

/** The sound of a talk's line as it opens: a trainer's challenge, a character giving you something, or none. */
export function talkSound(talk: Pick<TalkNode, 'npc' | 'node'>, content: StoryContent): string | null {
  const nodes = content.dialogue.get(talk.npc)?.nodes;
  const node = nodes && Object.hasOwn(nodes, talk.node) ? nodes[talk.node] : undefined;
  if (!node) return null;
  if (node.fight !== undefined) return 'world.trainer.challenge';
  return (node.effects ?? []).some((effect) => 'give' in effect) ? 'world.item' : null;
}

/**
 * The sound of a battle's result as it shows: the hearts of a creature befriended, else a level up,
 * else none. One sound at a time, so a befriending that also levels a creature up is heard as the hearts.
 */
export function battleEndSound(result: BattleResult, befriended: BefriendResult | null, view: BattleView): string | null {
  const lines = resultLines(result, befriended, view);
  if (lines.some((line) => line.id === 'battle.befriended' || line.id === 'battle.befriendedStored')) return 'world.befriend';
  return lines.some((line) => line.id === 'battle.levelUp') ? 'world.level-up' : null;
}

/** The sound of a job's news: a job done, or none for one only further along. */
export const jobSound = (change: Pick<JobChanged, 'change'>): string | null => (change.change === 'done' ? 'world.job-done' : null);
