/**
 * Schemas of the skill content: the skills, their level curve and their tiny games
 * (`skills.json`), the spots players gather at (`spots.json`), the recipes cooked at a pot
 * (`recipes.json`), the stations a map places (`stations.json`) and the job board's templates
 * (`jobs.json`). The links between these files, and to items, characters and dialogue, are checked
 * by `skillProblems` in skill-links.ts; docs/protocol.md, "Skills and the job board", explains how
 * they play.
 */
import { z } from 'zod';
import { GRACE_MS, MARKER_MARGIN, MARKER_TRACK, MAX_TAPS, SPARKLE_FIRST_MS, SPARKLE_PLACES } from './attempts.ts';
import { ContentId, LocalizedText, noRepeatedIds } from './content.ts';

/** The tiny games, one per skill: tap when the float dips, tap the sparkles, stop the marker in its zone. */
export const GAMES = ['dip', 'sparkle', 'marker'] as const;
export type GameKind = (typeof GAMES)[number];

/** The highest skill level a save keeps; `maxLevel` in skills.json is the one players reach today. */
export const MAX_SKILL_LEVEL = 99;
/** No tiny game lasts longer than this. */
export const MAX_GAME_MS = 6_000;
/** The most jobs a board shows. */
export const MAX_JOB_SLOTS = 5;

const Ms = z.number().int().min(0).max(MAX_GAME_MS);
const Level = z.number().int().min(1).max(MAX_SKILL_LEVEL);
/** How hard a spot's or recipe's game is, 1 to 3: the place in each game's three-number lists. */
export const Difficulty = z.number().int().min(1).max(3);
export type Difficulty = z.infer<typeof Difficulty>;

const byDifficulty = <T extends z.ZodType>(value: T) => z.tuple([value, value, value]);
const MsRange = z.tuple([Ms, Ms]).refine(([low, high]) => low <= high, 'a range is [lowest, highest]');

/** Fishing: the float dips after `waitMs`, and a tap within `windowMs` of the dip catches, within `perfectMs` perfectly. */
export const DipRules = z
  .strictObject({ waitMs: MsRange, windowMs: byDifficulty(Ms.min(500)), perfectMs: byDifficulty(Ms.min(1)) })
  .superRefine((dip, ctx) => {
    dip.windowMs.forEach((window, at) => {
      if (dip.perfectMs[at]! > window) ctx.addIssue({ code: 'custom', message: `perfectMs ${dip.perfectMs[at]} is longer than its windowMs ${window}`, path: ['perfectMs', at] });
      if (dip.waitMs[1] + window > MAX_GAME_MS) ctx.addIssue({ code: 'custom', message: `the longest wait and window last ${dip.waitMs[1] + window} ms, more than ${MAX_GAME_MS}`, path: ['windowMs', at] });
    });
  });
export type DipRules = z.infer<typeof DipRules>;

/**
 * Foraging: `count` sparkles, the first at SPARKLE_FIRST_MS and each next one `gapMs` later, each
 * shown `showMs` at one of SPARKLE_PLACES places. Tapping `need` of them succeeds, all of them is perfect.
 */
export const SparkleRules = z
  .strictObject({ count: z.number().int().min(1).max(MAX_TAPS), gapMs: z.tuple([Ms.min(300), Ms.min(300)]), showMs: byDifficulty(Ms.min(800)), need: z.number().int().min(1).max(MAX_TAPS) })
  .superRefine((sparkle, ctx) => {
    if (sparkle.gapMs[0] > sparkle.gapMs[1]) ctx.addIssue({ code: 'custom', message: 'a range is [lowest, highest]', path: ['gapMs'] });
    if (sparkle.need > sparkle.count) ctx.addIssue({ code: 'custom', message: `need ${sparkle.need} is more than count ${sparkle.count}`, path: ['need'] });
    sparkle.showMs.forEach((show, at) => {
      const length = SPARKLE_FIRST_MS + (sparkle.count - 1) * sparkle.gapMs[1] + show;
      if (length > MAX_GAME_MS) ctx.addIssue({ code: 'custom', message: `the game lasts up to ${length} ms, more than ${MAX_GAME_MS}`, path: ['showMs', at] });
      // A new sparkle needs a place that no sparkle still in reach of a tap holds.
      if (show + 2 * GRACE_MS >= SPARKLE_PLACES * sparkle.gapMs[0]) ctx.addIssue({ code: 'custom', message: `showMs ${show} is too long for the shortest gap: more than ${SPARKLE_PLACES - 1} sparkles would show at once`, path: ['showMs', at] });
    });
  });
export type SparkleRules = z.infer<typeof SparkleRules>;

