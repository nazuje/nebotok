import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  attemptDeadlineMs,
  cookRefusal,
  cookResult,
  directionBetween,
  gatherRefusal,
  gatherResult,
  jobsView,
  judgeAttempt,
  needsStarter,
  nothingGained,
  planAttempt,
  recipeSkill,
  skillAttemptMessage,
  skillEvent,
  skillResultMessage,
  skillsView,
  spotInReach,
  stationInReach,
  type AttemptPlan,
  type Direction,
  type JobChange,
  type Point,
  type Progress,
  type QuestChange,
  type RefusalReason,
  type Rng,
  type SkillOutcome,
  type SkillResult,
  type SpotRest,
  type StoryContent,
  type Tap,
  type Walker,
  type WorldMap,
} from '@nebotok/core';
import type { Log } from './log.ts';
import type { Outgoing, StoryExtras, StoryResult } from './talk.ts';

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
 * The skill state of each profile for as long as the room is open: a profile gets the same one on
 * every seat it takes, so leaving and joining again, or taking over from another device, never wakes
 * a resting spot early. A restart clears them all.
 */
export function skillSeats(): (playerId: number) => SkillSeat {
  const byProfile = new Map<number, SkillSeat>();
  return (playerId) => {
    const kept = byProfile.get(playerId) ?? newSkillSeat();
    byProfile.set(playerId, kept);
    return kept;
  };
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
  /** Why the player cannot start anything now: `inBattle`, `notNow` for a talk, a move offer or an open attempt, or null. */
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

/** Why no start is allowed at all right now, before the spot or pot is looked at. */
function busyRefusal(room: SkillRoom): RefusalReason | null {
  if (room.busy) return room.busy;
  if (room.skills.attempt) return 'notNow';
  return SKILLS_NEED_STARTER && needsStarter(room.progress) ? 'notNow' : null;
}

/** What an accepted start plays: the skill, where, its game's difficulty, and the tile the courier turns to. */
type Start = { readonly skill: string; readonly at: { readonly spot: string } | { readonly recipe: string }; readonly difficulty: number; readonly faces: Point | undefined };

/** Stops the walk, faces the spot or pot, shows the skill, plans its game and sends `skill.attempt`. */
function begin(room: SkillRoom, start: Start) {
  const skills = room.content.skills;
  const skill = skills?.skills.get(start.skill);
  if (!skills || !skill) throw new RangeError(`unknown skill "${start.skill}"`);
  const plan = planAttempt(skill.game, start.difficulty, room.rng(), skills.games);
  const id = room.nextAttempt();
  const spot = 'spot' in start.at ? start.at.spot : null;
  const recipe = 'recipe' in start.at ? start.at.recipe : null;
  room.skills.attempt = { id, skill: skill.id, spot, recipe, plan, sentAt: room.now };
  room.stand((start.faces && directionBetween(room.walker, start.faces)) ?? room.walker.facing);
  room.showSkill(skill.id);
  room.send(SERVER_MESSAGES.skillAttempt, skillAttemptMessage(id, skill.id, start.at, plan));
}

/** `gather.start` at `spot`: refused in core `gatherRefusal`'s order after busy, else the attempt begins. */
export function gatherStart(room: SkillRoom, spot: string): void {
  const check = { busy: false, inReach: spotInReach(room.map, room.walker, spot), rests: room.skills.rests, now: room.now };
  const refusal = busyRefusal(room) ?? gatherRefusal(room.progress, spot, check, room.content);
  const found = room.content.skills?.spots.get(spot);
  if (refusal || !found) {
    room.refuse(CLIENT_MESSAGES.gatherStart, refusal ?? 'invalid');
    return;
  }
  begin(room, { skill: found.skill, at: { spot }, difficulty: found.difficulty, faces: room.map.spots[spot] });
}

/** `cook.start` of `recipe` at the pot `station`: refused in core `cookRefusal`'s order after busy, else the attempt begins. */
export function cookStart(room: SkillRoom, recipe: string, station: string): void {
  const refusal = busyRefusal(room) ?? cookRefusal(room.progress, recipe, station, { busy: false, inReach: stationInReach(room.map, room.walker, station) }, room.content);
  const found = room.content.skills?.recipes.get(recipe);
  const skill = room.content.skills ? recipeSkill(room.content.skills) : null;
  if (refusal || !found || !skill) {
    room.refuse(CLIENT_MESSAGES.cookStart, refusal ?? 'invalid');
    return;
  }
  begin(room, { skill: skill.id, at: { recipe }, difficulty: found.difficulty, faces: room.map.stations[station] });
}

/** The open attempt `attempt` names, or the refusal for a request about it. */
function openAttempt(room: SkillRoom, attempt: number): LiveAttempt | 'notNow' | 'invalid' {
  const live = room.skills.attempt;
  if (!live) return 'notNow';
  return live.id === attempt ? live : 'invalid';
}

/** `skill.finish` of `attempt` with the player's taps, judged by the server's own clock: too late a finish is `late`. */
export function skillFinish(room: SkillRoom, attempt: number, taps: readonly Tap[]): void {
  const live = openAttempt(room, attempt);
  if (typeof live === 'string') {
    room.refuse(CLIENT_MESSAGES.skillFinish, live);
    return;
  }
  const elapsed = room.now - live.sentAt;
  if (elapsed > attemptDeadlineMs(live.plan)) settle(room, live, 'late');
  else settle(room, live, judgeAttempt(live.plan, taps, elapsed));
}

/** `skill.cancel` of `attempt`: it ends `cancelled`, using and resting nothing. */
export function skillCancel(room: SkillRoom, attempt: number): void {
  const live = openAttempt(room, attempt);
  if (typeof live === 'string') room.refuse(CLIENT_MESSAGES.skillCancel, live);
  else settle(room, live, 'cancelled');
}

/** What an attempt gave by its outcome: only `perfect` and `success` give, use or rest anything. */
function resultOf(room: SkillRoom, live: LiveAttempt, outcome: SkillOutcome, now: number): SkillResult {
  if (outcome !== 'perfect' && outcome !== 'success') return nothingGained(room.progress, live.skill);
  if (live.spot !== null) return gatherResult(room.progress, live.spot, outcome, now, room.content);
  return cookResult(room.progress, live.recipe ?? '', outcome, room.content);
}

/** The gathered or cooked items counted for quests and jobs, one item after another (core `skillEvent`). */
function countItems(result: SkillResult, live: LiveAttempt, content: StoryContent): { progress: Progress; quests: QuestChange[]; jobs: JobChange[] } {
  const kind = live.spot === null ? 'cooked' : 'gathered';
  let { progress } = result;
  const quests: QuestChange[] = [];
  const jobs: JobChange[] = [];
  for (const { item, count } of result.items) {
    const counted = skillEvent(progress, { kind, item, count }, content);
    progress = counted.progress;
    quests.push(...counted.quests);
    jobs.push(...counted.jobs);
  }
  return { progress, quests, jobs };
}

/**
 * Ends the open attempt with `outcome`: `Player.skill` clears, the rest starts, and the player gets
 * `skill.result`, then each `job.changed` and `quest.changed`, then `progress`, `skills`, `story`
 * and `jobs` as they changed. The progress is saved at once.
 */
function settle(room: SkillRoom, live: LiveAttempt, outcome: SkillOutcome) {
  // One reading of the clock, so the rest and the restMs sent agree to the millisecond.
  const { now } = room;
  const result = resultOf(room, live, outcome, now);
  room.skills.attempt = null;
  if (result.rest) room.skills.rests = [...room.skills.rests.filter((rest) => rest.spot !== result.rest?.spot && rest.until > now), result.rest];
  room.showSkill('');
  room.send(SERVER_MESSAGES.skillResult, skillResultMessage(live.id, outcome, result, now));
  room.log.info('skill attempt ended', { playerId: room.playerId, attempt: live.id, skill: live.skill, spot: live.spot, recipe: live.recipe, outcome, items: result.items.reduce((sum, entry) => sum + entry.count, 0), xp: result.xp, levelUp: result.levelUp });
  if (result.progress === room.progress) return;
  const counted = countItems(result, live, room.content);
  const skills = room.content.skills;
  const extras: StoryExtras = {
    first: counted.jobs.map((change): Outgoing => ({ type: SERVER_MESSAGES.jobChanged, message: change })),
    beforeStory: skills ? [{ type: SERVER_MESSAGES.skills, message: skillsView(counted.progress, room.skills.rests, now, skills) }] : [],
    last: counted.jobs.length > 0 ? [{ type: SERVER_MESSAGES.jobs, message: jobsView(counted.progress, room.content) }] : [],
  };
  room.apply({ progress: counted.progress, changes: counted.quests }, extras);
}

/** Why the room ends a seat's attempt by itself, if it has one. */
export type AttemptEnd = 'walk' | 'left' | 'replaced' | 'battle' | 'shutdown' | 'reconnected';

/** The seat walked, left, was taken over, met a battle, reconnected or the room is closing: its attempt, if any, ends `cancelled`. */
export function endAttempt(room: SkillRoom, why: AttemptEnd): void {
  const live = room.skills.attempt;
  if (!live) return;
  room.log.debug('skill attempt cancelled', { playerId: room.playerId, attempt: live.id, why });
  settle(room, live, 'cancelled');
}

/** Each tick: an attempt with no finish past its deadline (core `attemptDeadlineMs`) ends `late`. */
export function tickSkills(room: SkillRoom): void {
  const live = room.skills.attempt;
  if (live && room.now - live.sentAt > attemptDeadlineMs(live.plan)) settle(room, live, 'late');
}

/**
 * The seat joined or reconnected: after `progress` and `story` it gets `skills`. An attempt from
 * before a reconnection ends `cancelled` first, since the browser lost the game it was drawing.
 */
export function skillsJoined(room: SkillRoom): void {
  endAttempt(room, 'reconnected');
  const skills = room.content.skills;
  if (skills) room.send(SERVER_MESSAGES.skills, skillsView(room.progress, room.skills.rests, room.now, skills));
}
