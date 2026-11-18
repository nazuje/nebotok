import arena from '../../fixtures/golden/arena/content/arena.json' with { type: 'json' };
import rules from '../../fixtures/golden/arena/content/battle-rules.json' with { type: 'json' };
import moves from '../../fixtures/golden/arena/content/moves.json' with { type: 'json' };
import species from '../../fixtures/golden/arena/content/species.json' with { type: 'json' };
import weather from '../../fixtures/golden/arena/content/weather.json' with { type: 'json' };
import { arenaContentOf, loadArenaContent, type ArenaContent } from '../../src/index.ts';
import { battleContent } from './battle-content.ts';

/**
 * A frozen copy of the arena's numbers, the battle rules, weather, moves and species, that arena
 * goldens replay against, so editing the real content never moves a golden hash. Only change it
 * together with re-recording the goldens.
 */
export const goldenArenaContent: ArenaContent = loadArenaContent({ arena, rules, species, moves, weather });

/** The live content, so property tests walk every creature and move players meet. */
export const arenaContent: ArenaContent = arenaContentOf(battleContent);
export const arenaSpeciesIds = [...arenaContent.species.keys()].toSorted();
