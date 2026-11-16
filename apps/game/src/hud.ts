import type { Language, StringId, Welcome, WelcomeMessageKey } from '@nebotok/core';
import type { ConnectionStatus } from './connection.ts';
import { el, element } from './dom.ts';
import { toastPicture } from './message-pictures.ts';
import { pictureIcon, spriteIcon } from './pictures.ts';
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
/** How long a short message, such as "Walk up to them first.", stays. */
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

export type ToastKind = 'refused' | 'news';

export type Hud = {
  /** The connection's status, and whether it was lost: a drop or a retry, not the first try. */
  setStatus(status: ConnectionStatus, lost?: boolean): void;
  setWelcome(welcome: Welcome | undefined): void;
  /** Whether anyone else is in the world right now, away players included. */
  setCompany(company: boolean): void;
  /** A short message at the bottom of the screen for TOAST_MS, with its picture: something refused, or good news. */
  toast(id: StringId, kind?: ToastKind): void;
  setLanguage(language: Language): void;
  state(): { welcome: WelcomeMessageKey | null; toast: StringId | null; toastPicture: string | null };
};

/** The interface is plain HTML over the canvas, so it stays sharp, readable and accessible. */
export function createHud(language: Language): Hud {
  const title = element<HTMLElement>('.title');
  const badge = element<HTMLElement>('.badge');
  const badgeText = element<HTMLElement>('.badge-text');
  const welcomeText = element<HTMLElement>('.welcome');
  const toastText = element<HTMLElement>('.toast');
  // Lost touch with the server: a cloud with its plug pulled, and a ring turning while the page tries again.
  badge.prepend(el('span', { className: 'badge-lost', attrs: { 'aria-hidden': 'true' } }, [pictureIcon('cloud-off', 32), el('span', { className: 'badge-spinner' })]));

  let current = language;
  let status: ConnectionStatus = 'connecting';
  let lost = false;
  let welcome: WelcomeMessageKey | null = null;
  let company: boolean | null = null;
  let welcomeTimer: ReturnType<typeof setTimeout> | undefined;
  let toast: StringId | null = null;
  let toastTimer: ReturnType<typeof setTimeout> | undefined;
  let toastShown = '';

  const render = () => {
    document.documentElement.lang = current;
    title.textContent = text('game.title', current);
    badge.dataset.status = status;
    badge.dataset.lost = String(lost);
    badgeText.textContent = text(STATUS_TEXT[status], current);
    // Both sit in the same spot at the bottom; a toast answers a tap, so it goes in front.
    toastText.hidden = toast === null;
    if (toast && toastShown !== `${toast}:${current}`) {
      toastShown = `${toast}:${current}`;
      const picture = toastPicture(toast);
      toastText.replaceChildren(...(picture ? [spriteIcon(picture, 32, { className: 'toast-picture' })] : []), el('span', { text: text(toast, current) }));
    }
    welcomeText.hidden = welcome === null || toast !== null;
    if (welcome) welcomeText.textContent = text(welcome, current);
  };

  render();

  return {
    setStatus: (next, wasLost = next === 'unreachable') => {
      status = next;
      lost = wasLost;
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
    toast: (id, kind = 'refused') => {
      toast = id;
      toastText.dataset.kind = kind;
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
    state: () => ({ welcome, toast, toastPicture: toast ? toastPicture(toast) : null }),
  };
}

export type StoryButtons = {
  /** Shows the bag and journal buttons while `shown`, the journal's dot while it has `news`, and the compass while there is `somewhere` to show. */
  render(shown: boolean, news: boolean, somewhere: boolean, language: Language): void;
};

/**
 * The bag and journal buttons beside the team button, and the compass at the bottom right, which
 * shows where to go next on the map. The world's screens hide them all.
 */
export function createStoryButtons(open: { bag(): void; journal(): void; whereNext(): void }): StoryButtons {
  const bag = element<HTMLButtonElement>('.bag-button');
  const journal = element<HTMLButtonElement>('.journal-button');
  const dot = element<HTMLElement>('.journal-dot');
  const compass = element<HTMLButtonElement>('.compass-button');
  compass.append(pictureIcon('compass', 48));
  bag.addEventListener('click', () => open.bag());
  journal.addEventListener('click', () => open.journal());
  compass.addEventListener('click', () => open.whereNext());
  return {
    render: (shown, news, somewhere, language) => {
      bag.hidden = !shown;
      journal.hidden = !shown;
      compass.hidden = !shown || !somewhere;
      dot.hidden = !news;
      journal.dataset.news = String(news);
      bag.setAttribute('aria-label', text('bag.title', language));
      journal.setAttribute('aria-label', text(news ? 'journal.news' : 'journal.title', language));
      compass.setAttribute('aria-label', text('journal.whereNext', language));
    },
  };
}
