import { CLIENT_MESSAGES, SERVER_MESSAGES, type Language, type MoveOffer, type StringId } from '@nebotok/core';
import { moveName, moveType, speciesName } from './battle-content.ts';
import type { ClientMessage, ServerMessage } from './battle-link.ts';
import { creaturePortrait } from './creature-art.ts';
import { moveTypeIcon } from './creature-card.ts';
import { button, el } from './dom.ts';
import { pictureIcon } from './pictures.ts';
import { format, text } from './strings.ts';

/** The move the server offers, and whether the player's answer to it is on its way. */
export type LearnState = { readonly offer: MoveOffer; readonly sent: boolean };

export type LearnModel = {
  /** Takes in one message from the server. */
  receive(message: ServerMessage): void;
  /** The `move.choose` that answers the offer (`forget` a slot, or null to skip), or null when there is nothing to answer now. */
  answer(forget: number | null): ClientMessage | null;
  current(): LearnState | null;
  /** Forgets the offer, as when the world is left. */
  reset(): void;
};

/**
 * The offer on screen, fed by the server's messages. The server sends `progress` after every
 * answer, and a next offer before it, so `progress` puts away only an offer already answered. A
 * refused answer may be tried again, unless the server has no offer at all.
 */
export function createLearnModel(): LearnModel {
  let current: LearnState | null = null;
  return {
    receive: (message) => {
      if (message.type === SERVER_MESSAGES.moveOffer) current = { offer: message.payload, sent: false };
      else if (message.type === SERVER_MESSAGES.progress && current?.sent) current = null;
      else if (message.type === SERVER_MESSAGES.refused && message.payload.request === CLIENT_MESSAGES.moveChoose && current) {
        current = message.payload.reason === 'notNow' ? null : { ...current, sent: false };
      }
    },
    answer: (forget) => {
      if (!current || current.sent || (forget !== null && !(forget >= 0 && forget < current.offer.moves.length))) return null;
      current = { ...current, sent: true };
      return { type: CLIENT_MESSAGES.moveChoose, payload: { offer: current.offer.offer, forget } };
    },
    current: () => current,
    reset: () => {
      current = null;
    },
  };
}

export type LearnPrompt = {
  /** Draws the offer, or hides the prompt for null, rebuilding only when something changed. */
  render(state: LearnState | null): void;
};

/** The new move as a chip in its type's colour, with a sparkle. */
function newMoveChip(move: string, language: Language, className: string): HTMLElement {
  return el('span', { className: `move-chip ${className} type-${moveType(move) ?? 'none'}` }, [
    pictureIcon('star-burst', 32, { className: 'learn-sparkle' }),
    ...moveTypeIcon(move, language, 32),
    el('span', { text: moveName(move, language) }),
  ]);
}

/**
 * "{creature} wants to learn {move}": the new move, sparkling and sliding down toward the four the
 * creature knows, each a button in its type's colour with a puff of smoke for forgetting, and a
 * button with a cross that keeps them all. Forgetting takes two taps: the first picks a move, which
 * is struck out with the new move in its place, and the check below sends it while going back
 * returns to choosing. Picking another move instead moves the new one there.
 */
export function createLearnPrompt(root: HTMLElement, options: { language(): Language; answer(forget: number | null): void }): LearnPrompt {
  let shown = '';
  let offered = '';
  let last: LearnState | null = null;
  /** The slot picked to forget, waiting for the check; null while choosing. */
  let chosen: number | null = null;

  const pick = (slot: number | null) => {
    if (!last || last.sent) return;
    const was = chosen;
    chosen = slot;
    draw(last);
    // Keyboard and screen reader players go on to what comes next: the check, or the move they went back from.
    const next = slot === null ? root.querySelector<HTMLElement>(`.learn-forget[data-slot="${was}"]`) : root.querySelector<HTMLElement>('.learn-yes');
    next?.focus();
  };

  const moveButton = (move: string, slot: number, learning: string, language: Language) => {
    const picked = chosen === slot;
    const choice = button(`move learn-forget type-${moveType(move) ?? 'none'}`, '', () => pick(slot));
    choice.setAttribute('aria-label', format('learn.forgetMove', language, { move: moveName(move, language) }));
    choice.setAttribute('aria-pressed', String(picked));
    choice.append(el('span', { className: 'learn-going' }, [...moveTypeIcon(move, language, 32), el('span', { className: 'learn-name', text: moveName(move, language) }), pictureIcon('puff', 32, { className: 'learn-puff' })]));
    if (picked) choice.append(newMoveChip(learning, language, 'learn-coming'));
    choice.dataset.slot = String(slot);
    return choice;
  };

  const confirmRow = (question: string, language: Language) => {
    const back = button('secondary learn-back', '', () => pick(null));
    back.append(pictureIcon('again', 32), el('span', { text: text('learn.back', language) }));
    const yes = button('primary learn-yes', '', () => {
      if (chosen !== null) options.answer(chosen);
    });
    yes.append(pictureIcon('check', 32), el('span', { text: text('learn.confirm', language) }));
    return el('div', { className: 'learn-confirm', attrs: { role: 'group', 'aria-label': question } }, [back, yes]);
  };

  function build({ offer }: LearnState) {
    const language = options.language();
    const t = (id: StringId) => text(id, language);
    const wants = format('learn.wants', language, { creature: speciesName(offer.species, language), move: moveName(offer.move, language) });
    const learning = el('p', { className: 'learn-new' }, [el('span', { className: 'label', text: t('learn.new') }), newMoveChip(offer.move, language, 'learn-chip')]);
    const forgetting = chosen === null ? undefined : offer.moves[chosen];
    const question = forgetting === undefined ? t('learn.forget') : format('learn.swap', language, { old: moveName(forgetting, language), move: moveName(offer.move, language) });
    const moves = el('div', { className: 'battle-moves learn-moves', attrs: { role: 'group', 'aria-label': t('learn.forget') } }, offer.moves.map((move, slot) => moveButton(move, slot, offer.move, language)));
    const skip = button('secondary learn-skip', '', () => options.answer(null));
    skip.append(pictureIcon('cross', 32), el('span', { text: t('learn.skip') }));
    root.toggleAttribute('data-chosen', forgetting !== undefined);
    root.replaceChildren(
      el('div', { className: 'screen-body' }, [
        el('div', { className: 'learn-creature' }, [creaturePortrait(offer.species)]),
        el('h2', { className: 'screen-title learn-title', text: wants }),
        learning,
        el('p', { className: 'hint centred learn-question', text: question }),
        el('div', { className: 'learn-toward', attrs: { 'aria-hidden': 'true' } }, [pictureIcon('arrow', 32, { className: 'down' })]),
        moves,
        ...(forgetting === undefined ? [] : [confirmRow(question, language)]),
        skip,
      ]),
    );
  }

  /** Draws the offer when it, the language or the pick changed. A new offer starts with nothing picked. */
  function draw(state: LearnState) {
    const offer = JSON.stringify(state.offer);
    if (offer !== offered) {
      offered = offer;
      chosen = null;
    }
    const key = JSON.stringify([options.language(), offer, chosen]);
    if (key === shown) return;
    shown = key;
    build(state);
  }

  return {
    render: (state) => {
      root.hidden = state === null;
      root.setAttribute('aria-busy', String(state?.sent ?? false));
      last = state;
      if (state) draw(state);
      else {
        shown = '';
        offered = '';
        chosen = null;
      }
    },
  };
}
