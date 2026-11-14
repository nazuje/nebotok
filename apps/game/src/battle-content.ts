import { StartersFile, loadBattleContent, treatLiking, type BattleContent, type Language } from '@nebotok/core';
import rules from '../../../content/creatures/battle-rules.json';
import befriending from '../../../content/creatures/befriending.json';
import moves from '../../../content/creatures/moves.json';
import species from '../../../content/creatures/species.json';
import weather from '../../../content/creatures/weather.json';
import items from '../../../content/items.json';
import starters from '../../../content/starters.json';
import type { FavouriteOf } from './battle-playback.ts';

/** The creatures, moves, weather types and treats, by id, for naming and drawing what the server sends. */
export const CONTENT: BattleContent = loadBattleContent({ weather, moves, species, rules, befriending, items });
export const STARTERS = StartersFile.parse(starters);

export const speciesName = (id: string, language: Language): string => CONTENT.species.get(id)?.name[language] ?? id;
export const speciesType = (id: string): string | null => CONTENT.species.get(id)?.type ?? null;
export const moveName = (id: string, language: Language): string => CONTENT.moves.get(id)?.name[language] ?? id;
export const moveType = (id: string): string | null => CONTENT.moves.get(id)?.type ?? null;
export const weatherName = (id: string, language: Language): string => CONTENT.weather.get(id)?.name[language] ?? id;
export const itemName = (id: string, language: Language): string => CONTENT.items.get(id)?.name[language] ?? id;
export const isTreat = (id: string): boolean => CONTENT.items.get(id)?.kind === 'treat';

/** Whether `item` is a favourite treat of the species `speciesId`, as befriending counts it (core `treatLiking`). */
export function isFavourite(item: string, speciesId: string): boolean {
  const treat = CONTENT.items.get(item);
  const kind = CONTENT.species.get(speciesId);
  return treat?.kind === 'treat' && kind !== undefined && treatLiking(treat, kind) === 'favourite';
}

/** The treat to name as a species' favourite: its `favouriteTreat`, or else a treat that names it in `likedBy`; null when none does. */
export function favouriteTreat(speciesId: string): string | null {
  return CONTENT.species.get(speciesId)?.favouriteTreat ?? [...CONTENT.items.keys()].find((item) => isFavourite(item, speciesId)) ?? null;
}

/** The favourite to name after the species `speciesId` turns down `item`: null when `item` is one of its favourites, or it has none. */
export const favouriteBesides: FavouriteOf = (speciesId, item) => (isFavourite(item, speciesId) ? null : favouriteTreat(speciesId));
