import type { Language } from '@nebotok/core';
import type { Controls } from './controls-choice.ts';
import { element } from './dom.ts';
import { otherLanguage } from './language.ts';
import { text } from './strings.ts';

export type Settings = {
  setLanguage(language: Language): void;
  setControls(controls: Controls): void;
  /** "Switch player" only makes sense while someone is playing. */
  setSignedIn(signedIn: boolean): void;
  isOpen(): boolean;
};

/** A small panel behind the gear in the top corner, away from where the game is played. */
export function createSettings(
  language: Language,
  controls: Controls,
  actions: { onLanguage(): void; onControls(): void; onSwitchPlayer(): void },
): Settings {
  const toggle = element<HTMLButtonElement>('.settings-button');
  const panel = element<HTMLElement>('#settings');
  const languageLabel = element<HTMLElement>('.settings-language');
  const languageButton = element<HTMLButtonElement>('.language');
  const switchButton = element<HTMLButtonElement>('.switch-player');
  const controlsLabel = element<HTMLElement>('.settings-controls');
  const controlsButton = element<HTMLButtonElement>('.controls');

  let current = language;
  let currentControls = controls;
  let open = false;
  let signedIn = false;

  const render = () => {
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', text(open ? 'settings.close' : 'settings.open', current));
    panel.hidden = !open;
    panel.setAttribute('aria-label', text('settings.open', current));
    languageLabel.textContent = text('settings.language', current);
    languageButton.setAttribute('aria-label', `${text('language.switch', current)}: ${text(`language.${otherLanguage(current)}`, current)}`);
    for (const option of languageButton.querySelectorAll<HTMLElement>('[data-language]')) {
      option.setAttribute('aria-current', String(option.dataset.language === current));
    }
    controlsLabel.textContent = text('settings.controls', current);
    for (const option of controlsButton.querySelectorAll<HTMLElement>('[data-controls]')) {
      option.textContent = text(option.dataset.controls === 'joystick' ? 'settings.controls.joystick' : 'settings.controls.tap', current);
      option.setAttribute('aria-current', String(option.dataset.controls === currentControls));
    }
    controlsButton.setAttribute('aria-label', `${text('settings.controls', current)}: ${text(`settings.controls.${currentControls}`, current)}`);
    switchButton.textContent = text('profile.switch', current);
    switchButton.hidden = !signedIn;
  };

  const setOpen = (next: boolean) => {
    open = next;
    render();
  };

  toggle.addEventListener('click', () => setOpen(!open));
  languageButton.addEventListener('click', () => actions.onLanguage());
  controlsButton.addEventListener('click', () => actions.onControls());
  switchButton.addEventListener('click', () => {
    setOpen(false);
    actions.onSwitchPlayer();
  });
  // A tap anywhere else closes the panel, the way a menu does.
  document.addEventListener('pointerdown', (event) => {
    if (!open || !(event.target instanceof Node)) return;
    if (!panel.contains(event.target) && !toggle.contains(event.target)) setOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (open && event.key === 'Escape') setOpen(false);
  });
  render();

  return {
    setLanguage: (next) => {
      current = next;
      render();
    },
    setControls: (next) => {
      currentControls = next;
      render();
    },
    setSignedIn: (next) => {
      signedIn = next;
      render();
    },
    isOpen: () => open,
  };
}
