/**
 * Payloads of the skill and job board messages: zod schemas for what a client sends (the server
 * validates each with them) and types for what the server sends. The type names are in
 * CLIENT_MESSAGES and SERVER_MESSAGES (protocol.ts); docs/protocol.md, "Skills and the job board",
 * explains the flow and the order. Text never travels: the client looks names up by id.
 */
import { z } from 'zod';
import { MAX_TAP_MS, MAX_TAPS, SPARKLE_PLACES, type AttemptOutcome, type AttemptPlan } from './attempts.ts';
import { ContentId } from './content.ts';
import type { SkillResult } from './gathering.ts';
import type { ItemCount } from './inventory.ts';
import type { JobChange, JobView } from './jobs.ts';
import type { GameKind } from './skill-content.ts';

/** The server's number for one attempt, so a finish cannot land on a later one. */
export const AttemptId = z.number().int().min(1).max(2 ** 31 - 1);

/** Gather at `spot`, standing next to it (`spotInReach` in map.ts). */
export const GatherStartMessage = z.strictObject({ spot: ContentId });
export type GatherStartMessage = z.infer<typeof GatherStartMessage>;

/** Cook `recipe` at the cooking pot `station`, standing next to it (`stationInReach`). */
export const CookStartMessage = z.strictObject({ recipe: ContentId, station: ContentId });
export type CookStartMessage = z.infer<typeof CookStartMessage>;

/** A tap: `at` ms after the browser drew the game, at sparkle `place` (0 for dip and marker). */
export const TapSchema = z.strictObject({ at: z.number().int().min(0).max(MAX_TAP_MS), place: z.number().int().min(0).max(SPARKLE_PLACES - 1) });

/** The game of `attempt` is over: these are the player's taps, in order (none when time ran out). */
export const SkillFinishMessage = z.strictObject({ attempt: AttemptId, taps: z.array(TapSchema).max(MAX_TAPS) });
export type SkillFinishMessage = z.infer<typeof SkillFinishMessage>;

/** Stop `attempt` without playing it: nothing is used and nothing rests. */
export const SkillCancelMessage = z.strictObject({ attempt: AttemptId });
export type SkillCancelMessage = z.infer<typeof SkillCancelMessage>;

/** Open the job board `station`, standing next to it: the first open draws the board. */
export const BoardOpenMessage = z.strictObject({ station: ContentId });
export type BoardOpenMessage = z.infer<typeof BoardOpenMessage>;

/** `skills`: every skill's level, the XP since reaching it and the XP still needed for the next (0 at the top), and the player's resting spots with the ms left. */
export type SkillsMessage = {
  readonly skills: readonly { readonly skill: string; readonly level: number; readonly xp: number; readonly toNext: number }[];
  readonly resting: readonly { readonly spot: string; readonly ms: number }[];
};

/**
 * `skill.attempt`: play `game` with these `params` for the gather at `spot` or the cook of `recipe`
 * (the other is null). The game is over by itself `endsByMs` after the browser draws it.
 */
export type SkillAttemptMessage = {
  readonly attempt: number;
  readonly skill: string;
  readonly spot: string | null;
  readonly recipe: string | null;
  readonly game: GameKind;
  readonly params: AttemptPlan['params'];
  readonly endsByMs: number;
};

/** How an attempt ended: judged, `late` (no finish in time) or `cancelled` (a walk, leaving, `skill.cancel`). Only `perfect` and `success` give anything. */
export type SkillOutcome = AttemptOutcome | 'late' | 'cancelled';

/**
 * `skill.result`: what `attempt` gave: `items` into the bag, `used` ingredients, `extra` that did
 * not fit, the skill's XP gained, its level after and whether that is new, and how long the spot
 * now rests for this player (0 when it does not).
 */
export type SkillResultMessage = {
  readonly attempt: number;
  readonly outcome: SkillOutcome;
  readonly items: readonly ItemCount[];
  readonly used: readonly ItemCount[];
  readonly extra: readonly ItemCount[];
  readonly skill: string;
  readonly xp: number;
  readonly level: number;
  readonly levelUp: boolean;
  readonly restMs: number;
};

/** `jobs`: the player's board, in order. Sent once the board has been opened. */
export type JobsMessage = { readonly board: readonly JobView[] };

/** `job.changed`: see `JobChange` in jobs.ts. */
export type JobChanged = JobChange;

/** The `skill.attempt` for a planned game. */
export function skillAttemptMessage(attempt: number, skill: string, at: { readonly spot: string } | { readonly recipe: string }, plan: AttemptPlan): SkillAttemptMessage {
  const spot = 'spot' in at ? at.spot : null;
  const recipe = 'recipe' in at ? at.recipe : null;
  return { attempt, skill, spot, recipe, game: plan.game, params: plan.params, endsByMs: plan.endsByMs };
}

/** The `skill.result` for what an attempt did (`nothingGained` for a miss, `late` or `cancelled`), at server time `now`. */
export function skillResultMessage(attempt: number, outcome: SkillOutcome, result: SkillResult, now: number): SkillResultMessage {
  const { items, used, extra, skill, xp, level, levelUp } = result;
  return { attempt, outcome, items, used, extra, skill, xp, level, levelUp, restMs: result.rest ? Math.max(result.rest.until - now, 0) : 0 };
}
