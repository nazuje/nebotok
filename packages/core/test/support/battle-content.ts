import moves from '../../../../content/creatures/moves.json' with { type: 'json' };
import rules from '../../../../content/creatures/battle-rules.json' with { type: 'json' };
import species from '../../../../content/creatures/species.json' with { type: 'json' };
import weather from '../../../../content/creatures/weather.json' with { type: 'json' };
import { loadBattleContent, type BattleContent, type BattleRules } from '../../src/index.ts';

/** The real files in content/creatures/, so tests battle with the placeholder creatures players see. */
export const battleFiles = { weather, moves, species, rules } as const;
export const battleContent: BattleContent = loadBattleContent(battleFiles);

export const speciesIds = [...battleContent.species.keys()].toSorted();
export const weatherIds = [...battleContent.weather.keys()].toSorted();

export function withRules(overrides: Partial<BattleRules>): BattleContent {
  return { ...battleContent, rules: { ...battleContent.rules, ...overrides } };
}
