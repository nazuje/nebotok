/**
 * Skill levels, as pure functions on a Progress: a skill's level (`skillLevel`), gaining skill XP
 * through the curve in skills.json (`gainSkillXp`), and the `skills` message (`skillsView`).
 */
import type { Progress } from './creatures.ts';
import { MAX_SAVED_SKILLS, type SkillLevel } from './save.ts';
import type { SkillContent } from './skill-content.ts';
import type { SkillsMessage } from './skill-messages.ts';

/** The most XP a save keeps toward one level. */
export const MAX_SKILL_XP = 1_000_000;

/** A spot resting for one player until `until` (a server timestamp in ms). Rests live in the server's memory, never in a save. */
export type SpotRest = { readonly spot: string; readonly until: number };

/** A skill's level and the XP toward the next one; a skill the player has not trained is level 1 with 0 XP. */
export function skillLevel(progress: Pick<Progress, 'skills'>, skill: string): SkillLevel {
  return progress.skills.find((entry) => entry.skill === skill) ?? { skill, level: 1, xp: 0 };
}

/** The XP from `level` to the next one: 0 at `maxLevel`. */
export function skillXpToNext(level: number, content: SkillContent): number {
  return level >= content.maxLevel ? 0 : (content.levelCosts[level - 1] ?? 0);
}

/** What some skill XP did: how much was gained, the level after, and whether that is a new level. */
export type SkillGain = { readonly skill: string; readonly xp: number; readonly level: number; readonly levelUp: boolean };

/**
 * Adds skill XP, levelling up through `levelCosts` as many times as it reaches. At `maxLevel` XP
 * stays at 0. A skill the content does not have gains nothing.
 */
export function gainSkillXp(progress: Progress, skill: string, xp: number, content: SkillContent): { readonly progress: Progress; readonly gain: SkillGain } {
  if (!Number.isInteger(xp) || xp < 0) throw new RangeError(`gainSkillXp() needs a whole, non-negative xp, got ${xp}`);
  const before = skillLevel(progress, skill);
  const known = progress.skills.some((entry) => entry.skill === skill);
  if (!content.skills.has(skill) || xp === 0 || (!known && progress.skills.length >= MAX_SAVED_SKILLS)) return { progress, gain: { skill, xp: 0, level: before.level, levelUp: false } };
  let { level } = before;
  let total = Math.min(before.xp + xp, MAX_SKILL_XP);
  while (level < content.maxLevel && total >= skillXpToNext(level, content)) {
    total -= skillXpToNext(level, content);
    level += 1;
  }
  if (level >= content.maxLevel) total = 0;
  const entry = { skill, level, xp: total };
  const skills = known ? progress.skills.map((each) => (each.skill === skill ? entry : each)) : [...progress.skills, entry];
  return { progress: { ...progress, skills }, gain: { skill, xp, level, levelUp: level > before.level } };
}

/** The `skills` message: every skill of the content in order, and the spots resting for this player at `now`, by spot id. */
export function skillsView(progress: Pick<Progress, 'skills'>, rests: readonly SpotRest[], now: number, content: SkillContent): SkillsMessage {
  const skills = [...content.skills.keys()].map((skill) => {
    const { level, xp } = skillLevel(progress, skill);
    const shown = Math.min(level, content.maxLevel);
    return { skill, level: shown, xp, toNext: Math.max(skillXpToNext(shown, content) - xp, 0) };
  });
  const resting = rests
    .filter((rest) => rest.until > now && content.spots.has(rest.spot))
    .map((rest) => ({ spot: rest.spot, ms: rest.until - now }))
    .toSorted((a, b) => (a.spot < b.spot ? -1 : a.spot > b.spot ? 1 : 0));
  return { skills, resting };
}

/**
 * Skill levels checked against today's content, as a save loads: skills the content no longer has
 * are dropped, and levels above `maxLevel` are held there with 0 XP.
 */
export function pruneSkills(skills: readonly SkillLevel[], content: SkillContent): { readonly skills: SkillLevel[]; readonly dropped: string[] } {
  const dropped = skills.filter((entry) => !content.skills.has(entry.skill)).map((entry) => entry.skill);
  const kept = skills.flatMap((entry) => {
    if (!content.skills.has(entry.skill)) return [];
    return entry.level >= content.maxLevel ? [{ skill: entry.skill, level: content.maxLevel, xp: 0 }] : [entry];
  });
  return { skills: kept, dropped };
}
