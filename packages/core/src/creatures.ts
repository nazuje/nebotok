import type { BattleContent } from './battle/content.ts';
import { maxHpAt } from './battle/damage.ts';
import { MAX_TEAM, PLAYER_SIDE, WILD_SIDE, activeCreature, type BattleSetup, type BattleState } from './battle/state.ts';
import type { RenamedFile, Species, StartersFile, TeamFaintedRules } from './content.ts';
import type { WildEncounter } from './encounter.ts';
import { STORAGE_LIMIT, type CreatureInstance, type SaveData } from './save.ts';

/**
 * The creature-and-treat part of a save. Every function here is pure: it returns a new Progress and
 * never changes the one passed in. A function a player's request drives returns null when the
 * request is not allowed, so the server can refuse it.
 */
export type Progress = Pick<SaveData, 'team' | 'storage' | 'inventory' | 'lastShrine' | 'seen' | 'befriended'>;

/** Most of one item a player can carry; extra is lost. */
export const MAX_ITEM_COUNT = 999;

export function emptyProgress(): Progress {
  return { team: [], storage: [], inventory: [], lastShrine: null, seen: [], befriended: [] };
}

/** The part of a save that is Progress. */
export function progressOf(data: SaveData): Progress {
  const { team, storage, inventory, lastShrine, seen, befriended } = data;
  return { team, storage, inventory, lastShrine, seen, befriended };
}

/** A player with no creature at all has not chosen their starter yet. */
export function needsStarter(progress: Progress): boolean {
  return progress.team.length === 0 && progress.storage.length === 0;
}

function speciesOf(content: BattleContent, id: string): Species {
  const species = content.species.get(id);
  if (!species) throw new RangeError(`unknown species "${id}"`);
  return species;
}

/** The moves a creature of this species knows at a level. Every species knows its four from the start; learning more as it grows is not a rule yet. */
export function movesAt(species: Species, _level: number): readonly string[] {
  return species.moves;
}

export function maxHpOf(creature: Pick<CreatureInstance, 'species' | 'level'>, content: BattleContent): number {
  return maxHpAt(speciesOf(content, creature.species), creature.level);
}

/** A new creature at full health with the moves of its level. */
export function newCreature(speciesId: string, level: number, content: BattleContent): CreatureInstance {
  const species = speciesOf(content, speciesId);
  return { species: species.id, level, xp: 0, hp: maxHpAt(species, level), moves: [...movesAt(species, level)] };
}

/**
 * Progress, or a whole save's data, with every species id that `renamed` lists replaced by the one
 * that stands in for it now, so an old save still names real species. A renamed creature keeps its
 * level, experience and nickname, and takes the new species' moves for its level, with its health
 * capped at the new species' full health. Every other creature is left as it is.
 */
export function renameSpecies<T extends Progress>(progress: T, renamed: RenamedFile, content: BattleContent): T {
  const rename = (id: string) => (Object.hasOwn(renamed.species, id) ? (renamed.species[id] ?? id) : id);
  const once = (ids: readonly string[]) => [...new Set(ids.map(rename))];
  const creature = (owned: CreatureInstance): CreatureInstance => {
    if (rename(owned.species) === owned.species) return owned;
    const species = speciesOf(content, rename(owned.species));
    return { ...owned, species: species.id, hp: Math.min(owned.hp, maxHpAt(species, owned.level)), moves: [...movesAt(species, owned.level)] };
  };
  return { ...progress, team: progress.team.map(creature), storage: progress.storage.map(creature), seen: once(progress.seen), befriended: once(progress.befriended) };
}

function withSpecies(list: readonly string[], species: string): string[] {
  return list.includes(species) ? [...list] : [...list, species];
}

export function markSeen(progress: Progress, species: string): Progress {
  return { ...progress, seen: withSpecies(progress.seen, species) };
}

/** Befriending a species also means having seen it. */
export function markBefriended(progress: Progress, species: string): Progress {
  return { ...progress, seen: withSpecies(progress.seen, species), befriended: withSpecies(progress.befriended, species) };
}

export function itemCount(progress: Progress, item: string): number {
  return progress.inventory.find((entry) => entry.item === item)?.count ?? 0;
}

/** Adds `count` of an item, up to MAX_ITEM_COUNT. */
export function addItems(progress: Progress, item: string, count: number): Progress {
  if (!Number.isInteger(count) || count < 1) throw new RangeError(`addItems() needs a whole count of at least 1, got ${count}`);
  const total = Math.min(itemCount(progress, item) + count, MAX_ITEM_COUNT);
  const inventory = progress.inventory.some((entry) => entry.item === item)
    ? progress.inventory.map((entry) => (entry.item === item ? { item, count: total } : entry))
    : [...progress.inventory, { item, count: total }];
  return { ...progress, inventory };
}

/** Takes one of an item, as when a treat is offered; null when the player has none. */
export function useItem(progress: Progress, item: string): Progress | null {
  const count = itemCount(progress, item);
  if (count === 0) return null;
  const inventory = count === 1 ? progress.inventory.filter((entry) => entry.item !== item) : progress.inventory.map((entry) => (entry.item === item ? { item, count: count - 1 } : entry));
  return { ...progress, inventory };
}

