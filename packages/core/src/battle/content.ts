import type { ZodType } from 'zod';
import { BattleRules, BefriendRules, ItemsFile, MovesFile, SpeciesFile, WeatherFile, type Item, type Move, type Species, type WeatherType } from '../content.ts';

/** The files a battle reads, raw or parsed: the four in `content/creatures/`, befriending.json and items.json. */
export type BattleContentFiles = {
  readonly weather: unknown;
  readonly moves: unknown;
  readonly species: unknown;
  readonly rules: unknown;
  readonly befriending: unknown;
  readonly items: unknown;
};

/** Everything a battle reads, looked up by id. */
export type BattleContent = {
  readonly weather: ReadonlyMap<string, WeatherType>;
  readonly moves: ReadonlyMap<string, Move>;
  readonly species: ReadonlyMap<string, Species>;
  readonly rules: BattleRules;
  readonly befriending: BefriendRules;
  readonly items: ReadonlyMap<string, Item>;
};

export class BattleContentError extends Error {
  override name = 'BattleContentError';
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`battle content has ${problems.length} problem(s): ${problems.join('; ')}`);
    this.problems = problems;
  }
}

/** Links between files: every type, weather, move, species and treat a file names must exist. */
function linkProblems({ weather, moves, species, items }: BattleContent): string[] {
  const problems: string[] = [];
  for (const move of moves.values()) {
    if (!weather.has(move.type)) problems.push(`moves.json "${move.id}": type "${move.type}" is not a weather type`);
    if (move.setsWeather !== undefined && !weather.has(move.setsWeather)) problems.push(`moves.json "${move.id}": setsWeather "${move.setsWeather}" is not a weather type`);
  }
  for (const entry of species.values()) {
    if (!weather.has(entry.type)) problems.push(`species.json "${entry.id}": type "${entry.type}" is not a weather type`);
    for (const id of entry.moves) {
      if (!moves.has(id)) problems.push(`species.json "${entry.id}": knows "${id}", which is not in moves.json`);
    }
    for (const { move, level } of entry.learnset ?? []) {
      if (level > 1 && !moves.has(move)) problems.push(`species.json "${entry.id}": learns "${move}" at level ${level}, which is not in moves.json`);
    }
    if (entry.moves.every((id) => (moves.get(id)?.power ?? 0) === 0)) problems.push(`species.json "${entry.id}": knows no move that does damage`);
    if (entry.favouriteTreat !== undefined && items.get(entry.favouriteTreat)?.kind !== 'treat') {
      problems.push(`species.json "${entry.id}": favouriteTreat "${entry.favouriteTreat}" is not a treat in items.json`);
    }
  }
  for (const item of items.values()) {
    if (item.kind !== 'treat') continue;
    for (const id of item.likedBy.species) if (!species.has(id)) problems.push(`items.json "${item.id}": likedBy.species names "${id}", which is not in species.json`);
    for (const id of item.likedBy.types) if (!weather.has(id)) problems.push(`items.json "${item.id}": likedBy.types names "${id}", which is not a weather type`);
  }
  return problems;
}

function analyse(files: BattleContentFiles): { content: BattleContent | null; problems: readonly string[] } {
  const problems: string[] = [];
  const parse = <T>(label: string, schema: ZodType<T>, raw: unknown): T | null => {
    const result = schema.safeParse(raw);
    if (result.success) return result.data;
    for (const issue of result.error.issues) problems.push(`${label} ${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`);
    return null;
  };
  const weather = parse('weather.json', WeatherFile, files.weather);
  const moves = parse('moves.json', MovesFile, files.moves);
  const species = parse('species.json', SpeciesFile, files.species);
  const rules = parse('battle-rules.json', BattleRules, files.rules);
  const befriending = parse('befriending.json', BefriendRules, files.befriending);
  const items = parse('items.json', ItemsFile, files.items);
  if (!weather || !moves || !species || !rules || !befriending || !items) return { content: null, problems };
  const content: BattleContent = {
    weather: new Map(weather.types.map((type) => [type.id, type])),
    moves: new Map(moves.moves.map((move) => [move.id, move])),
    species: new Map(species.species.map((entry) => [entry.id, entry])),
    rules,
    befriending,
    items: new Map(items.items.map((item) => [item.id, item])),
  };
  const links = linkProblems(content);
  return links.length > 0 ? { content: null, problems: links } : { content, problems };
}

/** Every problem in the battle content: each file's own, then the links between them. Empty means valid. */
export function battleContentProblems(files: BattleContentFiles): readonly string[] {
  return analyse(files).problems;
}

export function loadBattleContent(files: BattleContentFiles): BattleContent {
  const { content, problems } = analyse(files);
  if (!content) throw new BattleContentError(problems);
  return content;
}
