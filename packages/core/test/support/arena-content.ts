import arena from '../../fixtures/golden/arena/content/arena.json' with { type: 'json' };
import species from '../../fixtures/golden/arena/content/species.json' with { type: 'json' };
import liveSpecies from '../../../../content/creatures/species.json' with { type: 'json' };
import { ArenaRules, SpeciesFile, type ArenaContent } from '../../src/index.ts';

/**
 * A frozen copy of the arena's numbers and the species, that arena goldens replay against, so
 * editing the real content never moves a golden hash. Only change it together with re-recording
 * the goldens.
 */
export const goldenArenaContent: ArenaContent = {
  arena: ArenaRules.parse(arena),
  species: new Map(SpeciesFile.parse(species).species.map((entry) => [entry.id, entry])),
};

/**
 * The live species with the frozen arena numbers, so property tests walk every creature players
 * meet. The real `content/creatures/arena.json` takes the numbers' place once it exists.
 */
export const arenaContent: ArenaContent = {
  arena: goldenArenaContent.arena,
  species: new Map(SpeciesFile.parse(liveSpecies).species.map((entry) => [entry.id, entry])),
};

export const arenaSpeciesIds = [...arenaContent.species.keys()].toSorted();
