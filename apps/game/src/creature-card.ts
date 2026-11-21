import type { Language } from '@nebotok/core';
import { moveName, moveType, speciesName, speciesType, weatherName } from './battle-content.ts';
import { creaturePortrait } from './creature-art.ts';
import { el } from './dom.ts';
import { healthLevel } from './health-level.ts';
import { pictureIcon, shrineIcon, weatherIcon } from './pictures.ts';
import { format } from './strings.ts';

/** What every creature card shows, from a battle view or a saved creature. */
export type CardCreature = { readonly species: string; readonly level: number; readonly hp: number; readonly maxHp: number; readonly moves?: readonly string[] };

/** A health bar with its numbers for screen readers, and the numbers on screen when `labelled`. */
export function healthBar(hp: number, maxHp: number, language: Language, labelled: boolean): HTMLElement {
  const label = format('battle.health', language, { hp, max: maxHp });
  const percent = maxHp > 0 ? Math.round((100 * Math.max(0, hp)) / maxHp) : 0;
  const fill = el('div', { className: 'health-fill' });
  fill.style.width = `${percent}%`;
  fill.dataset.level = healthLevel(hp, maxHp);
  const bar = el('div', { className: 'health-bar', attrs: { role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(maxHp), 'aria-valuenow': String(Math.max(0, hp)) } }, [fill]);
  return labelled ? el('div', { className: 'health' }, [bar, el('span', { className: 'health-text', text: label, attrs: { 'aria-hidden': 'true' } })]) : bar;
}

/** On a hurt creature's card: an arrow to the shrine, where resting heals the team (`needsRest`). */
export function restHint(sizePx: number): HTMLElement {
  return el('span', { className: 'rest-hint', attrs: { 'aria-hidden': 'true' } }, [pictureIcon('arrow', sizePx), shrineIcon(sizePx)]);
}

/** A weather type's chip in its colour: its icon, with its name small underneath and as the chip's accessible name. */
export function typeChip(type: string | null, language: Language): HTMLElement {
  if (!type) return el('span', { className: 'type-chip type-none' });
  const name = weatherName(type, language);
  return el('span', { className: `type-chip type-${type}`, attrs: { role: 'img', 'aria-label': name, 'data-type': type } }, [weatherIcon(type, 32), el('span', { className: 'type-name', text: name, attrs: { 'aria-hidden': 'true' } })]);
}

/** A move's weather icon, named for screen readers, to stand before the move's name; nothing for a move without a type. */
export function moveTypeIcon(move: string, language: Language, sizePx: number): HTMLElement[] {
  const type = moveType(move);
  return type ? [weatherIcon(type, sizePx, { label: weatherName(type, language) })] : [];
}

/** The name, level and health of a creature, with its picture unless `portrait` is false. */
export function creatureSummary(creature: CardCreature, language: Language, options: { portrait?: boolean; labelled?: boolean } = {}): HTMLElement[] {
  const head = el('div', { className: 'creature-head' }, [
    el('span', { className: 'creature-name', text: speciesName(creature.species, language) }),
    el('span', { className: 'creature-level', text: format('battle.level', language, { level: creature.level }) }),
  ]);
  const parts: HTMLElement[] = [];
  if (options.portrait !== false) parts.push(creaturePortrait(creature.species));
  parts.push(el('div', { className: 'creature-info' }, [head, healthBar(creature.hp, creature.maxHp, language, options.labelled ?? false)]));
  return parts;
}

/** The creature's weather type and moves, each move in its type's colour. */
export function creatureDetails(creature: Pick<CardCreature, 'species' | 'moves'>, language: Language): HTMLElement {
  const moves = (creature.moves ?? []).map((move) => el('li', { className: `move-chip type-${moveType(move) ?? 'none'}` }, [...moveTypeIcon(move, language, 16), el('span', { text: moveName(move, language) })]));
  return el('div', { className: 'creature-details' }, [typeChip(speciesType(creature.species), language), el('ul', { className: 'move-chips' }, moves)]);
}
