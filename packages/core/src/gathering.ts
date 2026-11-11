/**
 * Gathering at spots and cooking at a pot, as pure functions on a Progress: whether a start is
 * refused (`gatherRefusal`, `cookRefusal`), what a judged attempt gives (`gatherResult`,
 * `cookResult`) and the recipe book (`recipeBook`). The server keeps the spots' rests and the
 * attempts; docs/protocol.md, "Skills and the job board", explains the flow.
 */
import type { AttemptOutcome } from './attempts.ts';
import { itemCount, type Progress } from './creatures.ts';
import { giveItems, takeItems, type ItemCount } from './inventory.ts';
import type { RefusalReason } from './messages.ts';
import { recipeSkill, type Recipe, type Skill, type Spot } from './skill-content.ts';
import { gainSkillXp, skillLevel, type SpotRest } from './skills.ts';
import type { StoryContent } from './story.ts';

/** What the server knows about a start besides the Progress: whether the player is busy, whether they stand next to the spot or pot, and the rests now. */
export type StartCheck = { readonly busy: boolean; readonly inReach: boolean; readonly rests: readonly SpotRest[]; readonly now: number };

/** Why a start is refused, from the reasons in messages.ts. */
export type SkillRefusal = Extract<RefusalReason, 'notNow' | 'tooFar' | 'needsLevel' | 'resting' | 'bagFull' | 'noItem' | 'invalid'>;

/** What a judged attempt did: `items` that went into the bag, `used` ingredients, `extra` that did not fit, the skill's XP and level after, and the rest it started. */
export type SkillResult = {
  readonly progress: Progress;
  readonly items: readonly ItemCount[];
  readonly used: readonly ItemCount[];
  readonly extra: readonly ItemCount[];
  readonly skill: string;
  readonly xp: number;
  readonly level: number;
  readonly levelUp: boolean;
  readonly rest: SpotRest | null;
};

/** The spot and its skill, when both exist and the skill gathers at spots. */
function spotOf(id: string, content: StoryContent): { readonly spot: Spot; readonly skill: Skill & { readonly uses: 'spots' } } | null {
  const spot = content.skills?.spots.get(id);
  const skill = spot ? content.skills?.skills.get(spot.skill) : undefined;
  return spot && skill?.uses === 'spots' ? { spot, skill } : null;
}

/** Whether one more of `item` fits in the bag. */
const hasRoomFor = (progress: Progress, item: string, content: StoryContent) => giveItems(progress, [{ item, count: 1 }], content).given.length > 0;

/**
 * Why gathering at `spot` cannot start, checked in this order: an unknown spot, busy, not next to
 * it, too low a level, the spot resting for this player, or a full stack of its item. Null when it can.
 */
export function gatherRefusal(progress: Progress, spot: string, check: StartCheck, content: StoryContent): SkillRefusal | null {
  const found = spotOf(spot, content);
  if (!found) return 'invalid';
  if (check.busy) return 'notNow';
  if (!check.inReach) return 'tooFar';
  if (skillLevel(progress, found.spot.skill).level < found.spot.level) return 'needsLevel';
  if (check.rests.some((rest) => rest.spot === spot && rest.until > check.now)) return 'resting';
  return hasRoomFor(progress, found.spot.item, content) ? null : 'bagFull';
}

/** What an attempt that gave nothing did: a miss, a `late` or a `cancelled` one. */
export function nothingGained(progress: Progress, skill: string): SkillResult {
  return { progress, items: [], used: [], extra: [], skill, xp: 0, level: skillLevel(progress, skill).level, levelUp: false, rest: null };
}

/**
 * What gathering at `spot` gave: on a success one of its item (two on a perfect, within the stack)
 * and its XP, and the spot rests for this player from `now`. A miss gives nothing and rests nothing.
 */
