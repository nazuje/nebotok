import { z } from 'zod';
import type { Species } from '../content.ts';

/**
 * The numbers the arena's bodies read from `content/creatures/arena.json`, in whole arena units,
 * arena units a second, ticks, permille and percent (docs/arena.md, "Every tunable"). Only the
 * groups the step reads so far: `island`, `dash` and `storm`. Objects are not strict, so the whole
 * file parses and keeps only these keys.
 */
const Whole = (min: number, max: number) => z.number().int().min(min).max(max);

export const ArenaIslandRules = z.object({
  radius: Whole(100, 5_000),
  body: Whole(4, 500),
  frictionPermille: Whole(1, 999),
  plantedPermille: Whole(1, 1_000),
  walkBase: Whole(1, 5_000),
  walkPerSpeedPercent: Whole(0, 10_000),
  topSpeed: Whole(1, 10_000),
  knockBasePercent: Whole(0, 1_000),
  knockLostPercent: Whole(0, 1_000),
  knockedTicks: Whole(0, 600),
  bumpKnock: Whole(0, 10_000),
  limitTicks: Whole(60, 60 * 60 * 30),
});
export type ArenaIslandRules = z.infer<typeof ArenaIslandRules>;

export const ArenaDashRules = z.object({
  speed: Whole(1, 10_000),
  ticks: Whole(1, 600),
  cooldownTicks: Whole(1, 6_000),
});
export type ArenaDashRules = z.infer<typeof ArenaDashRules>;

export const ArenaStormRules = z
  .object({
    firstTicks: Whole(1, 60 * 60 * 30),
    everyTicks: Whole(1, 60 * 60 * 30),
    warnTicks: Whole(0, 6_000),
    shrinkTicks: Whole(1, 6_000),
    /** How many shrinks take `bigStepPercent` of the starting radius before they take `smallStepPercent`. */
    bigSteps: Whole(0, 100),
    bigStepPercent: Whole(1, 100).default(10),
    smallStepPercent: Whole(1, 100).default(5),
    floorPercent: Whole(1, 100),
  })
  .refine((storm) => storm.warnTicks < storm.firstTicks, 'the first storm warning comes after the fight starts')
  .refine((storm) => storm.warnTicks + storm.shrinkTicks <= storm.everyTicks, 'a shrink and the next warning fit between two shrinks');
export type ArenaStormRules = z.infer<typeof ArenaStormRules>;

export const ArenaRules = z.object({ island: ArenaIslandRules, dash: ArenaDashRules, storm: ArenaStormRules });
export type ArenaRules = z.infer<typeof ArenaRules>;

/** Everything an arena step and its start read: the arena's numbers, and the species for walk caps. */
export type ArenaContent = {
  readonly arena: ArenaRules;
  readonly species: ReadonlyMap<string, Species>;
};
