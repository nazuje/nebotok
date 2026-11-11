import { CLIENT_MESSAGES, type AttemptPlan, type Direction, type Progress, type RefusalReason, type Rng, type SpotRest, type StoryContent, type Tap, type Walker, type WorldMap } from '@nebotok/core';
import type { Log } from './log.ts';
import type { StoryExtras, StoryResult } from './talk.ts';

/**
 * Whether a player still waiting for their starter is refused gathering and cooking (`notNow`), so
 * the first talk stays the first thing to do.
 */
export const SKILLS_NEED_STARTER = true;

/**
 * A gather or cook in progress: the game the server planned and when it sent `skill.attempt`. Like a
 * talk it lives only in the seat's memory and is never saved: nothing is used or given until it is judged.
 */
export type LiveAttempt = {
  /** Counted across the room, so a finish for an old attempt never matches a new one. */
  readonly id: number;
  readonly skill: string;
  /** The spot gathered at, or null for cooking. */
  readonly spot: string | null;
  /** The recipe cooked, or null for gathering. */
  readonly recipe: string | null;
  readonly plan: AttemptPlan;
  /** When `skill.attempt` was sent, by the room's clock. */
  readonly sentAt: number;
};

/** A seat's skill state, owned by this file. It lives only in memory: an attempt or a rest lost with its seat loses nothing saved. */
export type SkillSeat = {
  attempt: LiveAttempt | null;
  /** The spots resting for this player. */
  rests: SpotRest[];
};

export function newSkillSeat(): SkillSeat {
  return { attempt: null, rests: [] };
}

/**
 * What the room hands the skill rules for one seat: what they read, and the few things they may do
 * to it. The room builds one for each call, so the skill rules never reach into a seat themselves.
 */
export type SkillRoom = {
  readonly playerId: number;
  readonly skills: SkillSeat;
  readonly progress: Progress;
  readonly walker: Walker;
  /** Why the player cannot start anything now: `inBattle`, `notNow` for a talk or a move offer, or null. */
  readonly busy: RefusalReason | null;
  readonly now: number;
  readonly map: WorldMap;
  readonly content: StoryContent;
  /** The room's attempt RNG, seeded from the server's randomness like the encounter RNG. Made on first use. */
  readonly rng: () => Rng;
  /** The next attempt id, counted across the room. */
  readonly nextAttempt: () => number;
  readonly log: Log;
  send(type: string, message: unknown): void;
  refuse(request: string, reason: RefusalReason): void;
  /** Stops the walk (the step under way still ends) and turns the courier to `facing`. */
  stand(facing: Direction): void;
  /** Sets `Player.skill`: `''` or the skill being done. */
  showSkill(skill: string): void;
  /**
   * Applies a change to the player's progress, saved at once, and sends `quest.changed` for each
   * quest, `progress` and `story` with `extras` in their places. Returns false, sending nothing,
   * when nothing changed and there are no extras.
   */
  apply(result: StoryResult, extras: StoryExtras): boolean;
};

/** `gather.start` at `spot`. Gathering is not open yet. */
export function gatherStart(room: SkillRoom, _spot: string): void {
  room.refuse(CLIENT_MESSAGES.gatherStart, 'notNow');
}

/** `cook.start` of `recipe` at the pot `station`. Cooking is not open yet. */
export function cookStart(room: SkillRoom, _recipe: string, _station: string): void {
  room.refuse(CLIENT_MESSAGES.cookStart, 'notNow');
}

/** `skill.finish` of `attempt` with the player's taps. */
export function skillFinish(room: SkillRoom, _attempt: number, _taps: readonly Tap[]): void {
  room.refuse(CLIENT_MESSAGES.skillFinish, 'notNow');
}

/** `skill.cancel` of `attempt`. */
export function skillCancel(room: SkillRoom, _attempt: number): void {
  room.refuse(CLIENT_MESSAGES.skillCancel, 'notNow');
}

/** Why the room ends a seat's attempt by itself, if it has one. */
export type AttemptEnd = 'walk' | 'left' | 'replaced' | 'battle' | 'shutdown';

/** The seat walked, left, was taken over, met a battle or the room is closing: its attempt, if any, ends unjudged. Nothing to do while no attempt starts. */
export function endAttempt(_room: SkillRoom, _why: AttemptEnd): void {}

/** Each tick: an attempt with no finish past its deadline ends `late`. Nothing to do while no attempt starts. */
export function tickSkills(_room: SkillRoom): void {}

/** The seat joined or reconnected: after `progress` and `story` it gets `skills` and the attempt it was in, if any. Nothing is sent while skills are not open. */
export function skillsJoined(_room: SkillRoom): void {}
