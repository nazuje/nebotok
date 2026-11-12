import { CLIENT_MESSAGES, SERVER_MESSAGES, jobsView, needsStarter, openBoard, stationInReach, type JobsMessage, type RefusalReason } from '@nebotok/core';
import { SKILLS_NEED_STARTER, type SkillRoom } from './skills.ts';
import { NO_EXTRAS } from './talk.ts';

/** The largest board seed: the save keeps it as a 32-bit unsigned number. */
const MAX_BOARD_SEED = 0xffffffff;

/**
 * Why `board.open` at `station` is refused, in this order: an unknown station or one that is no job
 * board, busy (a battle, a talk, a move offer or an attempt), no creature yet, or not next to it.
 */
function boardRefusal(room: SkillRoom, station: string): RefusalReason | null {
  if (room.content.skills?.stations.get(station)?.kind !== 'jobBoard') return 'invalid';
  if (room.busy) return room.busy;
  if (room.skills.attempt) return 'notNow';
  if (SKILLS_NEED_STARTER && needsStarter(room.progress)) return 'notNow';
  return stationInReach(room.map, room.walker, station) ? null : 'tooFar';
}

/**
 * `board.open` at `station`. The first open starts the board from a fresh seed and draws its jobs;
 * a later one refills slots a repaired save left empty. A board that changed is saved at once.
 */
export function boardOpen(room: SkillRoom, station: string): void {
  const refusal = boardRefusal(room, station);
  if (refusal) {
    room.refuse(CLIENT_MESSAGES.boardOpen, refusal);
    return;
  }
  const before = room.progress;
  const opened = openBoard(before, before.jobs ? 0 : room.rng().int(0, MAX_BOARD_SEED), room.content);
  const jobs = { type: SERVER_MESSAGES.jobs, message: jobsView(opened, room.content) satisfies JobsMessage };
  if (opened.jobs === before.jobs) room.send(jobs.type, jobs.message);
  else room.apply({ progress: opened, changes: [] }, { ...NO_EXTRAS, last: [jobs] });
  room.log.info('board opened', { playerId: room.playerId, station, first: before.jobs === null, drawn: opened.jobs?.drawn ?? 0, jobs: opened.jobs?.board.length ?? 0 });
}

/** The seat joined or reconnected: after `skills` it gets `jobs`, once the board has been opened. */
export function jobsJoined(room: SkillRoom): void {
  if (room.progress.jobs) room.send(SERVER_MESSAGES.jobs, jobsView(room.progress, room.content) satisfies JobsMessage);
}
