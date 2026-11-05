import type { Language, StringId, Welcome, WelcomeMessageKey } from '@nebotok/core';
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
/** How long a short message, such as "You can't get there.", stays. */
export const TOAST_MS = 2_000;

/**
 * What the welcome line may say, given whether anyone else is in the world now. The server picked
 * its line from the count when you arrived; once others come it says they are here, and once the
 * others it spoke of have gone it says nothing, so it is never wrong while it shows.
 */
export function welcomeLine(shown: WelcomeMessageKey | null, company: boolean | null): WelcomeMessageKey | null {
  if (shown === null || company === null) return shown;
  if (company) return 'welcome.together';
  return shown === 'welcome.alone' ? shown : null;
}

export type Hud = {
  setStatus(status: ConnectionStatus): void;
  setWelcome(welcome: Welcome | undefined): void;
  /** Whether anyone else is in the world right now, away players included. */
  setCompany(company: boolean): void;
  /** A short message at the bottom of the screen for TOAST_MS. */
  toast(id: StringId): void;
  setLanguage(language: Language): void;
  state(): { welcome: WelcomeMessageKey | null; toast: StringId | null };
};

/** The interface is plain HTML over the canvas, so it stays sharp, readable and accessible. */
export function createHud(language: Language): Hud {
  const title = element<HTMLElement>('.title');
  const badge = element<HTMLElement>('.badge');
  const badgeText = element<HTMLElement>('.badge-text');
  const welcomeText = element<HTMLElement>('.welcome');
  const toastText = element<HTMLElement>('.toast');

  let current = language;
  let status: ConnectionStatus = 'connecting';
  let welcome: WelcomeMessageKey | null = null;
  let company: boolean | null = null;
  let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
  let toast: StringId | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;

  const render = () => {
    document.documentElement.lang = current;
    title.textContent = text('game.title', current);
    badge.dataset.status = status;
    badgeText.textContent = text(STATUS_TEXT[status], current);
    // Both sit in the same spot at the bottom; a toast answers a tap, so it goes in front.
    toastText.hidden = toast === null;
    if (toast) toastText.textContent = text(toast, current);
    welcomeText.hidden = welcome === null || toast !== null;
    if (welcome) welcomeText.textContent = text(welcome, current);
  };

  render();

  return {
    setStatus: (next) => {
      status = next;
      render();
    },
    setWelcome: (next) => {
      // The server's line is true as it arrives; company is looked at again from the next frame.
      welcome = next?.messageKey ?? null;
      company = null;
      clearTimeout(welcomeTimer);
      if (next) {
        welcomeTimer = setTimeout(() => {
          welcome = null;
          render();
        }, WELCOME_MS);
      }
      render();
    },
    setCompany: (next) => {
      if (next === company) return;
      company = next;
      const line = welcomeLine(welcome, company);
      if (line === welcome) return;
      welcome = line;
      render();
    },
    toast: (id) => {
      toast = id;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toast = null;
        render();
      }, TOAST_MS);
      render();
    },
    setLanguage: (next) => {
      current = next;
      render();
    },
    state: () => ({ welcome, toast }),
  };
}
