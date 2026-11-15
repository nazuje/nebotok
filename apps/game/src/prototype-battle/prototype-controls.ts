import type { Language } from '@nebotok/core';
import { moveName, moveType } from '../battle-content.ts';
import { el, icon } from '../dom.ts';
import { moveCost } from './prototype-energy.ts';
import { cssColour, placeholderIcon, typeColour, weatherIcon } from './prototype-icons.ts';
import { advantageOf, movePower, type Advantage, type ProtoBattle } from './prototype-sim.ts';

const UP_PATH = 'M12 3l8 9h-5v9h-6v-9h-5z';
const DOWN_PATH = 'M12 21l-8 -9h5v-9h6v9h5z';
const CLOUD_PATH = 'M7 18a4.5 4.5 0 0 1 -0.6 -9a6 6 0 0 1 11.4 1.5a3.75 3.75 0 0 1 -0.3 7.5z';
const CHARGE_PATH = 'M12 2.5l8.5 8.5l-2.6 2.6l-5.9-5.9l-5.9 5.9l-2.6-2.6zM12 10.5l8.5 8.5l-2.6 2.6l-5.9-5.9l-5.9 5.9l-2.6-2.6z';
const DODGE_PATH = 'M12 1.5l7 7.5h-4.4v6.5h-5.2v-6.5h-4.4zM3 18h7v3h-7zM14 18h7v3h-7zM1.5 12.5h4v2.5h-4zM18.5 12.5h4v2.5h-4z';

export type Controls = {
  readonly element: HTMLElement;
  /** Turns every move off while a turn plays or once the battle is over. */
  setBusy(busy: boolean): void;
  /** Puts back whatever a turn moved away. */
  settle(): void;
};

/** Variants 4 and 5: the move buttons also dim what you cannot pay for and sweep while cooling down. */
export type MoveControls = Controls & {
  setEnergy(energy: number): void;
  /** Each move's cooldown still to go, 0 (ready) to 1 (just used). */
  setCooldowns(left: readonly number[]): void;
};

/** The corner badge: an up arrow when the move is strong against the wild creature, down when weak, a cloud for a move that calls weather. */
function badge(advantage: Advantage, move: string): HTMLElement | null {
  if (movePower(move) === 0) return el('span', { className: 'proto-badge sky' }, [icon(CLOUD_PATH)]);
  if (advantage === 'normal') return null;
  return el('span', { className: `proto-badge ${advantage}` }, [icon(advantage === 'strong' ? UP_PATH : DOWN_PATH)]);
}

/** One pip for a light move, two for a heavy one; with energy, one cyan pip per point it costs. */
function pips(move: string, energy: { moves: readonly string[] } | null): HTMLElement {
  const power = movePower(move);
  const count = energy ? moveCost(move, energy.moves) : power >= 70 ? 2 : power > 0 ? 1 : 0;
  return el('span', { className: `proto-pips${energy ? ' energy' : ''}`, attrs: { 'aria-hidden': 'true' } }, Array.from({ length: count }, () => el('span', { className: 'proto-pip' })));
}

const sweep = () => el('span', { className: 'proto-cd', attrs: { 'aria-hidden': 'true' } });

function setSweep(button: HTMLElement, left: number): void {
  button.style.setProperty('--cd', String(Math.max(0, Math.min(1, left))));
  button.classList.toggle('cooling', left > 0);
}

/** Variants 1, 2, 4 and 5: four big picture buttons in a row. */
export function moveButtons(battle: ProtoBattle, language: Language, onPick: (slot: number) => void, options: { energy?: boolean } = {}): MoveControls {
  const energy = options.energy ?? false;
  const moves = battle.fighters[0].moves;
  const buttons = moves.map((move, slot) => {
    const type = moveType(move) ?? 'none';
    const advantage = advantageOf(battle, 0, move);
    const made = el('button', { className: `proto-move type-${type} ${advantage}`, attrs: { type: 'button', 'aria-label': moveName(move, language) } });
    made.append(placeholderIcon(type), el('span', { className: 'proto-move-name', text: moveName(move, language), attrs: { 'aria-hidden': 'true' } }), pips(move, energy ? { moves } : null));
    const corner = badge(advantage, move);
    if (corner) made.append(corner);
    if (energy) made.append(sweep());
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
    setEnergy: (have) => {
      buttons.forEach((made, slot) => made.classList.toggle('poor', moveCost(moves[slot] ?? '', moves) > have));
    },
    setCooldowns: (left) => {
      buttons.forEach((made, slot) => setSweep(made, left[slot] ?? 0));
    },
  };
}

export type ActionButton = { readonly element: HTMLButtonElement; setCooldown(left: number): void };

/** Variant 4's Charge (glowing up arrows) and variant 5's Dodge (a hop up and away). */
export function actionButton(kind: 'charge' | 'dodge', label: string, onTap: () => void): ActionButton {
  const element = el('button', { className: `proto-action ${kind}`, attrs: { type: 'button', 'aria-label': label } }, [
    icon(kind === 'charge' ? CHARGE_PATH : DODGE_PATH),
    el('span', { className: 'proto-move-name', text: label, attrs: { 'aria-hidden': 'true' } }),
    sweep(),
  ]);
  element.addEventListener('click', onTap);
  return { element, setCooldown: (left) => setSweep(element, left) };
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
    card.append(art, el('span', { className: 'proto-card-name', text: moveName(move, language), attrs: { 'aria-hidden': 'true' } }), pips(move, null));
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
