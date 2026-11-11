/**
 * A steady player on the skill content, to tune the curve: `simulateSkill` gathers at the best spot
 * of a skill that is ready (waiting for the first rest to end otherwise), or cooks the best recipe
 * it knows, and records the minutes to each level. `node scripts/skill-sim.mjs` prints the table.
 */
import { emptyProgress, type Progress } from './creatures.ts';
import { cookResult, gatherResult } from './gathering.ts';
import { giveItems } from './inventory.ts';
import { createRng, type Rng } from './rng.ts';
import type { Recipe, Spot } from './skill-content.ts';
import { skillLevel } from './skills.ts';
import type { StoryContent } from './story.ts';

export type SkillSimOptions = {
  /** One gather: walking to the spot, the game and the result. */
  readonly gatherMs: number;
  /** One cook at the pot. */
  readonly cookMs: number;
  /** Gathering one ingredient a successful cook used up. */
  readonly ingredientMs: number;
  /** How often an attempt succeeds. */
  readonly successPercent: number;
  /** The simulation gives up after this long. */
  readonly limitMinutes: number;
};

export const SKILL_SIM_DEFAULTS: SkillSimOptions = { gatherMs: 12_000, cookMs: 12_000, ingredientMs: 14_000, successPercent: 85, limitMinutes: 600 };

/** The minutes from level 1 to each level reached, from level 2 on. */
export type SkillSimRun = { readonly skill: string; readonly minutes: readonly number[] };

type Step = { readonly progress: Progress; readonly now: number; readonly rest: { readonly spot: string; readonly until: number } | null };

const MINUTE_MS = 60_000;

/** The best of `choices` by XP; the first in file order on a tie. */
function best<T extends { readonly xp: number }>(choices: readonly T[]): T | undefined {
  return choices.reduce<T | undefined>((top, each) => (top === undefined || each.xp > top.xp ? each : top), undefined);
}

function gatherStep(progress: Progress, spots: readonly Spot[], rests: ReadonlyMap<string, number>, now: number, rng: Rng, options: SkillSimOptions, content: StoryContent): Step {
  const level = skillLevel(progress, spots[0]?.skill ?? '').level;
  const open = spots.filter((spot) => spot.level <= level);
  const ready = best(open.filter((spot) => (rests.get(spot.id) ?? 0) <= now));
  if (!ready) return { progress, now: Math.min(...open.map((spot) => rests.get(spot.id) ?? 0)), rest: null };
  const done = now + options.gatherMs;
  const result = gatherResult(progress, ready.id, rng.int(1, 100) <= options.successPercent ? 'success' : 'miss', done, content);
  return { progress: { ...result.progress, inventory: [] }, now: done, rest: result.rest };
}

function cookStep(progress: Progress, recipes: readonly Recipe[], skill: string, now: number, rng: Rng, options: SkillSimOptions, content: StoryContent): Step {
  const level = skillLevel(progress, skill).level;
  const recipe = best(recipes.filter((each) => each.level <= level));
  if (!recipe) throw new RangeError(`no recipe of ${skill} at level ${level}`);
  const done = now + options.cookMs;
  if (rng.int(1, 100) > options.successPercent) return { progress, now: done, rest: null };
  const stocked = giveItems(progress, recipe.ingredients, content).progress;
  const result = cookResult(stocked, recipe.id, 'success', content);
  const gathering = recipe.ingredients.reduce((sum, { count }) => sum + count, 0) * options.ingredientMs;
  return { progress: { ...result.progress, inventory: [] }, now: done + gathering, rest: null };
}

/** One steady player training `skill` alone from level 1, until the top level or the time limit. */
export function simulateSkill(skill: string, content: StoryContent, rng: Rng, options: SkillSimOptions = SKILL_SIM_DEFAULTS): SkillSimRun {
  const skills = content.skills;
  const found = skills?.skills.get(skill);
  if (!skills || !found) throw new RangeError(`unknown skill "${skill}"`);
  const spots = [...skills.spots.values()].filter((spot) => spot.skill === skill);
  const recipes = [...skills.recipes.values()];
  const rests = new Map<string, number>();
  const minutes: number[] = [];
  let progress = emptyProgress();
  let now = 0;
  while (skillLevel(progress, skill).level < skills.maxLevel && now < options.limitMinutes * MINUTE_MS) {
    const before = skillLevel(progress, skill).level;
    const step = found.uses === 'spots' ? gatherStep(progress, spots, rests, now, rng, options, content) : cookStep(progress, recipes, skill, now, rng, options, content);
    ({ progress, now } = step);
    if (step.rest) rests.set(step.rest.spot, step.rest.until);
    for (let level = before + 1; level <= skillLevel(progress, skill).level; level += 1) minutes.push(now / MINUTE_MS);
  }
  return { skill, minutes };
}

/** Each skill of the content in order, averaged over `runs` players seeded `skill-sim:<n>`: the minutes to each level, from level 2 on. */
export function simulateSkills(content: StoryContent, runs: number, options: SkillSimOptions = SKILL_SIM_DEFAULTS): SkillSimRun[] {
  return [...(content.skills?.skills.keys() ?? [])].map((skill) => {
    const all = Array.from({ length: runs }, (_, at) => simulateSkill(skill, content, createRng(`skill-sim:${at}`), options).minutes);
    const levels = Math.min(...all.map((each) => each.length));
    return { skill, minutes: Array.from({ length: levels }, (_, at) => all.reduce((sum, each) => sum + (each[at] ?? 0), 0) / runs) };
  });
}
