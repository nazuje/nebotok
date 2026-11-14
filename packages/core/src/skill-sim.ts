/**
 * Players on the skill content, to tune the curve. `simulateSkill` is a steady player training one
 * skill alone: it gathers at the best spot of a skill that is ready (waiting for the first rest to
 * end otherwise), or cooks the best recipe it knows. `simulatePlayer` is a whole player training
 * all three with the job board, as the child of `CHILD_MODEL` plays the games. Both record the
 * minutes to each level; `node scripts/skill-sim.mjs` prints the tables.
 */
import { planAttempt, type AttemptOutcome } from './attempts.ts';
import { emptyProgress, itemCount, type Progress } from './creatures.ts';
import { childOutcome } from './game-sim.ts';
import { cookResult, gatherResult } from './gathering.ts';
import { giveItems } from './inventory.ts';
import { deliverJob, openBoard, skillEvent } from './jobs.ts';
import { createRng, type Rng } from './rng.ts';
import { recipeSkill, type Recipe, type SkillContent, type Spot } from './skill-content.ts';
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

/** How a whole player plays: `mixed` takes turns between the board and free gathering and cooking, `boardFirst` works on the board whenever it can. */
export type PlayerStyle = 'mixed' | 'boardFirst';

export type PlayerSimOptions = {
  readonly gatherMs: number;
  readonly cookMs: number;
  /** Walking to a character and handing a delivery over. */
  readonly deliverMs: number;
  /** Dishes beyond this many of one kind are taken as offered in battles, so cooking never stops at a full stack. */
  readonly keepDishes: number;
  readonly limitMinutes: number;
};

export const PLAYER_SIM_DEFAULTS: PlayerSimOptions = { gatherMs: 12_000, cookMs: 12_000, deliverMs: 20_000, keepDishes: 10, limitMinutes: 400 };

/** The minutes of play to each level of each skill, from level 2 on, and how the child's games went. */
export type PlayerSimRun = { readonly minutes: ReadonlyMap<string, readonly number[]>; readonly outcomes: Readonly<Record<AttemptOutcome, number>>; readonly jobs: number };

type Action = { readonly kind: 'gather'; readonly spot: Spot } | { readonly kind: 'cook'; readonly recipe: Recipe } | { readonly kind: 'deliver'; readonly npc: string };

type Player = { progress: Progress; now: number; readonly rests: Map<string, number>; readonly outcomes: Record<AttemptOutcome, number> };

const levelOf = (player: Player, skill: string) => skillLevel(player.progress, skill).level;
const roomFor = (player: Player, item: string, content: StoryContent) => giveItems(player.progress, [{ item, count: 1 }], content).given.length > 0;

/** The best `wanted` spot that is open to the player's level, rested and has room in the bag for its item. */
function readySpot(player: Player, wanted: (spot: Spot) => boolean, skills: SkillContent, content: StoryContent): Spot | undefined {
  return best([...skills.spots.values()].filter((spot) => wanted(spot) && spot.level <= levelOf(player, spot.skill) && (player.rests.get(spot.id) ?? 0) <= player.now && roomFor(player, spot.item, content)));
}

/** What gets the player `item`: cooking it now, or gathering it or one of its missing ingredients. */
function towards(player: Player, item: string, skills: SkillContent, content: StoryContent): Action | null {
  const spot = readySpot(player, (each) => each.item === item, skills, content);
  if (spot) return { kind: 'gather', spot };
  const cook = recipeSkill(skills);
  const recipe = [...skills.recipes.values()].find((each) => each.makes === item && cook !== null && each.level <= levelOf(player, cook.id));
  if (!recipe) return null;
  if (recipe.ingredients.every(({ item: wanted, count }) => itemCount(player.progress, wanted) >= count)) return roomFor(player, item, content) ? { kind: 'cook', recipe } : null;
  for (const { item: wanted, count } of recipe.ingredients) {
    const missing = itemCount(player.progress, wanted) < count ? readySpot(player, (each) => each.item === wanted, skills, content) : undefined;
    if (missing) return { kind: 'gather', spot: missing };
  }
  return null;
}

/** A step on the board: hand over a delivery the bag holds, or work towards the first job that can move on now. */
function boardAction(player: Player, skills: SkillContent, content: StoryContent): Action | null {
  const board = player.progress.jobs?.board ?? [];
  const ready = board.find((job) => job.to !== null && itemCount(player.progress, job.item) >= job.count);
  if (ready?.to) return { kind: 'deliver', npc: ready.to };
  for (const job of board) {
    const action = towards(player, job.item, skills, content);
    if (action) return action;
  }
  return null;
}

/** A free step: train the lowest skill that has something to do, cooking the best dish it can or gathering at its best spot. */
function freeAction(player: Player, skills: SkillContent, content: StoryContent): Action | null {
  const order = [...skills.skills.values()].toSorted((a, b) => levelOf(player, a.id) - levelOf(player, b.id));
  for (const skill of order) {
    if (skill.uses === 'spots') {
      const spot = readySpot(player, (each) => each.skill === skill.id, skills, content);
      if (spot) return { kind: 'gather', spot };
      continue;
    }
    const known = [...skills.recipes.values()].filter((recipe) => recipe.level <= levelOf(player, skill.id)).toSorted((a, b) => b.xp - a.xp);
    for (const recipe of known) {
      const action = towards(player, recipe.makes, skills, content);
      if (action) return action;
    }
  }
  return null;
}

