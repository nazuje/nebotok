// Level 4 browser check: starts the real production server serving apps/game/dist, then plays the
// page in headless Chromium and WebKit on an iPhone (portrait) and an iPad (landscape) in both
// languages, the way a player would: make a player with a PIN on the number pad, enter the world,
// reload and come straight back, switch player, get the PIN wrong, then right. Fails on any console
// error, page error, failed or outside request, a missing connection, a language toggle that does
// not change the text, small touch targets, or sideways scrolling at 360px wide.
//   node scripts/browser-check.mjs [--out <dir>] [--url <base>]
// With --url it plays a game that is already running there (the container check) instead.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, devices, webkit } from '@playwright/test';
import { PROTOCOL_VERSION } from '../packages/core/src/index.ts';
import { inTurn, poll, sleep } from './lib/in-turn.mjs';
import { ROOT, startServer } from './lib/server-process.mjs';
import { chromiumLaunchOptions, webkitLaunchOptions } from './lib/launch-options.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' }, url: { type: 'string' } } });
const out = values.out ?? join(ROOT, '.proof', 'browser-check');
const shots = join(out, 'screenshots');
mkdirSync(shots, { recursive: true });
mkdirSync(join(out, 'logs'), { recursive: true });

const DIST = join(ROOT, 'apps/game/dist');
if (!values.url && !existsSync(join(DIST, 'index.html'))) {
  console.error('browser-check: apps/game/dist is missing. Run: npm run build');
  process.exit(1);
}

const STRINGS = JSON.parse(readFileSync(join(ROOT, 'content/strings.json'), 'utf8'));
const MIN_TARGET_PX = 48;
const NARROW = { width: 360, height: 740 };
const BROWSERS = [
  { name: 'chromium', type: chromium, options: chromiumLaunchOptions },
  { name: 'webkit', type: webkit, options: webkitLaunchOptions },
];
const DEVICES = [
  { name: 'iphone-portrait', descriptor: devices['iPhone 17'] },
  { name: 'ipad-landscape', descriptor: devices['iPad Pro 11 landscape'] },
];
const LANGUAGES = ['en', 'sl'];
const other = (language) => (language === 'en' ? 'sl' : 'en');
const PIN = '2580';
const WRONG_PIN = '1111';
const SHOT = { caret: 'initial' };
// WebKit screenshots make Playwright inject an inline stylesheet, which the page's CSP rightly refuses.
// Only that refusal, and only while a screenshot is being taken, is not counted as a page problem.
const SCREENSHOT_STYLE_NOISE = /^(Refused to apply a stylesheet because|CSP violation: style-src-elem blocked inline at :\d+$)/;
const shooting = new WeakSet();
async function screenshot(page, path) {
  shooting.add(page);
  try {
    await page.screenshot({ path, ...SHOT });
    await page.waitForTimeout(100);
  } finally {
    shooting.delete(page);
  }
}

/** Sets the starting language once, so a reload keeps whatever the page chose since. */
const presetLanguage = (chosen) => {
  if (localStorage.getItem('nebotok:language') === null) localStorage.setItem('nebotok:language', JSON.stringify(chosen));
};

// A server of our own keeps its database in a temporary folder, removed at the end.
const dataDir = values.url ? null : mkdtempSync(join(tmpdir(), 'nebotok-browser-check-'));
const server = values.url
  ? { base: new URL(values.url).origin, external: true }
  : await startServer({ env: { NODE_ENV: 'production', DATA_DIR: dataDir }, logFile: join(out, 'logs', 'browser-check-server.log') });
const allowedHost = new URL(server.base).host;
const results = [];

// Every run plays as its own device. Our own server believes X-Forwarded-For from loopback (as it
// does from Tailscale Serve), so each run gets its own address and the per-address API limits
// (5 new profiles and 10 logins a minute) never throttle a check that makes many players. A
// container does not believe the header, so there the runs are spaced out instead.
const LOCAL = !values.url;
const RUN_SPACING_MS = LOCAL ? 0 : 25_000;
let addresses = 0;
const nextAddress = () => {
  addresses += 1;
  return `10.77.${Math.floor(addresses / 250)}.${(addresses % 250) + 1}`;
};
const asDevice = (address) => (LOCAL ? { 'x-forwarded-for': address } : {});
let lastRunAt = 0;
async function spaceRuns() {
  const wait = lastRunAt + RUN_SPACING_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRunAt = Date.now();
}

