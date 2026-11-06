import type { Language } from '@nebotok/core';
import { moveName, moveType, speciesName, speciesType, weatherName } from './battle-content.ts';
import { creaturePortrait } from './creature-art.ts';
import { el } from './dom.ts';
import { format } from './strings.ts';

/** What every creature card shows, from a battle view or a saved creature. */
export type CardCreature = { readonly species: string; readonly level: number; readonly hp: number; readonly maxHp: number; readonly moves?: readonly string[] };

/** A health bar with its numbers for screen readers, and the numbers on screen when `labelled`. */
export function healthBar(hp: number, maxHp: number, language: Language, labelled: boolean): HTMLElement {
  const label = format('battle.health', language, { hp, max: maxHp });
  const percent = maxHp > 0 ? Math.round((100 * Math.max(0, hp)) / maxHp) : 0;
  const fill = el('div', { className: 'health-fill' });
  fill.style.width = `${percent}%`;
  fill.dataset.level = percent > 50 ? 'high' : percent > 20 ? 'mid' : 'low';
  const bar = el('div', { className: 'health-bar', attrs: { role: 'meter', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': String(maxHp), 'aria-valuenow': String(Math.max(0, hp)) } }, [fill]);
  return labelled ? el('div', { className: 'health' }, [bar, el('span', { className: 'health-text', text: label, attrs: { 'aria-hidden': 'true' } })]) : bar;
}

/** A small chip naming a weather type, in that type's colour. */
export function typeChip(type: string | null, language: Language): HTMLElement {
  return el('span', { className: `type-chip type-${type ?? 'none'}`, text: type ? weatherName(type, language) : '' });
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
  const moves = (creature.moves ?? []).map((move) => el('li', { className: `move-chip type-${moveType(move) ?? 'none'}`, text: moveName(move, language) }));
  return el('div', { className: 'creature-details' }, [typeChip(speciesType(creature.species), language), el('ul', { className: 'move-chips' }, moves)]);
}
