/**
 * What the job board may ask of a player now: whether a template fits their levels (`jobFits`),
 * whether they can get an item at today's levels (`canGetNow`) and how many a job asks for at
 * their level (`jobCount`). Shared by the draws in jobs.ts and the content checks in skill-links.ts.
 */
import type { Progress } from './creatures.ts';
import { recipeSkill, type JobTemplate, type SkillContent } from './skill-content.ts';
import { skillLevel } from './skills.ts';

/**
 * Whether the player can get `item` at today's levels: a spot of theirs gives it, or they can cook
 * it from ingredients they can gather. A job is drawn only when its item is, so every job on the
 * board can be done now, whatever its template's `needs` say about the other skills.
 */
export function canGetNow(progress: Pick<Progress, 'skills'>, item: string, content: SkillContent): boolean {
  const reached = (skill: string, level: number) => skillLevel(progress, skill).level >= level;
  const gathered = (wanted: string) => [...content.spots.values()].some((spot) => spot.item === wanted && reached(spot.skill, spot.level));
  if (gathered(item)) return true;
  const cook = recipeSkill(content);
  return cook !== null && [...content.recipes.values()].some((recipe) => recipe.makes === item && reached(cook.id, recipe.level) && recipe.ingredients.every((entry) => gathered(entry.item)));
}

/** How many of its item a job asks for: `rolled` from its template's `count` range, grown by the player's `level` in the skill it needs (`countGrowth`). */
export function jobCount(rolled: number, level: number, content: SkillContent): number {
  const growth = content.countGrowth;
  if (!growth) return rolled;
  return Math.floor((rolled * (100 + growth.percentPerLevel * Math.max(0, level - growth.afterLevel))) / 100);
}

/**
 * Whether the board may draw `template` for the player: their skill is at the level it needs and not
 * `outgrownAfter` levels past it, and they can get its item now (`canGetNow`).
 */
export function jobFits(progress: Pick<Progress, 'skills'>, template: JobTemplate, content: SkillContent): boolean {
  const level = skillLevel(progress, template.needs.skill).level;
  const outgrown = content.outgrownAfter !== null && level >= template.needs.level + content.outgrownAfter;
  return level >= template.needs.level && !outgrown && canGetNow(progress, template.item, content);
}