/**
 * Gives a new player the starter they chose, at the starters' level, and the starting items. Null
 * when they already have a creature or `species` is not one of the starters.
 */
export function chooseStarter(progress: Progress, species: string, starters: StartersFile, content: BattleContent): Progress | null {
  if (!needsStarter(progress) || !starters.species.includes(species)) return null;
  let next: Progress = markBefriended({ ...progress, team: [newCreature(species, starters.level, content)] }, species);
  for (const { item, count } of starters.items) next = addItems(next, item, count);
  return next;
}

export function hasRoomForCreature(progress: Progress): boolean {
  return progress.team.length < MAX_TEAM || progress.storage.length < STORAGE_LIMIT;
}

/** Adds a creature to the end of the team, or to storage when the team is full. Null when both are full. */
export function addCreature(progress: Progress, creature: CreatureInstance): { readonly progress: Progress; readonly placedIn: 'team' | 'storage' } | null {
  if (progress.team.length < MAX_TEAM) return { progress: { ...progress, team: [...progress.team, creature] }, placedIn: 'team' };
  if (progress.storage.length < STORAGE_LIMIT) return { progress: { ...progress, storage: [...progress.storage, creature] }, placedIn: 'storage' };
  return null;
}

/** Puts the team in a new order: `order[i]` is the old place of the creature that goes to place i. Null unless it names every place once. */
export function reorderTeam(progress: Progress, order: readonly number[]): Progress | null {
  const { team } = progress;
  if (order.length !== team.length || new Set(order).size !== order.length) return null;
  const reordered = order.map((from) => team[from]);
  if (reordered.some((creature) => creature === undefined)) return null;
  return { ...progress, team: reordered as CreatureInstance[] };
}

/**
 * Moves creatures between the team and storage, at a shrine. Both indexes swap those two creatures;
 * only `team` puts that creature into storage (the team keeps at least one); only `storage` brings
 * that creature onto the end of the team (when it has room). Null when the move is not allowed.
 */
export function swapStorage(progress: Progress, teamIndex: number | null, storageIndex: number | null): Progress | null {
  const { team, storage } = progress;
  const fromTeam = teamIndex === null ? undefined : team[teamIndex];
  const fromStorage = storageIndex === null ? undefined : storage[storageIndex];
  if (teamIndex !== null && storageIndex !== null) {
    if (!fromTeam || !fromStorage) return null;
    return { ...progress, team: team.with(teamIndex, fromStorage), storage: storage.with(storageIndex, fromTeam) };
  }
  if (teamIndex !== null) {
    if (!fromTeam || team.length <= 1 || storage.length >= STORAGE_LIMIT) return null;
    return { ...progress, team: team.toSpliced(teamIndex, 1), storage: [...storage, fromTeam] };
  }
  if (storageIndex !== null) {
    if (!fromStorage || team.length >= MAX_TEAM) return null;
    return { ...progress, team: [...team, fromStorage], storage: storage.toSpliced(storageIndex, 1) };
  }
  return null;
}

/** Every team creature back to full health, as at a shrine. */
export function healTeam(progress: Progress, content: BattleContent): Progress {
  return { ...progress, team: progress.team.map((creature) => ({ ...creature, hp: maxHpOf(creature, content) })) };
}

/** Whether the team has a creature that can battle. */
export function canBattle(progress: Progress): boolean {
  return progress.team.some((creature) => creature.hp > 0);
}

/** After the whole team fainted, by the rules in shrines.json. Moving the player to `wakePoint` is the server's part. */
export function wakeAfterFainting(progress: Progress, rules: TeamFaintedRules, content: BattleContent): Progress {
  const inventory = progress.inventory.flatMap((entry) => {
    const count = Math.floor((entry.count * rules.itemsKeptPercent) / 100);
    return count > 0 ? [{ item: entry.item, count }] : [];
  });
  const kept = { ...progress, inventory };
  return rules.healTeam ? healTeam(kept, content) : kept;
}

/**
 * The battle a wild encounter starts: the whole team in order as side 0 (fainted creatures too, so
 * team place i is battle creature `a<i+1>`), the wild creature as side 1.
 */
export function wildBattleSetup(team: readonly CreatureInstance[], wild: WildEncounter, weather: string | null): BattleSetup {
  return {
    sides: [{ creatures: team.map(({ species, level, hp, moves }) => ({ species, level, hp, moves: [...moves] })) }, { creatures: [{ species: wild.species, level: wild.level }] }],
    weather,
    wild: true,
  };
}

/** The team after a battle from `wildBattleSetup`: each creature keeps the health it ended with. */
export function teamAfterBattle(team: readonly CreatureInstance[], state: BattleState): CreatureInstance[] {
  return team.map((creature, at) => ({ ...creature, hp: state.sides[PLAYER_SIDE].creatures[at]?.hp ?? creature.hp }));
}

/** The wild creature of a battle that ended `befriended`, as a new team creature at full health. */
export function befriendedCreature(state: BattleState, content: BattleContent): CreatureInstance {
  const wild = activeCreature(state, WILD_SIDE);
  return { ...newCreature(wild.species, wild.level, content), moves: [...wild.moves] };
}
