import { spriteFor, type Language, type SkillResultMessage } from '@nebotok/core';
import { el, element } from './dom.ts';
import { pictureIcon, spriteIcon } from './pictures.ts';
import { format } from './strings.ts';

/** What a tiny game's result shows: a star burst and the catch flying into the bag, the catch alone, no room for it, or another go. */
export type SkillResultKind = 'perfect' | 'success' | 'bagFull' | 'miss';

type Judged = Pick<SkillResultMessage, 'outcome' | 'items' | 'extra'>;

/** The pictures a result needs: a won game that put nothing in the bag because it had no room is `bagFull`. */
export function skillResultKind(result: Judged): SkillResultKind {
  if (result.outcome !== 'perfect' && result.outcome !== 'success') return 'miss';
  return result.items.length === 0 && result.extra.length > 0 ? 'bagFull' : result.outcome;
}

const itemPicture = (item: string, sizePx: number, className: string) => spriteIcon(spriteFor.item(item), sizePx, { className });

/** The bag as the bag button draws it, so a catch flies into the bag the player opens. */
function bag(): HTMLElement {
  const drawn = el('span', { className: 'outcome-bag' });
  drawn.append(element<SVGSVGElement>('.bag-button svg').cloneNode(true));
  return drawn;
}

/** The catch flying into the bag, "+N" landing on it; a perfect game's catch sits on a star burst. */
function gain(item: string, count: number, perfect: boolean, language: Language): HTMLElement {
  const flyer = itemPicture(item, 48, 'outcome-flyer');
  const from = perfect ? el('span', { className: 'outcome-burst' }, [pictureIcon('star-burst', 96, { className: 'outcome-rays' }), flyer]) : flyer;
  const into = bag();
  into.append(el('span', { className: 'outcome-plus', text: format('skill.count', language, { count }) }));
  return el('div', { className: perfect ? 'outcome-row outcome-gain perfect' : 'outcome-row outcome-gain' }, [from, pictureIcon('arrow', 32), into]);
}

/** The item that had no room, beside the full bag. */
const noRoom = (item: string, sizePx: number) => el('div', { className: 'outcome-row outcome-full' }, [itemPicture(item, sizePx, 'outcome-left'), pictureIcon('bag-full', sizePx + 16, { className: 'outcome-full-bag' })]);

/**
 * How a tiny game went, as pictures over its play area for a player who cannot read the line
 * under it: the catch flying into the bag with "+N" (on a star burst when perfect), the full bag
 * beside what had no room, or what was missed wobbling beside the try-again loop. `item` is what
 * the game was for. The movement is a bonus; reduced motion shows the same pictures standing still.
 */
export function outcomePictures(result: Judged, item: string | null, language: Language): HTMLElement {
  const kind = skillResultKind(result);
  const rows: HTMLElement[] = [];
  const got = result.items[0];
  const lost = result.extra[0];
  if (kind === 'miss') {
    rows.push(el('div', { className: 'outcome-row outcome-miss' }, [...(item ? [itemPicture(item, 48, 'outcome-wobble')] : []), pictureIcon('again', 64, { className: 'outcome-again' })]));
  } else if (kind === 'bagFull') {
    if (lost) rows.push(noRoom(lost.item, 48));
  } else {
    if (got) rows.push(gain(got.item, got.count, kind === 'perfect', language));
    if (lost) rows.push(noRoom(lost.item, 32));
  }
  return el('div', { className: 'skill-outcome', attrs: { 'aria-hidden': 'true', 'data-kind': kind } }, rows);
}
