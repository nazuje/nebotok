import type { Language } from '@nebotok/core';
import { moveName, speciesName } from './battle-content.ts';
import { creaturePortrait } from './creature-art.ts';
import { el } from './dom.ts';
import { abilityIcon, pictureIcon } from './pictures.ts';
import { format, text } from './strings.ts';

/** How long the new-move toast stays before it goes away by itself (docs/arena.md, "Loadout picker"). */
export const NEW_MOVE_MS = 6_000;

/** A move the team creature at `index` learned. */
export type NewMove = { readonly index: number; readonly species: string; readonly move: string };

export type NewMoveToastOptions = {
  language(): Language;
  /** The toast was tapped: open the loadout picker on that creature. */
  open(learned: NewMove): void;
};

export type NewMoveToast = {
  /** Moves just learned, each shown in turn once the screen is free. */
  learned(moves: readonly NewMove[]): void;
  /** Called every frame. `free`: nothing else is on screen, so a toast may show; one put away by something else shows again after. */
  render(free: boolean, now: number): void;
  /** Forgets every move waiting, as when the player leaves the world. */
  reset(): void;
  /** The move on show, or null. */
  current(): NewMove | null;
};

/**
 * A tappable toast at the bottom for each move a creature learns: a "new move" star, the move's
 * button picture and the creature's portrait. A tap opens the loadout picker on that creature; it
 * goes away by itself after NEW_MOVE_MS. It waits while a battle, a question or another message
 * at the bottom is up, and one those interrupt shows again in full once they are gone.
 */
export function createNewMoveToast(root: HTMLButtonElement, options: NewMoveToastOptions): NewMoveToast {
  let waiting: NewMove[] = [];
  let shown: { move: NewMove; until: number } | null = null;
  let key = '';

  function draw() {
    const language = options.language();
    const next = JSON.stringify([language, shown?.move ?? null]);
    root.hidden = shown === null;
    if (next === key) return;
    key = next;
    if (!shown) return root.replaceChildren();
    const { species, move } = shown.move;
    root.setAttribute('aria-label', format('loadout.learned', language, { creature: speciesName(species, language), move: moveName(move, language) }));
    root.dataset.move = move;
    root.replaceChildren(
      el('span', { className: 'new-move-star', attrs: { 'aria-hidden': 'true' } }, [pictureIcon('star-burst', 32), el('span', { text: text('loadout.newMove', language) })]),
      abilityIcon(move, 48),
      creaturePortrait(species),
    );
  }

  root.addEventListener('click', () => {
    if (!shown) return;
    const tapped = shown.move;
    shown = null;
    draw();
    options.open(tapped);
  });

  return {
    learned: (moves) => {
      waiting = [...waiting, ...moves];
    },
    render: (free, now) => {
      if (shown && now >= shown.until) shown = null;
      if (shown && !free) {
        waiting = [shown.move, ...waiting];
        shown = null;
      }
      const first = waiting[0];
      if (!shown && free && first) {
        waiting = waiting.slice(1);
        shown = { move: first, until: now + NEW_MOVE_MS };
      }
      draw();
    },
    reset: () => {
      waiting = [];
      shown = null;
      draw();
    },
    current: () => shown?.move ?? null,
  };
}
