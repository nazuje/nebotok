import arena from '../../fixtures/golden/arena/content/arena.json' with { type: 'json' };
import rules from '../../fixtures/golden/arena/content/battle-rules.json' with { type: 'json' };
import items from '../../fixtures/golden/arena/content/items.json' with { type: 'json' };
import moves from '../../fixtures/golden/arena/content/moves.json' with { type: 'json' };
import species from '../../fixtures/golden/arena/content/species.json' with { type: 'json' };
import weather from '../../fixtures/golden/arena/content/weather.json' with { type: 'json' };
import { arenaContentOf, fightContentOf, loadArenaContent, loadFightContent, type ArenaContent, type FightContent } from '../../src/index.ts';
import { battleContent } from './battle-content.ts';

/**
 * A frozen copy of the arena's numbers, the battle rules, weather, moves, species and items, that arena
 * goldens replay against, so editing the real content never moves a golden hash. Only change it
 * together with re-recording the goldens.
 */
export const goldenArenaContent: ArenaContent = loadArenaContent({ arena, rules, species, moves, weather });
/** The same frozen copy with its items.json, for the treats of fight goldens. */
export const goldenFightContent: FightContent = loadFightContent({ arena, rules, species, moves, weather, items });

/** The live content, so property tests walk every creature and move players meet. */
export const arenaContent: ArenaContent = arenaContentOf(battleContent);
export const fightContent: FightContent = fightContentOf(battleContent);
export const arenaSpeciesIds = [...arenaContent.species.keys()].toSorted();
