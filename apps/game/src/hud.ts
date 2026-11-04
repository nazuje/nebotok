import type { Language, StringId, Welcome } from '@nebotok/core';
import type { ConnectionStatus } from './connection.ts';
import { otherLanguage } from './language.ts';
import { text } from './strings.ts';

const STATUS_TEXT: Readonly<Record<ConnectionStatus, StringId>> = {
  connecting: 'connection.connecting',
  connected: 'connection.connected',
  unreachable: 'connection.unreachable',
  signedOut: 'connection.signedOut',
  replaced: 'connection.replaced',
};

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`index.html is missing ${selector}`);
  return found;
}

export type Hud = {
  setStatus(status: ConnectionStatus): void;
  setWelcome(welcome: Welcome): void;
  setLanguage(language: Language): void;
};

/** The interface is plain HTML over the canvas, so it stays sharp, readable and accessible. */
export function createHud(language: Language, onLanguage: (language: Language) => void): Hud {
  const title = element<HTMLElement>('.title');
  const badge = element<HTMLElement>('.badge');
  const badgeText = element<HTMLElement>('.badge-text');
  const toggle = element<HTMLButtonElement>('.language');
  const welcomeLine = element<HTMLElement>('.welcome');

  let current = language;
  let status: ConnectionStatus = 'connecting';
  let welcome: Welcome | undefined;

  const render = () => {
    document.documentElement.lang = current;
    title.textContent = text('game.title', current);
    badge.dataset.status = status;
    badgeText.textContent = text(STATUS_TEXT[status], current);
    toggle.setAttribute('aria-label', `${text('language.switch', current)}: ${text(`language.${otherLanguage(current)}`, current)}`);
    for (const option of toggle.querySelectorAll<HTMLElement>('[data-language]')) {
      option.setAttribute('aria-current', String(option.dataset.language === current));
    }
    welcomeLine.hidden = welcome === undefined;
    if (welcome) welcomeLine.textContent = text(welcome.messageKey, current);
  };

  toggle.addEventListener('click', () => onLanguage(otherLanguage(current)));
  render();

  return {
    setStatus: (next) => {
      status = next;
      render();
    },
    setWelcome: (next) => {
      welcome = next;
      render();
    },
    setLanguage: (next) => {
      current = next;
      render();
    },
  };
}
