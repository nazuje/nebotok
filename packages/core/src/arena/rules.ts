import { arenaLinkProblems } from '../arena-links.ts';
import type { BattleContent } from '../battle/content.ts';
import type { DamageContent } from '../battle/damage.ts';
import { ArenaRules, BattleRules, ItemsFile, MovesFile, SpeciesFile, WeatherFile, type Item, type Move, type Species, type WeatherType } from '../content.ts';

/**
 * Everything an arena step and its start read: the arena's numbers (`content/creatures/arena.json`),
 * the battle rules and weather chart that damage uses (with the arena's own strong and weak
 * percents, `arenaDamageContent`), the species, for walk caps, health and stats, and the moves,
 * whose `arena` blocks say what each button does.
 */
export type ArenaContent = {
  readonly arena: ArenaRules;
  readonly rules: BattleRules;
  readonly species: ReadonlyMap<string, Species>;
  readonly moves: ReadonlyMap<string, Move>;
  readonly weather: ReadonlyMap<string, WeatherType>;
};

/** What arena damage reads: the battle rules with arena.json's softer type chart in place of theirs. */
export function arenaDamageContent(content: ArenaContent): DamageContent {
  const { strongPercent, weakPercent } = content.arena;
  return { rules: { ...content.rules, strongPercent, weakPercent }, weather: content.weather };
}

/** The arena's share of a battle's content, which must have been loaded with arena.json. */
export function arenaContentOf(content: BattleContent): ArenaContent {
  if (!content.arena) throw new RangeError('arena: the battle content was loaded without arena.json');
  return { arena: content.arena, rules: content.rules, species: content.species, moves: content.moves, weather: content.weather };
}

/** The raw files an arena fight reads: arena.json, battle-rules.json, species.json, moves.json and weather.json. */
export type ArenaContentFiles = {
  readonly arena: unknown;
  readonly rules: unknown;
  readonly species: unknown;
  readonly moves: unknown;
  readonly weather: unknown;
};

/** Parses the arena's files and checks the links between them, as the arena goldens' frozen copy needs. */
export function loadArenaContent(files: ArenaContentFiles): ArenaContent {
  const arena = ArenaRules.parse(files.arena);
  const moves = new Map(MovesFile.parse(files.moves).moves.map((move) => [move.id, move]));
  const species = new Map(SpeciesFile.parse(files.species).species.map((entry) => [entry.id, entry]));
  const problems = arenaLinkProblems(arena, moves, species);
  if (problems.length > 0) throw new RangeError(`arena content has ${problems.length} problem(s): ${problems.join('; ')}`);
  const weather = new Map(WeatherFile.parse(files.weather).types.map((type) => [type.id, type]));
  return { arena, rules: BattleRules.parse(files.rules), species, moves, weather };
}

/** What a whole fight reads (fight.ts): the arena's content and the items, for the treats a wild fight throws. */
export type FightContent = ArenaContent & { readonly items: ReadonlyMap<string, Item> };

export function fightContentOf(content: BattleContent): FightContent {
  return { ...arenaContentOf(content), items: content.items };
}

/** The arena's raw files and items.json, as the arena goldens' frozen copy holds them. */
export type FightContentFiles = ArenaContentFiles & { readonly items: unknown };

export function loadFightContent(files: FightContentFiles): FightContent {
  return { ...loadArenaContent(files), items: new Map(ItemsFile.parse(files.items).items.map((item) => [item.id, item])) };
}
