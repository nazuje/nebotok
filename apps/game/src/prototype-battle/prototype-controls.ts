import type { Language } from '@nebotok/core';
import { moveName, moveType } from '../battle-content.ts';
import { el, icon } from '../dom.ts';
import { cssColour, placeholderIcon, typeColour, weatherIcon } from './prototype-icons.ts';
import { advantageOf, movePower, type Advantage, type ProtoBattle } from './prototype-sim.ts';

const UP_PATH = 'M12 3l8 9h-5v9h-6v-9h-5z';
const DOWN_PATH = 'M12 21l-8 -9h5v-9h6v9h5z';
const CLOUD_PATH = 'M7 18a4.5 4.5 0 0 1 -0.6 -9a6 6 0 0 1 11.4 1.5a3.75 3.75 0 0 1 -0.3 7.5z';

export type Controls = {
  readonly element: HTMLElement;
  /** Turns every move off while a turn plays or once the battle is over. */
  setBusy(busy: boolean): void;
  /** Puts back whatever a turn moved away. */
  settle(): void;
};

/** The corner badge: an up arrow when the move is strong against the wild creature, down when weak, a cloud for a move that calls weather. */
function badge(advantage: Advantage, move: string): HTMLElement | null {
  if (movePower(move) === 0) return el('span', { className: 'proto-badge sky' }, [icon(CLOUD_PATH)]);
  if (advantage === 'normal') return null;
  return el('span', { className: `proto-badge ${advantage}` }, [icon(advantage === 'strong' ? UP_PATH : DOWN_PATH)]);
}

/** One pip for a light move, two for a heavy one. */
function pips(move: string): HTMLElement {
  const power = movePower(move);
  const count = power >= 70 ? 2 : power > 0 ? 1 : 0;
  return el('span', { className: 'proto-pips', attrs: { 'aria-hidden': 'true' } }, Array.from({ length: count }, () => el('span', { className: 'proto-pip' })));
}

/** Variant 1 and 2: four big picture buttons in a row. */
export function moveButtons(battle: ProtoBattle, language: Language, onPick: (slot: number) => void): Controls {
  const buttons = battle.fighters[0].moves.map((move, slot) => {
    const type = moveType(move) ?? 'none';
    const advantage = advantageOf(battle, 0, move);
    const made = el('button', { className: `proto-move type-${type} ${advantage}`, attrs: { type: 'button', 'aria-label': moveName(move, language) } });
    made.append(placeholderIcon(type), el('span', { className: 'proto-move-name', text: moveName(move, language), attrs: { 'aria-hidden': 'true' } }), pips(move));
    const corner = badge(advantage, move);
    if (corner) made.append(corner);
    made.addEventListener('click', () => onPick(slot));
    return made;
  });
  const element = el('div', { className: 'proto-moves' }, buttons);
  return {
    element,
    setBusy: (busy) => {
      for (const made of buttons) made.disabled = busy;
    },
    settle: () => undefined,
  };
}

const FAN_DEGREES = 7;
const DRAG_TO_PLAY = 44;

/** Variant 3: the moves as cards fanned out at the bottom. Tap a card, or drag it up, to play it. */
export function moveCards(battle: ProtoBattle, language: Language, onPick: (slot: number) => void): Controls {
  const moves = battle.fighters[0].moves;
  const middle = (moves.length - 1) / 2;
  let busy = false;
  const cards = moves.map((move, slot) => {
    const type = moveType(move) ?? 'none';
    const advantage = advantageOf(battle, 0, move);
    const card = el('button', { className: `proto-card type-${type} ${advantage}`, attrs: { type: 'button', 'aria-label': moveName(move, language) } });
    card.style.setProperty('--angle', `${(slot - middle) * FAN_DEGREES}deg`);
    card.style.setProperty('--drop', `${Math.abs(slot - middle) * Math.abs(slot - middle) * 6}px`);
    card.style.setProperty('--type', cssColour(typeColour(type)));
    const art = el('span', { className: 'proto-card-art' }, [weatherIcon(type)]);
    card.append(art, el('span', { className: 'proto-card-name', text: moveName(move, language), attrs: { 'aria-hidden': 'true' } }), pips(move));
    const corner = badge(advantage, move);
    if (corner) card.append(corner);
    let dragFrom: number | null = null;
    let dragged = false;
    const play = () => {
      if (busy) return;
      card.classList.add('played');
      onPick(slot);
    };
    card.addEventListener('pointerdown', (event) => {
      if (busy) return;
      dragFrom = event.clientY;
      dragged = false;
      card.setPointerCapture(event.pointerId);
    });
    card.addEventListener('pointermove', (event) => {
      if (dragFrom === null) return;
      const dy = Math.min(0, event.clientY - dragFrom);
      if (dy < -8) dragged = true;
      card.style.setProperty('--lift', `${dy}px`);
    });
    const release = (event: PointerEvent) => {
      if (dragFrom === null) return;
      const dy = event.clientY - dragFrom;
      dragFrom = null;
      card.style.setProperty('--lift', '0px');
      if (dragged && dy < -DRAG_TO_PLAY) play();
    };
    card.addEventListener('pointerup', release);
    card.addEventListener('pointercancel', release);
    card.addEventListener('click', () => {
      if (!dragged) play();
      dragged = false;
    });
    return card;
  });
  const element = el('div', { className: 'proto-cards' }, cards);
  return {
    element,
    setBusy: (next) => {
      busy = next;
      for (const card of cards) {
        card.disabled = next;
      }
    },
    settle: () => {
      for (const card of cards) card.classList.remove('played');
    },
  };
}
