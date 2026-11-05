import type { Language, StringId } from '@nebotok/core';
import type { ApiProblem } from './api.ts';
import { button, el } from './dom.ts';
import { createPinPad } from './pin-pad.ts';
import { noticeFor } from './profile-screen.ts';
import { text } from './strings.ts';

export type PinSetupStep = 'choose' | 'confirm' | 'done';
/** Why the screen closed: the player finished or went back, or the server refused in a way no new try fixes. */
export type PinSetupEnd = 'done' | 'cancelled' | 'signedOut' | 'hasPin';

export type PinSetupState = { readonly step: PinSetupStep | null; readonly busy: boolean; readonly notice: StringId | null; readonly pinDigits: number };

export type PinSetup = {
  open(): void;
  /** Closes without telling `ended`, for when the player has left the world anyway. */
  close(): void;
  isOpen(): boolean;
  setLanguage(language: Language): void;
  state(): PinSetupState;
};

/**
 * "Add a PIN", opened from the settings: the player types a new PIN twice on the number pad, the
 * server stores it, and a short line says it is set. HTML over the world, which goes on behind it.
 */
export function createPinSetup(
  root: HTMLElement,
  options: { language: () => Language; submit: (pin: string) => Promise<ApiProblem | null>; ended: (end: PinSetupEnd) => void },
): PinSetup {
  let step: PinSetupStep | null = null;
  let first = '';
  let busy = false;
  let notice: StringId | null = null;

  const t = (id: StringId) => text(id, options.language());
  const pad = createPinPad({ label: t, active: () => step === 'choose' || step === 'confirm', busy: () => busy, entered: (pin) => void entered(pin), back });

  const go = (next: PinSetupStep | null, nextNotice: StringId | null = null) => {
    step = next;
    notice = nextNotice;
    render();
  };

  function build(shown: PinSetupStep): Node[] {
    if (shown === 'done') {
      return [el('h2', { className: 'screen-title', text: t('profile.pinSet') }), el('p', { className: 'hint centred pin-added', text: t('profile.pinAdded') }), button('primary pin-done', t('profile.done'), () => finish('done'))];
    }
    const line = el('p', { className: 'notice', text: notice ? t(notice) : '', attrs: { role: 'alert' } });
    line.hidden = notice === null;
    const parts: Node[] = [el('h2', { className: 'screen-title', text: t(shown === 'choose' ? 'profile.pinChoose' : 'profile.pinAgain') })];
    if (shown === 'choose') parts.push(el('p', { className: 'hint centred', text: t('profile.pinHint') }));
    parts.push(pad.dots(), line, pad.keys());
    return parts;
  }

  function render() {
    root.hidden = step === null;
    root.dataset.step = step ?? '';
    root.setAttribute('aria-busy', String(busy));
    root.replaceChildren(...(step === null ? [] : [el('div', { className: 'screen-body' }, build(step))]));
  }

  const setBusy = (next: boolean) => {
    busy = next;
    root.setAttribute('aria-busy', String(busy));
  };

  function reset() {
    first = '';
    pad.clear();
  }

  function finish(end: PinSetupEnd) {
    reset();
    go(null);
    options.ended(end);
  }

  function back() {
    if (step === 'confirm') {
      reset();
      go('choose');
    } else finish('cancelled');
  }

  async function entered(pin: string) {
    if (step === 'choose') {
      first = pin;
      pad.clear();
      go('confirm');
      return;
    }
    if (pin !== first) {
      reset();
      go('choose', 'profile.pinMismatch');
      return;
    }
    setBusy(true);
    const problem = await options.submit(pin);
    setBusy(false);
    pad.clear();
    // The player may have left the world while the answer was on its way.
    if (step === null) return;
    if (problem === null) {
      first = '';
      go('done');
    } else if (problem === 'signedOut' || problem === 'hasPin') finish(problem);
    else go('confirm', noticeFor(problem));
  }

  return {
    open: () => {
      reset();
      go('choose');
    },
    close: () => {
      reset();
      go(null);
    },
    isOpen: () => step !== null,
    setLanguage: () => render(),
    state: () => ({ step, busy, notice, pinDigits: pad.digits() }),
  };
}
