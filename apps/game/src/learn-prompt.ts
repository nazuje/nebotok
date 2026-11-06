import { CLIENT_MESSAGES, SERVER_MESSAGES, type Language, type MoveOffer, type StringId } from '@nebotok/core';
import { moveName, moveType, speciesName } from './battle-content.ts';
import type { ClientMessage, ServerMessage } from './battle-link.ts';
import { creaturePortrait } from './creature-art.ts';
import { button, el } from './dom.ts';
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

/**
 * "{creature} wants to learn {move}": the new move, then the four the creature knows, each a button
 * in its type's colour that forgets it for the new one, and a button that keeps them all.
 */
export function createLearnPrompt(root: HTMLElement, options: { language(): Language; answer(forget: number | null): void }): LearnPrompt {
  let shown = '';

  const moveButton = (move: string, slot: number, language: Language) => {
    const choice = button(`move learn-forget type-${moveType(move) ?? 'none'}`, moveName(move, language), () => options.answer(slot));
    choice.dataset.slot = String(slot);
    return choice;
  };

  function build({ offer }: LearnState) {
    const language = options.language();
    const t = (id: StringId) => text(id, language);
    const wants = format('learn.wants', language, { creature: speciesName(offer.species, language), move: moveName(offer.move, language) });
    const learning = el('p', { className: 'learn-new' }, [
      el('span', { className: 'label', text: t('learn.new') }),
      el('span', { className: `move-chip type-${moveType(offer.move) ?? 'none'}`, text: moveName(offer.move, language) }),
    ]);
    const moves = el('div', { className: 'battle-moves learn-moves', attrs: { role: 'group', 'aria-label': t('learn.forget') } }, offer.moves.map((move, slot) => moveButton(move, slot, language)));
    root.replaceChildren(
      el('div', { className: 'screen-body' }, [
        el('div', { className: 'learn-creature' }, [creaturePortrait(offer.species)]),
        el('h2', { className: 'screen-title learn-title', text: wants }),
        learning,
        el('p', { className: 'hint centred', text: t('learn.forget') }),
        moves,
        button('secondary learn-skip', t('learn.skip'), () => options.answer(null)),
      ]),
    );
  }

  return {
    render: (state) => {
      root.hidden = state === null;
      root.setAttribute('aria-busy', String(state?.sent ?? false));
      if (!state) {
        shown = '';
        return;
      }
      const key = JSON.stringify([options.language(), state.offer]);
      if (key === shown) return;
      shown = key;
      build(state);
    },
  };
}