async function api(path, { body, address } = {}) {
  const headers = { origin: server.base, ...asDevice(address) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`${server.base}/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}

/** Invented names of letters only, one per run, with Slovenian letters in the Slovenian runs. */
const runName = (browserName, deviceName, language) =>
  `${browserName === 'chromium' ? 'Kro' : 'Web'} ${deviceName.startsWith('iphone') ? 'Tel' : 'Tab'} ${language === 'sl' ? 'Čšž' : 'Abc'}`;

/** Collects every sign of trouble on a page, and refuses any request off the local server. */
function watch(context, page, problems, { expectStatus = () => false } = {}) {
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
    if (response.status() >= 400 && !(expectStatus() && new URL(response.url()).pathname === '/api/sessions')) {
      problems.push(`HTTP ${response.status()}: ${response.url()}`);
    }
  });
  page.on('websocket', (socket) => {
    if (new URL(socket.url()).host !== allowedHost) problems.push(`outside websocket: ${socket.url()}`);
    socket.on('socketerror', (error) => problems.push(`websocket error: ${error}`));
  });
}

/** Any Content-Security-Policy violation is a bug: the page tried to load or run something it must not. */
const reportCspViolations = () => {
  document.addEventListener('securitypolicyviolation', (event) => {
    console.error(`CSP violation: ${event.violatedDirective} blocked ${event.blockedURI || 'inline'} at ${event.sourceFile}:${event.lineNumber}`);
  });
};

// The page's ?test=1 hook (apps/game/src/test-hook.ts), read under the same key it is installed with.
const HOOK = '__nebotok';
const readState = (page) => page.evaluate((key) => JSON.parse(window[key].stateAsText()), HOOK);

/** Waits until the page is ready and its state passes `check`, and returns that state. */
async function until(page, check, what, timeoutMs = 20_000) {
  let last = null;
  const ok = await poll(
    async () => {
      const ready = await page.evaluate((key) => window[key]?.ready === true, HOOK).catch(() => false);
      if (!ready) return false;
      last = await readState(page);
      return check(last);
    },
    { deadline: Date.now() + timeoutMs, intervalMs: 100 },
  );
  if (!ok) throw new Error(`timed out waiting for ${what}; last state ${JSON.stringify(last)}`);
  return last;
}

const inWorld = (state) => state.screen === 'world' && state.connection === 'connected' && state.protocol !== null;

const enterPin = (page, digits) => inTurn([...digits], (digit) => page.locator(`.pin-key[data-digit="${digit}"]`).tap());

const smallTargets = (page) =>
  page.locator('button, a, [role="button"], input').evaluateAll(
    (items, least) =>
      items
        .map((item) => ({ item, box: item.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.width < least || box.height < least))
        .map(({ item, box }) => `${item.className} ${Math.round(box.width)}x${Math.round(box.height)}`),
    MIN_TARGET_PX,
  );

const sideways = (page) =>
  page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth), width: root.clientWidth };
  });

const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();

async function checkDevice(browser, browserName, device, language) {
  const label = `${browserName}-${device.name}-${language}`;
  const name = runName(browserName, device.name, language);
  const problems = [];
  const screenshots = [];
  const expect = (ok, message) => {
    if (!ok) problems.push(message);
  };
  let wrongPinExpected = false;
  await spaceRuns();
  const context = await browser.newContext({ ...device.descriptor, serviceWorkers: 'allow', extraHTTPHeaders: asDevice(nextAddress()) });
  await context.addInitScript(presetLanguage, language);
  await context.addInitScript(reportCspViolations);
  const page = await context.newPage();
  watch(context, page, problems, { expectStatus: () => wrongPinExpected });
  const shot = async (step) => {
    const path = join(shots, `${label}-${step}.png`);
    await screenshot(page, path);
    screenshots.push(path);
  };
  const targets = async (where) => {
    for (const target of await smallTargets(page)) problems.push(`${where}: touch target under ${MIN_TARGET_PX}px: ${target}`);
  };
  let state = null;
  try {
    await page.goto(`${server.base}/?test=1`);
    state = await until(page, (s) => s.screen === 'profiles', 'the profile list');
    expect(state.language === language, `language is ${state.language}, not ${language}`);
    expect(state.profile === null, 'a fresh device is already signed in');
    expect((await textOf(page, '#profiles .screen-title')) === STRINGS['profile.title'][language], 'the profile list has the wrong title');
    expect((await textOf(page, '.new-profile')) === STRINGS['profile.new'][language], 'the new player button has the wrong text');
    await targets('profile list');
    await shot('1-profiles');

    await page.locator('.new-profile').tap();
    await until(page, (s) => s.screen === 'newProfile', 'the new player form');
    await page.locator('.avatar-choice[data-avatar="green"]').tap();
    await page.locator('.name-input').fill(name);
    await page.locator('.pin-choose').tap();
    await until(page, (s) => s.screen === 'pin' && s.pinFor === 'choose', 'the PIN pad to choose a PIN');
    await targets('choose a PIN');
    await shot('2-pin-choose');
    await enterPin(page, PIN);
    state = await until(page, (s) => s.screen === 'newProfile', 'the form again with the PIN set');
    expect(await page.locator('.pin-set').isVisible(), 'the form does not say the PIN is set');
    await targets('new player form');
    await shot('3-new-player');

    await page.locator('.create').tap();
    state = await until(page, inWorld, 'the world after making a player');
    expect(state.profile?.name === name, `signed in as ${state.profile?.name}, not ${name}`);
    expect(state.playerCount >= 1, `player count is ${state.playerCount}`);
    expect(state.protocol === PROTOCOL_VERSION, `protocol is ${state.protocol}`);
    expect(state.scene === 'island', `scene is ${state.scene}`);
    expect((await textOf(page, '.badge-text')) === STRINGS['connection.connected'][language], 'the badge does not say connected');
    await targets('world');
    await shot('4-world');

    await page.reload();
    state = await until(page, inWorld, 'the world straight after a reload');
    expect(state.profile?.name === name, 'a reload did not resume the same player');

    await page.locator('.settings-button').tap();
    await until(page, (s) => s.settingsOpen, 'the settings panel');
    expect((await textOf(page, '.switch-player')) === STRINGS['profile.switch'][language], 'the switch player button has the wrong text');
    await targets('settings');
    await shot('5-settings');
    await page.locator('.language').tap();
    await until(page, (s) => s.language === other(language), 'the other language');
    expect((await textOf(page, '.switch-player')) === STRINGS['profile.switch'][other(language)], 'the language toggle did not change the settings text');
    expect((await textOf(page, '.badge-text')) === STRINGS['connection.connected'][other(language)], 'the language toggle did not change the badge');
    expect((await page.evaluate(() => document.documentElement.lang)) === other(language), '<html lang> did not follow the toggle');
    await page.locator('.language').tap();
    await until(page, (s) => s.language === language, 'the first language again');

    await page.locator('.switch-player').tap();
    state = await until(page, (s) => s.screen === 'profiles', 'the profile list after switching player');
    expect(state.profile === null, 'switching player kept the session');
    const mine = state.profiles.find((profile) => profile.name === name);
    expect(mine?.hasPin === true, `the new player is not listed with a PIN: ${JSON.stringify(mine)}`);
    await page.locator(`.profile-card[data-profile-id="${mine?.id}"]`).tap();
    await until(page, (s) => s.screen === 'pin' && s.pinFor === 'enter', 'the PIN pad to sign in');
    wrongPinExpected = true;
    await enterPin(page, WRONG_PIN);
    state = await until(page, (s) => s.screen === 'pin' && s.notice === 'profile.error.pinWrong' && s.pinDigits === 0, 'the wrong PIN message');
    wrongPinExpected = false;
    expect((await textOf(page, '#profiles .notice')) === STRINGS['profile.error.pinWrong'][language], 'the wrong PIN message has the wrong text');
    await targets('enter a PIN');
    await shot('6-pin-wrong');
    await enterPin(page, PIN);
    state = await until(page, inWorld, 'the world after the right PIN');
    expect(state.profile?.name === name, 'the right PIN signed in as someone else');

    // Once the service worker controls the page, a reload must still reach the server over WebSocket.
    const hasWorker = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      await navigator.serviceWorker.ready;
      return true;
    });
    if (hasWorker) {
      await page.reload();
      const after = await until(page, (s) => s.screen === 'world' && s.connection !== 'connecting', 'the world after a reload under the service worker');
      expect(after.connection === 'connected', `after a reload under the service worker the connection is ${after.connection}`);
      expect(after.language === language, 'the language choice did not survive a reload');
    }
    results.push({ label, ok: problems.length === 0, serviceWorkerReload: hasWorker, state, problems, screenshots });
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
    results.push({ label, ok: false, state, problems, screenshots });
  } finally {
    await context.close();
  }
}

/** A profile locked by five wrong PINs, made over the API, so the 360px runs can show the locked state. */
async function lockedProfile(browserName) {
  const address = nextAddress();
  const name = `Zaklep ${browserName === 'chromium' ? 'Kro' : 'Web'}`;
  const made = await api('/profiles', { body: { name, avatar: 'orange', pin: '1357' }, address });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  await inTurn([1, 2, 3, 4, 5], () => api('/sessions', { body: { profileId: made.data.id, pin: '0000' }, address }));
  return made.data.id;
}

async function checkNarrow(browser, browserName, language, lockedId) {
  const label = `${browserName}-360px-${language}`;
  const problems = [];
  const screenshots = [];
  await spaceRuns();
  const context = await browser.newContext({ viewport: NARROW, hasTouch: true, isMobile: browserName === 'chromium', extraHTTPHeaders: asDevice(nextAddress()) });
  await context.addInitScript(presetLanguage, language);
  await context.addInitScript(reportCspViolations);
  const page = await context.newPage();
  watch(context, page, problems);
  const shot = async (step) => {
    const path = join(shots, `${label}-${step}.png`);
    await screenshot(page, path);
    screenshots.push(path);
  };
  const noSideways = async (where) => {
    const { scrollWidth, width } = await sideways(page);
    if (scrollWidth > width) problems.push(`${where} scrolls sideways at 360px: content is ${scrollWidth}px in ${width}px`);
  };
  try {
    await page.goto(`${server.base}/?test=1`);
    const state = await until(page, (s) => s.screen === 'profiles', 'the profile list');
    await noSideways('the profile list');
    await shot('profiles');
    if (lockedId !== null) {
      const locked = state.profiles.find((profile) => profile.id === lockedId);
      if (!locked?.locked) problems.push(`the profile locked by wrong PINs is not shown locked: ${JSON.stringify(locked)}`);
      await page.locator(`.profile-card[data-profile-id="${lockedId}"]`).tap();
      await until(page, (s) => s.screen === 'profiles' && s.notice === 'profile.error.locked', 'the locked message');
      if ((await textOf(page, '#profiles .notice')) !== STRINGS['profile.error.locked'][language]) problems.push('the locked message has the wrong text');
      await page.locator('#profiles .notice').scrollIntoViewIfNeeded();
      await shot('locked');
    }
    await page.locator('.new-profile').tap();
    await until(page, (s) => s.screen === 'newProfile', 'the new player form');
    await noSideways('the new player form');
    await shot('new-player');
    await page.locator('.pin-choose').tap();
    await until(page, (s) => s.screen === 'pin', 'the PIN pad');
    await noSideways('the PIN pad');
    await shot('pin');
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await context.close();
  }
  results.push({ label, ok: problems.length === 0, problems, screenshots });
}

try {
  // One browser and one page at a time, so screenshots and timings are not fighting for the GPU.
  const runs = DEVICES.flatMap((device) => LANGUAGES.map((language) => ({ device, language })));
  await inTurn(BROWSERS, async ({ name, type, options }) => {
    const browser = await type.launch(options);
    try {
      await inTurn(runs, ({ device, language }) => checkDevice(browser, name, device, language));
      // A lock lasts a minute and needs five logins at once, which only our own server can spare.
      const lockedId = LOCAL ? await lockedProfile(name) : null;
      await inTurn(LANGUAGES, (language) => checkNarrow(browser, name, language, lockedId));
    } finally {
      await browser.close();
    }
  });
} finally {
  // A server started elsewhere is checked and stopped by whoever started it.
  if (!server.external) {
    const stopped = await server.stop();
    const serverProblems = server.problems();
    if (stopped.code !== 0) serverProblems.push(`server exited with code ${stopped.code}`);
    results.push({ label: 'server', ok: serverProblems.length === 0, problems: serverProblems, screenshots: [] });
    server.saveLog();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

writeFileSync(join(out, 'logs', 'browser-check.json'), `${JSON.stringify(results, null, 2)}\n`);
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.label}${result.serviceWorkerReload ? ' (+ reload under service worker)' : ''}`);
  for (const problem of result.problems) console.log(`       - ${problem}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(failed ? `\nbrowser-check: ${failed} run(s) failed` : `\nbrowser-check: all ${results.length} runs passed`);
process.exit(failed ? 1 : 0);