/**
 * Cooking: a marker sweeps the track from 0 to MARKER_TRACK and back, each way in `sweepMs`.
 * Stopping it in a `zone` as wide as given succeeds, in the `perfect` band at its middle perfectly.
 * No tap by `timeoutMs` is a miss.
 */
export const MarkerRules = z
  .strictObject({
    sweepMs: byDifficulty(Ms.min(900)),
    zone: byDifficulty(z.number().int().min(20).max(MARKER_TRACK - 2 * MARKER_MARGIN)),
    perfect: byDifficulty(z.number().int().min(10).max(MARKER_TRACK - 2 * MARKER_MARGIN)),
    timeoutMs: Ms.min(1_000),
  })
  .superRefine((marker, ctx) => {
    marker.zone.forEach((zone, at) => {
      if (marker.perfect[at]! > zone) ctx.addIssue({ code: 'custom', message: `perfect ${marker.perfect[at]} is wider than its zone ${zone}`, path: ['perfect', at] });
    });
  });
export type MarkerRules = z.infer<typeof MarkerRules>;

export const GamesRules = z.strictObject({ dip: DipRules, sparkle: SparkleRules, marker: MarkerRules });
export type GamesRules = z.infer<typeof GamesRules>;

const skillBase = { id: ContentId, name: LocalizedText, game: z.enum(GAMES) };

/** A skill: gathered at spots, each resting `restSeconds` for the player after a success, or cooked from recipes. */
export const Skill = z.discriminatedUnion('uses', [
  z.strictObject({ ...skillBase, uses: z.literal('spots'), restSeconds: z.number().int().min(10).max(600) }),
  z.strictObject({ ...skillBase, uses: z.literal('recipes') }),
]);
export type Skill = z.infer<typeof Skill>;

/**
 * `skills.json`: every skill, levels 1 to `maxLevel`, and `levelCosts[i]`, the XP from level i + 1
 * to i + 2 (rising, one fewer than the levels), and the numbers of each tiny game.
 */
export const SkillsFile = z
  .strictObject({
    maxLevel: z.number().int().min(2).max(MAX_SKILL_LEVEL),
    levelCosts: z.array(z.number().int().min(1).max(100_000)).min(1).max(MAX_SKILL_LEVEL - 1),
    skills: z.array(Skill).min(1).max(20),
    games: GamesRules,
  })
  .superRefine((file, ctx) => {
    noRepeatedIds(file.skills, 'skills', ctx);
    if (file.levelCosts.length !== file.maxLevel - 1) ctx.addIssue({ code: 'custom', message: `has ${file.levelCosts.length} costs; maxLevel ${file.maxLevel} needs ${file.maxLevel - 1}`, path: ['levelCosts'] });
    if (file.levelCosts.some((cost, at) => at > 0 && cost <= file.levelCosts[at - 1]!)) ctx.addIssue({ code: 'custom', message: 'each level costs more than the one before', path: ['levelCosts'] });
    if (file.skills.filter((skill) => skill.uses === 'recipes').length > 1) ctx.addIssue({ code: 'custom', message: 'one skill at most uses recipes', path: ['skills'] });
  });
export type SkillsFile = z.infer<typeof SkillsFile>;

/** A place to gather: one `item` per success (two on a perfect) and `xp`, from `level` of its `skill`. Its picture is `spots/<look>`. */
export const Spot = z.strictObject({ id: ContentId, skill: ContentId, item: ContentId, level: Level, xp: z.number().int().min(1).max(10_000), difficulty: Difficulty, look: ContentId, name: LocalizedText });
export type Spot = z.infer<typeof Spot>;

export const SpotsFile = z.strictObject({ spots: z.array(Spot).max(200) }).superRefine(({ spots }, ctx) => noRepeatedIds(spots, 'spots', ctx));
export type SpotsFile = z.infer<typeof SpotsFile>;

const ItemCountSchema = z.strictObject({ item: ContentId, count: z.number().int().min(1).max(99) });

/** A dish: `makes` one (two on a perfect) from its `ingredients`, at `level` of the skill that uses recipes. */
export const Recipe = z
  .strictObject({ id: ContentId, makes: ContentId, level: Level, xp: z.number().int().min(1).max(10_000), difficulty: Difficulty, ingredients: z.array(ItemCountSchema).min(1).max(4) })
  .refine(({ ingredients }) => new Set(ingredients.map((entry) => entry.item)).size === ingredients.length, 'each ingredient appears once');
export type Recipe = z.infer<typeof Recipe>;