/** Plays the tiny game of a gather or cook as the child, applies it and counts it for the board. */
function play(player: Player, action: Action, rng: Rng, options: PlayerSimOptions, skills: SkillContent, content: StoryContent): void {
  if (action.kind === 'deliver') {
    player.now += options.deliverMs;
    player.progress = deliverJob(player.progress, action.npc, content)?.progress ?? player.progress;
    return;
  }
  const skill = action.kind === 'gather' ? skills.skills.get(action.spot.skill) : recipeSkill(skills);
  const difficulty = action.kind === 'gather' ? action.spot.difficulty : action.recipe.difficulty;
  const outcome = childOutcome(planAttempt(skill?.game ?? 'dip', difficulty, rng, skills.games), rng);
  player.outcomes[outcome] += 1;
  player.now += action.kind === 'gather' ? options.gatherMs : options.cookMs;
  const result = action.kind === 'gather' ? gatherResult(player.progress, action.spot.id, outcome, player.now, content) : cookResult(player.progress, action.recipe.id, outcome, content);
  if (result.rest) player.rests.set(result.rest.spot, result.rest.until);
  let { progress } = result;
  for (const { item, count } of result.items) progress = skillEvent(progress, { kind: action.kind === 'gather' ? 'gathered' : 'cooked', item, count }, content).progress;
  const treats = new Set([...skills.recipes.values()].map((recipe) => recipe.makes));
  const keep = options.keepDishes;
  player.progress = { ...progress, inventory: progress.inventory.map((entry) => (treats.has(entry.item) && entry.count > keep ? { item: entry.item, count: keep } : entry)).filter((entry) => entry.count > 0) };
}

/**
 * One player of `style` from a new save, with the board open from the start, playing every game as
 * the child of `CHILD_MODEL` until every skill is at the top level or the time limit. With nothing
 * to do, they wait for the first spot to rest out.
 */
export function simulatePlayer(style: PlayerStyle, content: StoryContent, rng: Rng, options: PlayerSimOptions = PLAYER_SIM_DEFAULTS): PlayerSimRun {
  const skills = content.skills;
  if (!skills) throw new RangeError('simulatePlayer() needs skill content');
  const player: Player = { progress: openBoard(emptyProgress(), rng.int(0, 0xffffffff), content), now: 0, rests: new Map(), outcomes: { perfect: 0, success: 0, miss: 0 } };
  const minutes = new Map([...skills.skills.keys()].map((skill): [string, number[]] => [skill, []]));
  const done = () => [...skills.skills.keys()].every((skill) => levelOf(player, skill) >= skills.maxLevel);
  for (let turn = 0; !done() && player.now < options.limitMinutes * MINUTE_MS; turn += 1) {
    const before = new Map([...skills.skills.keys()].map((skill) => [skill, levelOf(player, skill)]));
    const onBoard = style === 'boardFirst' || turn % 2 === 0;
    const action = (onBoard ? boardAction(player, skills, content) : null) ?? freeAction(player, skills, content) ?? boardAction(player, skills, content);
    if (action) play(player, action, rng, options, skills, content);
    else player.now = Math.min(player.now + MINUTE_MS, ...[...player.rests.values()].filter((until) => until > player.now));
    for (const [skill, level] of before) for (let next = level + 1; next <= levelOf(player, skill); next += 1) minutes.get(skill)?.push(player.now / MINUTE_MS);
  }
  return { minutes, outcomes: player.outcomes, jobs: player.progress.jobs?.done ?? 0 };
}

/** The average of `runs` players of `style`, seeded `player-sim:<style>:<n>`: minutes to each level of each skill (levels every run reached), the child's outcomes and the jobs done. */
export function simulatePlayers(style: PlayerStyle, content: StoryContent, runs: number, options: PlayerSimOptions = PLAYER_SIM_DEFAULTS): { readonly skills: SkillSimRun[]; readonly outcomes: Readonly<Record<AttemptOutcome, number>>; readonly jobsPerHour: number } {
  const all = Array.from({ length: runs }, (_, at) => simulatePlayer(style, content, createRng(`player-sim:${style}:${at}`), options));
  const skills = [...(content.skills?.skills.keys() ?? [])].map((skill) => {
    const each = all.map((run) => run.minutes.get(skill) ?? []);
    const levels = Math.min(...each.map((list) => list.length));
    return { skill, minutes: Array.from({ length: levels }, (_, at) => each.reduce((sum, list) => sum + (list[at] ?? 0), 0) / runs) };
  });
  const outcomes = { perfect: 0, success: 0, miss: 0 };
  for (const run of all) for (const key of ['perfect', 'success', 'miss'] as const) outcomes[key] += run.outcomes[key];
  const hours = all.reduce((sum, run) => sum + Math.max(...[...run.minutes.values()].map((list) => list.at(-1) ?? 0)), 0) / 60;
  return { skills, outcomes, jobsPerHour: all.reduce((sum, run) => sum + run.jobs, 0) / Math.max(hours, 1 / 60) };
}
