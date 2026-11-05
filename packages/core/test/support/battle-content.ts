import befriending from '../../../../content/creatures/befriending.json' with { type: 'json' };
import moves from '../../../../content/creatures/moves.json' with { type: 'json' };
import rules from '../../../../content/creatures/battle-rules.json' with { type: 'json' };
import species from '../../../../content/creatures/species.json' with { type: 'json' };
import weather from '../../../../content/creatures/weather.json' with { type: 'json' };
import items from '../../../../content/items.json' with { type: 'json' };
import goldenBefriending from '../../fixtures/golden/battle/content/befriending.json' with { type: 'json' };
import goldenItems from '../../fixtures/golden/battle/content/items.json' with { type: 'json' };
import goldenMoves from '../../fixtures/golden/battle/content/moves.json' with { type: 'json' };
import goldenRules from '../../fixtures/golden/battle/content/battle-rules.json' with { type: 'json' };
import goldenSpecies from '../../fixtures/golden/battle/content/species.json' with { type: 'json' };
import goldenWeather from '../../fixtures/golden/battle/content/weather.json' with { type: 'json' };
import { loadBattleContent, type BattleContent, type BattleRules, type BefriendRules } from '../../src/index.ts';

/** The real files in content/creatures/ and content/items.json, so tests battle with the placeholder creatures players see. */
export const battleFiles = { weather, moves, species, rules, befriending, items } as const;
export const battleContent: BattleContent = loadBattleContent(battleFiles);

/**
 * A frozen copy of the battle content that battle goldens replay against, so editing the real
 * creatures never moves a golden hash. Only change it together with re-recording the goldens.
 */
export const goldenBattleContent: BattleContent = loadBattleContent({
  weather: goldenWeather,
  moves: goldenMoves,
  species: goldenSpecies,
  rules: goldenRules,
  befriending: goldenBefriending,
  items: goldenItems,
});

export const speciesIds = [...battleContent.species.keys()].toSorted();
export const weatherIds = [...battleContent.weather.keys()].toSorted();

export function withRules(overrides: Partial<BattleRules>): BattleContent {
  return { ...battleContent, rules: { ...battleContent.rules, ...overrides } };
}

export function withBefriending(overrides: Partial<BefriendRules>): BattleContent {
  return { ...battleContent, befriending: { ...battleContent.befriending, ...overrides } };
}
