import type { StringId } from '@nebotok/core';
import { button, el, icon } from './dom.ts';

export const PIN_LENGTH = 4;
/** A backspace key: a tag shape pointing left with a cross cut out of it. */
const DELETE_ICON = 'M9 5h11a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-7-7zM12 10.4 13.4 9 15 10.6 16.6 9 18 10.4 16.4 12 18 13.6 16.6 15 15 13.4 13.4 15 12 13.6 13.6 12z';

export type PinPad = {
  /** The row of dots that shows how many digits are typed, built afresh for each view. */
  dots(): HTMLElement;
  /** The number keys, with Back and Delete. */
  keys(): HTMLElement;
  /** Forgets the digits typed so far. */
  clear(): void;
  digits(): number;
};

export type PinPadOptions = {
  readonly label: (id: StringId) => string;
  /** Whether the pad is on screen, so its keys and a laptop's keyboard reach it. */
  readonly active: () => boolean;
  /** While true the pad waits, because an answer about the last PIN is on its way. */
  readonly busy: () => boolean;
  /** All four digits are in. The pad keeps them until `clear()`, so the dots stay full while the PIN is checked. */
  readonly entered: (pin: string) => void;
  readonly back: () => void;
};

/** The on-screen number pad for a four-digit PIN, for every screen that asks for one. */
export function createPinPad(options: PinPadOptions): PinPad {
  let pin = '';
  let shown: readonly HTMLElement[] = [];

  const showDots = () => shown.forEach((dot, at) => dot.classList.toggle('filled', at < pin.length));
  const usable = () => options.active() && !options.busy();

  function press(digit: string) {
    if (!usable() || pin.length >= PIN_LENGTH) return;
    pin += digit;
    showDots();
    if (pin.length === PIN_LENGTH) options.entered(pin);
  }

  function removeDigit() {
    if (!usable()) return;
    pin = pin.slice(0, -1);
    showDots();
  }

  function back() {
    if (usable()) options.back();
  }

  function padKey(digit: string): HTMLButtonElement {
    const made = button('pin-key', digit, () => press(digit));
    made.dataset.digit = digit;
    return made;
  }

  // A laptop can type the PIN too.
  document.addEventListener('keydown', (event) => {
    if (!options.active() || event.altKey || event.ctrlKey || event.metaKey) return;
    if (/^[0-9]$/.test(event.key)) press(event.key);
    else if (event.key === 'Backspace') removeDigit();
    else if (event.key === 'Escape') back();
    else return;
    event.preventDefault();
  });

  return {
    dots: () => {
      shown = Array.from({ length: PIN_LENGTH }, () => el('span', { className: 'pin-dot' }));
      showDots();
      return el('div', { className: 'pin-dots', attrs: { 'aria-hidden': 'true' } }, shown);
    },
    keys: () => {
      const erase = button('pin-key pin-delete', '', removeDigit);
      erase.setAttribute('aria-label', options.label('profile.pinDelete'));
      erase.append(icon(DELETE_ICON));
      return el('div', { className: 'pin-pad' }, [...[...'123456789'].map(padKey), button('pin-key pin-back', options.label('profile.back'), back), padKey('0'), erase]);
    },
    clear: () => {
      pin = '';
      showDots();
    },
    digits: () => pin.length,
  };
}
