import type { Language, StringId, Welcome } from '@nebotok/core';
import type { ConnectionStatus } from './connection.ts';
import { element } from './dom.ts';
import { text } from './strings.ts';

const STATUS_TEXT: Readonly<Record<ConnectionStatus, StringId>> = {
  connecting: 'connection.connecting',
  connected: 'connection.connected',
  unreachable: 'connection.unreachable',
  signedOut: 'connection.signedOut',
  replaced: 'connection.replaced',
  outdated: 'connection.outdated',
};

/** How long the welcome line stays before it gets out of the way. */
const WELCOME_MS = 6_000;

export type Hud = {
  setStatus(status: ConnectionStatus): void;
  setWelcome(welcome: Welcome | undefined): void;
  setLanguage(language: Language): void;
};

/** The interface is plain HTML over the canvas, so it stays sharp, readable and accessible. */
export function createHud(language: Language): Hud {
  const title = element<HTMLElement>('.title');
  const badge = element<HTMLElement>('.badge');
  const badgeText = element<HTMLElement>('.badge-text');
  const welcomeLine = element<HTMLElement>('.welcome');

  let current = language;
  let status: ConnectionStatus = 'connecting';
  let welcome: Welcome | undefined;
  let welcomeTimer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    document.documentElement.lang = current;
    title.textContent = text('game.title', current);
    badge.dataset.status = status;
    badgeText.textContent = text(STATUS_TEXT[status], current);
    welcomeLine.hidden = welcome === undefined;
    if (welcome) welcomeLine.textContent = text(welcome.messageKey, current);
  };

  render();

  return {
    setStatus: (next) => {
      status = next;
      render();
    },
    setWelcome: (next) => {
      welcome = next;
      clearTimeout(welcomeTimer);
      if (next) {
        welcomeTimer = setTimeout(() => {
          welcome = undefined;
          render();
        }, WELCOME_MS);
      }
      render();
    },
    setLanguage: (next) => {
      current = next;
      render();
    },
  };
}