export function gatherResult(progress: Progress, spot: string, outcome: AttemptOutcome, now: number, content: StoryContent): SkillResult {
  const found = spotOf(spot, content);
  if (!found || !content.skills) throw new RangeError(`unknown spot "${spot}"`);
  if (outcome === 'miss') return nothingGained(progress, found.spot.skill);
  const gift = giveItems(progress, [{ item: found.spot.item, count: outcome === 'perfect' ? 2 : 1 }], content);
  const grown = gainSkillXp(gift.progress, found.spot.skill, found.spot.xp, content.skills);
  const rest = { spot, until: now + found.skill.restSeconds * 1_000 };
  return { progress: grown.progress, items: gift.given, used: [], extra: gift.extra, skill: found.spot.skill, xp: grown.gain.xp, level: grown.gain.level, levelUp: grown.gain.levelUp, rest };
}

/** The recipe, the cooking skill, and whether `station` is a cooking pot. */
function recipeOf(id: string, station: string, content: StoryContent): { readonly recipe: Recipe; readonly skill: Skill } | null {
  const recipe = content.skills?.recipes.get(id);
  const skill = content.skills ? recipeSkill(content.skills) : null;
  const pot = content.skills?.stations.get(station)?.kind === 'cookingPot';
  return recipe && skill && pot ? { recipe, skill } : null;
}

/**
 * Why cooking `recipe` at `station` cannot start, checked in this order: an unknown recipe or a
 * station that is no cooking pot, busy, not next to the pot, too low a level, missing ingredients,
 * or a full stack of the dish. Null when it can.
 */
export function cookRefusal(progress: Progress, recipe: string, station: string, check: Omit<StartCheck, 'rests' | 'now'>, content: StoryContent): SkillRefusal | null {
  const found = recipeOf(recipe, station, content);
  if (!found) return 'invalid';
  if (check.busy) return 'notNow';
  if (!check.inReach) return 'tooFar';
  if (skillLevel(progress, found.skill.id).level < found.recipe.level) return 'needsLevel';
  if (found.recipe.ingredients.some(({ item, count }) => itemCount(progress, item) < count)) return 'noItem';
  return hasRoomFor(progress, found.recipe.makes, content) ? null : 'bagFull';
}

/**
 * What cooking `recipe` gave: on a success its ingredients are taken and one dish (two on a
 * perfect, within the stack) and its XP given. A miss takes nothing. Throws when the ingredients
 * are missing, which `cookRefusal` checks first.
 */
export function cookResult(progress: Progress, recipe: string, outcome: AttemptOutcome, content: StoryContent): SkillResult {
  const found = content.skills?.recipes.get(recipe);
  const skill = content.skills ? recipeSkill(content.skills) : null;
  if (!found || !skill || !content.skills) throw new RangeError(`unknown recipe "${recipe}"`);
  if (outcome === 'miss') return nothingGained(progress, skill.id);
  let taken: Progress | null = progress;
  for (const { item, count } of found.ingredients) taken = taken ? takeItems(taken, item, count) : null;
  if (!taken) throw new RangeError(`cookResult() needs the ingredients of "${recipe}"`);
  const gift = giveItems(taken, [{ item: found.makes, count: outcome === 'perfect' ? 2 : 1 }], content);
  const grown = gainSkillXp(gift.progress, skill.id, found.xp, content.skills);
  return { progress: grown.progress, items: gift.given, used: found.ingredients, extra: gift.extra, skill: skill.id, xp: grown.gain.xp, level: grown.gain.level, levelUp: grown.gain.levelUp, rest: null };
}

/** The recipe book: every recipe the player's cooking level unlocks, in level order, and the next locked one with its level. */
export type RecipeBook = { readonly unlocked: readonly string[]; readonly next: { readonly recipe: string; readonly level: number } | null };

export function recipeBook(progress: Progress, content: StoryContent): RecipeBook {
  const skill = content.skills ? recipeSkill(content.skills) : null;
  if (!content.skills || !skill) return { unlocked: [], next: null };
  const level = skillLevel(progress, skill.id).level;
  const recipes = [...content.skills.recipes.values()].toSorted((a, b) => a.level - b.level);
  const locked = recipes.find((recipe) => recipe.level > level);
  return { unlocked: recipes.filter((recipe) => recipe.level <= level).map((recipe) => recipe.id), next: locked ? { recipe: locked.id, level: locked.level } : null };
}
