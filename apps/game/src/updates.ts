import type { Language, StringId } from '@nebotok/core';
import type { ConnectionStatus } from './connection.ts';
import { text } from './strings.ts';

/** Set while this tab's one automatic reload for an out-of-date page has been spent. */
const AUTO_RELOAD_KEY = 'nebotok:outdatedReload';
/** How long a new service worker gets to take over before the page drops every worker and cache. */
export const TAKEOVER_MS = 3_000;
/** How often an open page asks whether a new build is out. */
export const CHECK_EVERY_MS = 30 * 60_000;
/** How often a waiting offer to update looks again at whether the player is busy. */
const BUSY_CHECK_MS = 1_000;
/** The caches this app's service worker fills: Workbox's precache and the pages cache in vite.config.ts. */
const OWN_CACHE = /^(workbox-|nebotok-)/;

export type UpdateOffer = 'reload' | 'update';

/** What the update button says: Reload on a page the server refused, else the news of a new build. */
export const OFFER_TEXT: Readonly<Record<UpdateOffer, StringId>> = {
  reload: 'update.reload',
  update: 'update.available',
};

/** Whether the page served at `/` now loads a different script from the one this page runs. */
export function isNewerBuild(servedHtml: string, ownScript: string | null): boolean {
  return ownScript !== null && servedHtml.includes('<script') && !servedHtml.includes(`"${ownScript}"`);
}

/** The offer to show: Reload while refused, a new build only while the player is free to leave. */
export function offerToShow(outdated: boolean, newBuild: boolean, busy: boolean): UpdateOffer | null {
  if (outdated) return 'reload';
  return newBuild && !busy ? 'update' : null;
}

const register = () => void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});

const delay = (ms: number) => new Promise<false>((resolve) => setTimeout(() => resolve(false), ms));

function readFlag(): boolean {
  try {
    return sessionStorage.getItem(AUTO_RELOAD_KEY) !== null;
  } catch {
    // Without storage the reload could loop, so it counts as spent.
    return true;
  }
}

function writeFlag(set: boolean): void {
  try {
    if (set) sessionStorage.setItem(AUTO_RELOAD_KEY, '1');
    else sessionStorage.removeItem(AUTO_RELOAD_KEY);
  } catch {
    // Nothing stored, nothing to change.
  }
}

/**
 * Asks the service worker for the newest build and gives it control of this page. True once a new
 * worker controls the page, or when there is no worker between the page and the network.
 */
async function newestInControl(tookOver: () => boolean): Promise<boolean> {
  if (!('serviceWorker' in navigator)) return true;
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration || tookOver()) return true;
  const changed = new Promise<true>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true }));
  const skipWaiting = () => registration.waiting?.postMessage({ type: 'SKIP_WAITING' });
  registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', skipWaiting));
  skipWaiting();
  void registration.update().then(skipWaiting, () => {});
  return Promise.race([changed, delay(TAKEOVER_MS)]);
}

/** Drops every service worker and this app's caches, so the next load comes from the network. */
async function forgetWorkers(): Promise<void> {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  }
  if ('caches' in window) {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => OWN_CACHE.test(name)).map((name) => caches.delete(name)));
  }
}

export type Updates = {
  /** Called with every connection status; `outdated` means the server refused this page's protocol. */
  connection(status: ConnectionStatus): void;
  setLanguage(language: Language): void;
};

export type UpdateSources = {
  language: Language;
  /** In a battle or a talk, when a new build is not offered. */
  busy(): boolean;
};

/**
 * Keeps an installed page on the newest build. The service worker is checked when the page comes
 * back into view and every CHECK_EVERY_MS; a new build is offered with a button, never forced. A
 * page the server refuses for its protocol reloads onto the newest build once by itself, then shows
 * a Reload button that does the same.
 */
export function createUpdates({ language, busy }: UpdateSources): Updates {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'update-button';
  button.hidden = true;
  document.body.append(button);

  let current = language;
  let outdated = false;
  let newBuild = false;
  let reloading = false;
  let busyTimer: ReturnType<typeof setInterval> | undefined;
  let tookOver = false;
  const enabled = import.meta.env.PROD && 'serviceWorker' in navigator;
  const ownScript = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute('src') ?? null;

  const render = () => {
    const shown = offerToShow(outdated, newBuild, busy());
    button.hidden = shown === null;
    button.disabled = reloading;
    if (shown) {
      button.dataset.offer = shown;
      button.textContent = text(OFFER_TEXT[shown], current);
    }
    // While a new build waits behind a battle or a talk, look again until it can be offered.
    if (newBuild && !outdated && busyTimer === undefined) busyTimer = setInterval(render, BUSY_CHECK_MS);
  };

  const reload = async () => {
    if (reloading) return;
    reloading = true;
    render();
    try {
      if (enabled && !(await newestInControl(() => tookOver))) await forgetWorkers();
    } catch {
      await forgetWorkers().catch(() => {});
    } finally {
      location.reload();
    }
  };

  const lookForNewBuild = async () => {
    // A refused or reloading page is already on its way to the newest build; a fetch the reload
    // cuts off shows up as an error in WebKit.
    if (newBuild || outdated || reloading || !enabled || document.visibilityState !== 'visible') return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      // WebKit can leave update() unsettled once the new worker it found has taken the page over.
      await Promise.race([registration?.update(), delay(TAKEOVER_MS)]);
      const served = await fetch('/', { cache: 'no-cache', credentials: 'same-origin' });
      if (served.ok && isNewerBuild(await served.text(), ownScript)) {
        newBuild = true;
        render();
      }
    } catch {
      // Offline or the server restarting: the next check asks again.
    }
  };

  button.addEventListener('click', () => void reload());

  if (enabled) {
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    let controlled = navigator.serviceWorker.controller !== null;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // The first worker taking a new page over is not news; a later one is a new build.
      if (controlled) {
        tookOver = true;
        void lookForNewBuild();
      }
      controlled = true;
    });
    document.addEventListener('visibilitychange', () => void lookForNewBuild());
    setInterval(() => void lookForNewBuild(), CHECK_EVERY_MS);
  }

  return {
    connection: (status) => {
      const was = outdated;
      outdated = status === 'outdated';
      if (status === 'connected') writeFlag(false);
      if (outdated && !was && !readFlag()) {
        writeFlag(true);
        void reload();
      }
      render();
    },
    setLanguage: (next) => {
      current = next;
      render();
    },
  };
}
