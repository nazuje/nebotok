// What the browser check and the scene command (scripts/scene.mjs) share: the browsers and devices,
// watching a page for trouble, the page's ?test=1 hook (apps/game/src/test-hook.ts), and the
// server's profile API and maps.
import { chromium, devices, webkit } from '@playwright/test';
import { PLAYER_SPAWN, readTiledMap, reachableFrom } from '../../packages/core/src/index.ts';
import { inTurn, poll } from './in-turn.mjs';
import { chromiumLaunchOptions, webkitLaunchOptions } from './launch-options.mjs';

export const BROWSERS = [
  { name: 'chromium', type: chromium, options: chromiumLaunchOptions },
  { name: 'webkit', type: webkit, options: webkitLaunchOptions },
];
export const DEVICES = [
  { name: 'iphone-portrait', descriptor: devices['iPhone 17'] },
  { name: 'ipad-landscape', descriptor: devices['iPad Pro 11 landscape'] },
];

// WebKit screenshots make Playwright inject an inline stylesheet, which the page's CSP rightly refuses.
// Only that refusal, and only while a screenshot is being taken, is not counted as a page problem.
const SCREENSHOT_STYLE_NOISE = /^(Refused to apply a stylesheet because|CSP violation: style-src-elem blocked inline at :\d+$)/;
const shooting = new WeakSet();
export async function screenshot(page, path) {
  shooting.add(page);
  try {
    await page.screenshot({ path, caret: 'initial' });
    await page.waitForTimeout(100);
  } finally {
    shooting.delete(page);
  }
}

/** Sets the starting language once, so a reload keeps whatever the page chose since. */
export const presetLanguage = (chosen) => {
  if (localStorage.getItem('nebotok:language') === null) localStorage.setItem('nebotok:language', JSON.stringify(chosen));
};

/** Any Content-Security-Policy violation is a bug: the page tried to load or run something it must not. */
export const reportCspViolations = () => {
  document.addEventListener('securitypolicyviolation', (event) => {
    console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || 'inline'} at ${event.sourceFile}:${event.lineNumber}`);
  });
};

/**
 * Collects every sign of trouble on a page into `problems`, and refuses any request off
 * `allowedHost`. `expectStatus()` says when a refused login (a wrong PIN) is the point.
 */
export function watch(context, page, problems, { allowedHost, expectStatus = () => false }) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (shooting.has(page) && SCREENSHOT_STYLE_NOISE.test(message.text())) return;
    // A refused API call answers 4xx on purpose (a wrong PIN); browsers log every such answer.
    if (/^Failed to load resource: the server responded with a status of 4\d\d/.test(message.text()) && expectStatus()) return;
    problems.push(`console error: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  context.on('requestfailed', (request) => problems.push(`failed request: ${request.url()} (${request.failure()?.errorText})`));
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.host !== allowedHost) {
      problems.push(`outside request: ${request.url()}`);
    }
  });
  context.on('response', (response) => {
    if (response.status() >= 400 && !(expectStatus() && new URL(response.url()).pathname.endsWith('/api/sessions'))) {
      problems.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).host !== allowedHost) problems.push(`outside websocket: ${socket.url()}`);
    socket.on('socketerror', (error) => problems.push(`websocket error: ${error}`));
  });
}

// The page's ?test=1 hook, read under the same key it is installed with.
export const HOOK = '__nebotok';
export const readState = (page) => page.evaluate((key) => JSON.parse(window[key].stateAsText()), HOOK);
// Clear of the connection badge at the top, the toasts at the bottom and the screen's edges.
const TAP_MARGIN = { side: 40, top: 100, bottom: 90 };
/** Whether a spot on the page is somewhere a tap reaches the map rather than the interface. */
export const tappable = (page, spot) => {
  const { width, height } = page.viewportSize();
  return Boolean(spot) && spot.x > TAP_MARGIN.side && spot.x < width - TAP_MARGIN.side && spot.y > TAP_MARGIN.top && spot.y < height - TAP_MARGIN.bottom;
};

/** Where each tile's centre is on the page, in CSS pixels, or null before a map is drawn. */
export const tilesToScreen = (page, tiles) => page.evaluate(([key, list]) => list.map(({ x, y }) => window[key].tileToScreen(x, y)), [HOOK, tiles]);

/**
 * Waits until the page's state passes `check`, and returns that state. The page must also be
 * `ready` unless `ready: false` (a page in the middle of a dropped connection is not).
 */
export async function until(page, check, what, timeoutMs = 20_000, { ready = true } = {}) {
  let last = null;
  const ok = await poll(
    async () => {
      const isReady = await page.evaluate((key) => window[key]?.ready === true, HOOK).catch(() => false);
      if (ready && !isReady) return false;
      last = await readState(page).catch(() => null);
      return last !== null && check(last);
    },
    { deadline: Date.now() + timeoutMs, intervalMs: 100 },
  );
  if (!ok) throw new Error(`timed out waiting for ${what}; last state ${JSON.stringify(last)}`);
  return last;
}

export const enterPin = (page, digits) => inTurn([...digits], (digit) => page.locator(`.pin-key[data-digit="${digit}"]`).tap());

export const inWorld = (state) => state.screen === 'world' && state.connection === 'connected' && state.protocol !== null;
export const selfIn = (state) => state.players.find((player) => player.self);
/** Settled where the server says, drawn there too, with nothing left to do. */
export const settledOn = (state, tile) => {
  const self = selfIn(state);
  return self && !self.moving && self.drawn.x === self.x && self.drawn.y === self.y && state.predicted?.intent === 'idle' && !state.predicted.moving && (!tile || (self.x === tile.x && self.y === tile.y));
};

/** Signs the page's player out through the settings, as a player switching player does. */
export async function signOut(page) {
  await page.locator('.settings-button').tap();
  await page.locator('.switch-player').tap();
  await until(page, (state) => state.screen === 'profiles' && state.profile === null, 'the profile list after signing out');
}

/** A call to the game's profile API under `serverBase`, answered as `{ status, data }`. */
export async function apiCall(serverBase, path, { body, headers = {}, method } = {}) {
  const sent = { origin: new URL(serverBase).origin, ...headers };
  if (body !== undefined) sent['content-type'] = 'application/json';
  const response = await fetch(`${serverBase}/api${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: response.status, data };
}

/** The map the server serves, read like the core reads it, with the tiles reachable from the spawn. */
export async function servedMap(serverBase, id) {
  const read = readTiledMap(id, await (await fetch(`${serverBase}/maps/${id}.tmj`)).json());
  if (!read.ok) throw new Error(`the served map ${id} does not read: ${read.problems.join('; ')}`);
  return { map: read.map, reach: reachableFrom(read.map, read.map.spawns[PLAYER_SPAWN]) };
}
