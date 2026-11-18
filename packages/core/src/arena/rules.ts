import type { ArenaRules, Species } from '../content.ts';

/**
 * Everything an arena step and its start read: the arena's numbers (`content/creatures/arena.json`,
 * of which the step reads `island`, `dash` and `storm` so far) and the species, for walk caps.
 */
export type ArenaContent = {
  readonly arena: ArenaRules;
  readonly species: ReadonlyMap<string, Species>;
};
