import type { Language } from '@nebotok/core';
import type { Controls } from './controls-choice.ts';
import { element } from './dom.ts';
import { otherLanguage } from './language.ts';
import { pictureIcon } from './pictures.ts';
import { text } from './strings.ts';

export type Settings = {
  setLanguage(language: Language): void;
  setControls(controls: Controls): void;
  /** "Switch player" only makes sense while someone is playing. */
  setSignedIn(signedIn: boolean): void;
  /** "Add a PIN" shows only while the player is known to have none. */
  setCanAddPin(canAddPin: boolean): void;
  /** The player's "Read to me"; null hides it, before the server has said or while no one plays. */
  setReadToMe(readToMe: boolean | null): void;
  /** The player's turtle setting, easier arena fights; null hides it, as for "Read to me". */
  setTurtle(turtle: boolean | null): void;
  /** The player's sounds setting, effects and haptics; null hides it, as for "Read to me". */
  setSounds(sounds: boolean | null): void;
  isOpen(): boolean;
};

/** A small panel behind the gear in the top corner, away from where the game is played. */
export function createSettings(
  language: Language,
  controls: Controls,
  actions: { onLanguage(): void; onControls(): void; onReadToMe(): void; onTurtle(): void; onSounds(): void; onAddPin(): void; onSwitchPlayer(): void },
): Settings {
  const toggle = element<HTMLButtonElement>('.settings-button');
  const panel = element<HTMLElement>('#settings');
  const languageLabel = element<HTMLElement>('.settings-language');
  const languageButton = element<HTMLButtonElement>('.language');
  const addPinButton = element<HTMLButtonElement>('.add-pin');
  const switchButton = element<HTMLButtonElement>('.switch-player');
  const controlsLabel = element<HTMLElement>('.settings-controls');
  const controlsButton = element<HTMLButtonElement>('.controls');
  const readLabel = element<HTMLElement>('.settings-read');
  const readButton = element<HTMLButtonElement>('.read-to-me');
  readButton.prepend(pictureIcon('speaker', 32, { className: 'read-to-me-picture' }));
  const turtleLabel = element<HTMLElement>('.settings-turtle');
  const turtleButton = element<HTMLButtonElement>('.turtle');
  turtleButton.prepend(pictureIcon('turtle', 32, { className: 'read-to-me-picture' }));
  const soundsLabel = element<HTMLElement>('.settings-sounds');
  const soundsButton = element<HTMLButtonElement>('.sounds');
  soundsButton.prepend(pictureIcon('speaker', 32, { className: 'read-to-me-picture' }));

  let current = language;
  let currentControls = controls;
  let open = false;
  let signedIn = false;
  let canAddPin = false;
  let readToMe: boolean | null = null;
  let turtle: boolean | null = null;
  let sounds: boolean | null = null;

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
    readLabel.textContent = text('settings.readToMe', current);
    readLabel.hidden = readToMe === null;
    readButton.hidden = readToMe === null;
    readButton.setAttribute('aria-pressed', String(readToMe === true));
    readButton.setAttribute('aria-label', text('settings.readToMe', current));
    for (const option of readButton.querySelectorAll<HTMLElement>('[data-read]')) {
      const on = option.dataset.read === 'on';
      option.textContent = text(on ? 'settings.readToMe.on' : 'settings.readToMe.off', current);
      option.setAttribute('aria-current', String(on === (readToMe === true)));
    }
    turtleLabel.textContent = text('arena.turtle', current);
    turtleLabel.hidden = turtle === null;
    turtleButton.hidden = turtle === null;
    turtleButton.setAttribute('aria-pressed', String(turtle === true));
    turtleButton.setAttribute('aria-label', text('arena.turtle', current));
    for (const option of turtleButton.querySelectorAll<HTMLElement>('[data-turtle]')) {
      const on = option.dataset.turtle === 'on';
      option.textContent = text(on ? 'settings.readToMe.on' : 'settings.readToMe.off', current);
      option.setAttribute('aria-current', String(on === (turtle === true)));
    }
    soundsLabel.textContent = text('settings.sounds', current);
    soundsLabel.hidden = sounds === null;
    soundsButton.hidden = sounds === null;
    soundsButton.setAttribute('aria-pressed', String(sounds === true));
    soundsButton.setAttribute('aria-label', text('settings.sounds', current));
    for (const option of soundsButton.querySelectorAll<HTMLElement>('[data-sounds]')) {
      const on = option.dataset.sounds === 'on';
      option.textContent = text(on ? 'settings.readToMe.on' : 'settings.readToMe.off', current);
      option.setAttribute('aria-current', String(on === (sounds === true)));
    }
    addPinButton.textContent = text('settings.addPin', current);
    addPinButton.hidden = !signedIn || !canAddPin;
    switchButton.textContent = text('profile.switch', current);
    switchButton.hidden = !signedIn;
  };

  const setOpen = (next: boolean) => {
    open = next;
    render();
  };

  toggle.addEventListener('click', (event) => {
    setOpen(!open);
    // A click by mouse or touch leaves no focus behind, so Space pressed later does not toggle the
    // panel again. A keyboard press (detail 0) keeps its focus.
    if (event.detail > 0) toggle.blur();
  });
  languageButton.addEventListener('click', () => actions.onLanguage());
  controlsButton.addEventListener('click', () => actions.onControls());
  readButton.addEventListener('click', () => actions.onReadToMe());
  turtleButton.addEventListener('click', () => actions.onTurtle());
  soundsButton.addEventListener('click', () => actions.onSounds());
  addPinButton.addEventListener('click', () => {
    setOpen(false);
    actions.onAddPin();
  });
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
    setCanAddPin: (next) => {
      canAddPin = next;
      render();
    },
    setReadToMe: (next) => {
      readToMe = next;
      render();
    },
    setTurtle: (next) => {
      turtle = next;
      render();
    },
    setSounds: (next) => {
      sounds = next;
      render();
    },
    isOpen: () => open,
  };
}