export const RecipesFile = z.strictObject({ recipes: z.array(Recipe).max(200) }).superRefine(({ recipes }, ctx) => noRepeatedIds(recipes, 'recipes', ctx));
export type RecipesFile = z.infer<typeof RecipesFile>;

export const STATION_KINDS = ['cookingPot', 'jobBoard'] as const;
export type StationKind = (typeof STATION_KINDS)[number];

/** Something on the map players use from a neighbouring tile: a cooking pot or the job board. Its picture is `stations/<look>`. */
export const Station = z.strictObject({ id: ContentId, kind: z.enum(STATION_KINDS), look: ContentId, name: LocalizedText });
export type Station = z.infer<typeof Station>;

export const StationsFile = z.strictObject({ stations: z.array(Station).max(50) }).superRefine(({ stations }, ctx) => noRepeatedIds(stations, 'stations', ctx));
export type StationsFile = z.infer<typeof StationsFile>;

export const JOB_KINDS = ['gather', 'cook', 'deliver'] as const;
export type JobKind = (typeof JOB_KINDS)[number];

const CountRange = z.tuple([z.number().int().min(1).max(99), z.number().int().min(1).max(99)]).refine(([low, high]) => low <= high, 'a range is [lowest, highest]');

/** What finishing a job gives: items, and `perItem` XP of a skill for each item the job asked for. */
export const JobRewardsSchema = z.strictObject({
  items: z.array(ItemCountSchema).max(3),
  xp: z.array(z.strictObject({ skill: ContentId, perItem: z.number().int().min(0).max(1_000) })).max(3),
});

const templateBase = {
  id: ContentId,
  item: ContentId,
  count: CountRange,
  needs: z.strictObject({ skill: ContentId, level: Level }),
  weight: z.number().int().min(1).max(1_000),
  rewards: JobRewardsSchema,
};

/**
 * A kind of job the board draws: gather or cook `count` of `item` (drawn from the range), or bring
 * them to one of the characters `to`. Drawn only for a player whose `needs` skill is at that level.
 */
export const JobTemplate = z.discriminatedUnion('kind', [
  z.strictObject({ ...templateBase, kind: z.literal('gather') }),
  z.strictObject({ ...templateBase, kind: z.literal('cook') }),
  z.strictObject({ ...templateBase, kind: z.literal('deliver'), to: z.array(ContentId).min(1).max(5).refine((ids) => new Set(ids).size === ids.length, 'each character appears once') }),
]);
export type JobTemplate = z.infer<typeof JobTemplate>;

/** `jobs.json`: how many jobs the board shows, and the templates it draws them from by `weight`. */
export const JobsFile = z
  .strictObject({ slots: z.number().int().min(1).max(MAX_JOB_SLOTS), templates: z.array(JobTemplate).min(1).max(100) })
  .superRefine(({ templates }, ctx) => noRepeatedIds(templates, 'templates', ctx));
export type JobsFile = z.infer<typeof JobsFile>;

/** The skill files, raw or parsed. */
export type SkillContentFiles = { readonly skills: unknown; readonly spots: unknown; readonly recipes: unknown; readonly stations: unknown; readonly jobs: unknown };

/** Everything the skill and job rules read, looked up by id; each map keeps its file's order. */
export type SkillContent = {
  readonly maxLevel: number;
  readonly levelCosts: readonly number[];
  readonly skills: ReadonlyMap<string, Skill>;
  readonly games: GamesRules;
  readonly spots: ReadonlyMap<string, Spot>;
  readonly recipes: ReadonlyMap<string, Recipe>;
  readonly stations: ReadonlyMap<string, Station>;
  readonly slots: number;
  readonly templates: ReadonlyMap<string, JobTemplate>;
};

const byId = <T extends { readonly id: string }>(entries: readonly T[]): Map<string, T> => new Map(entries.map((entry) => [entry.id, entry]));

/** The skill content of parsed files. */
export function skillContentOf(files: { readonly skills: SkillsFile; readonly spots: SpotsFile; readonly recipes: RecipesFile; readonly stations: StationsFile; readonly jobs: JobsFile }): SkillContent {
  return {
    maxLevel: files.skills.maxLevel,
    levelCosts: files.skills.levelCosts,
    skills: byId(files.skills.skills),
    games: files.skills.games,
    spots: byId(files.spots.spots),
    recipes: byId(files.recipes.recipes),
    stations: byId(files.stations.stations),
    slots: files.jobs.slots,
    templates: byId(files.jobs.templates),
  };
}

/** The skill that cooks recipes, if any. */
export function recipeSkill(content: SkillContent): Skill | null {
  return [...content.skills.values()].find((skill) => skill.uses === 'recipes') ?? null;
}
