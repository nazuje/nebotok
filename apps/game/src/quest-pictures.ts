import { spriteFor, stepPictures, type ItemCount, type Language } from '@nebotok/core';
import { el } from './dom.ts';
import { pictureIcon, spriteIcon } from './pictures.ts';
import { STORY } from './story-content.ts';
import { format } from './strings.ts';

/**
 * The pictures a quest shows wherever it appears (the quest banner, the journal), so a player who
 * cannot read yet sees who asked, what to do and how far along it is.
 */

/** Pictures of what a quest's step `step` asks for (core `stepPictures`), or none past its last step. */
export function questGoal(quest: string, step: number): string[] {
  const found = STORY.quests.get(quest)?.steps[step];
  return found ? stepPictures(found, STORY) : [];
}

/** The character who gave a quest, or null for a quest the content no longer has. */
export const questGiver = (quest: string): string | null => STORY.quests.get(quest)?.giver ?? null;

/** How many steps a quest has. */
export const questSteps = (quest: string): number => STORY.quests.get(quest)?.steps.length ?? 0;

/** The giver's portrait. Portraits are 32 pixels, so whole multiples of 32 keep it sharp. */
export function giverPortrait(npc: string, sizePx: number, className: string): HTMLCanvasElement {
  return spriteIcon(spriteFor.portrait(npc), sizePx, { className });
}

/** A row of the goal's pictures, each `sizePx` square. */
export function goalPictures(sprites: readonly string[], sizePx: number, className: string): HTMLElement {
  return el('span', { className, attrs: { 'data-goal': sprites.join(' ') } }, sprites.map((id) => spriteIcon(id, sizePx)));
}

/**
 * One dot per step: filled for each step done, ringed for the step on now. `fresh` is the step
 * just done, which pops once. Hidden from screen readers; the words beside it say the same.
 */
export function questPips(of: number, done: number, fresh: number | null = null): HTMLElement {
  const pips = Array.from({ length: of }, (_, at) => {
    const state = at < done ? 'done' : at === done ? 'now' : 'later';
    const pip = el('span', { className: 'quest-pip', attrs: { 'data-state': state } });
    if (at === fresh) pip.dataset.fresh = '';
    return pip;
  });
  return el('span', { className: 'quest-pips', attrs: { 'aria-hidden': 'true', 'data-done': String(done), 'data-of': String(of) } }, pips);
}

/** Items as their pictures with a count, such as a quest's rewards. `full` adds the full bag before them: these did not fit. */
export function itemRow(items: readonly ItemCount[], language: Language, className: string, full = false): HTMLElement {
  const entries = items.map(({ item, count }) => el('li', { className: 'quest-item', attrs: { 'data-item': item } }, [spriteIcon(spriteFor.item(item), 32), el('span', { text: format('bag.count', language, { count }) })]));
  const lead = full ? [el('li', { className: 'quest-item quest-item-full' }, [pictureIcon('bag-full', 32)])] : [];
  return el('ul', { className, attrs: { 'aria-hidden': 'true' } }, [...lead, ...entries]);
}
