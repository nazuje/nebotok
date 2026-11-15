import type { BattleResult, BattleView, BefriendResult, Language } from '@nebotok/core';
import { moveName, moveType } from './battle-content.ts';
import { gainsOf, resultKind, resultLines, type CreatureGains, type ResultKind } from './battle-model.ts';
import type { Line } from './battle-playback.ts';
import { creaturePortrait } from './creature-art.ts';
import { moveTypeIcon } from './creature-card.ts';
import { el } from './dom.ts';
import { pictureIcon, shrineIcon } from './pictures.ts';
import { format } from './strings.ts';

/** The words of one line, as the battle screen says them. */
export type SayLine = (line: Line) => string;

/** A portrait in a frame of its own, so a badge can sit over it or it can fly somewhere. */
const portrait = (species: string | undefined, className: string): HTMLElement => el('span', { className: `result-portrait ${className}` }, species ? [creaturePortrait(species)] : []);

/** How the battle ended, as pictures a player who cannot read follows with the sound off. */
function heroPictures(kind: ResultKind, first: Line | undefined, view: BattleView): Node[] {
  const lead = view.team.creatures[view.team.active]?.species;
  switch (kind) {
    case 'won':
      return [el('span', { className: 'result-burst' }, [pictureIcon('star-burst', 96, { className: 'result-rays' }), pictureIcon('trophy', 64, { className: 'result-trophy' })])];
    case 'befriended':
      return [portrait(first?.species, 'result-friend'), pictureIcon('heart', 32, { className: 'result-heart' })];
    case 'stored':
      return [portrait(first?.species, 'result-flyer'), pictureIcon('arrow', 32), shrineIcon(48, { className: 'result-shrine' })];
    case 'fainted':
      return [portrait(lead, 'result-resting'), pictureIcon('arrow', 32), shrineIcon(48, { className: 'result-shrine' })];
    case 'ran':
      return [pictureIcon('footprints', 64, { className: 'result-run' })];
    default:
      return [];
  }
}

/** One creature's gains: its portrait with "Lv ↑" over it after a level up, its experience, and each new move as its chip. */
function gainsRow(gains: CreatureGains, view: BattleView, language: Language, say: SayLine): HTMLElement {
  const species = view.team.creatures.find((creature) => creature.id === gains.creature)?.species;
  const face = portrait(species, '');
  if (gains.level !== null) {
    face.append(el('span', { className: 'result-level-up' }, [pictureIcon('arrow', 16, { className: 'up' }), el('span', { text: format('battle.level', language, { level: gains.level }) })]));
  }
  const shown: HTMLElement[] = [];
  if (gains.xp !== null) shown.push(el('span', { className: 'result-xp' }, [pictureIcon('star-burst', 32), el('span', { text: format('battle.xpGained', language, { xp: gains.xp }) })]));
  for (const move of gains.moves) {
    shown.push(el('span', { className: `move-chip result-move type-${moveType(move) ?? 'none'}` }, [...moveTypeIcon(move, language, 32), el('span', { text: moveName(move, language) })]));
  }
  // Screen readers get the sentences; the pictures say the same for everyone else.
  const words = el('span', { className: 'visually-hidden', text: gains.lines.map(say).join(' ') });
  const pictures = el('div', { className: 'result-gains', attrs: { 'aria-hidden': 'true' } }, [face, el('div', { className: 'result-gain-list' }, shown)]);
  return el('li', { className: 'result-reward', attrs: { 'data-creature': gains.creature } }, [words, pictures]);
}

/**
 * How a battle went, in pictures with the words for readers under them: a trophy for a win, the new
 * friend with a heart, or flying to a shrine when the team is full, footprints for running away and
 * the team going to rest at the shrine after it faints. Below, each creature that grew, with its
 * experience, "Lv ↑" over its portrait and every new move as its chip.
 */
export function resultPictures(result: BattleResult, befriended: BefriendResult | null, view: BattleView, language: Language, say: SayLine): HTMLElement {
  const [first, ...rest] = resultLines(result, befriended, view);
  const kind = resultKind(first);
  const hero = el('div', { className: 'result-hero', attrs: { 'data-kind': kind } }, [
    el('div', { className: 'result-pictures', attrs: { 'aria-hidden': 'true' } }, heroPictures(kind, first, view)),
    el('p', { className: 'result-words', text: first ? say(first) : '' }),
  ]);
  const gains = gainsOf(rest);
  const parts: HTMLElement[] = [hero];
  if (gains.length > 0) parts.push(el('ul', { className: 'result-rewards' }, gains.map((entry) => gainsRow(entry, view, language, say))));
  return el('div', { className: 'battle-result' }, parts);
}
