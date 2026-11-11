import { CLIENT_MESSAGES } from '@nebotok/core';
import type { SkillRoom } from './skills.ts';

/** `board.open` at `station`. The board is not open yet. */
export function boardOpen(room: SkillRoom, _station: string): void {
  room.refuse(CLIENT_MESSAGES.boardOpen, 'notNow');
}

/** The seat joined or reconnected: after `skills` it gets `jobs`, once the board has been opened. Nothing is sent while the board is not open. */
export function jobsJoined(_room: SkillRoom): void {}
