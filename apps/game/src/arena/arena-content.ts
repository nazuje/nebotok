import { arenaContentOf, type ArenaContent } from '@nebotok/core';
import { CONTENT } from '../battle-content.ts';

/** The arena's rules and creatures, from content/creatures/arena.json and the battle content. */
export const ARENA: ArenaContent = arenaContentOf(CONTENT);
