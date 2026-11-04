// Level 4 browser check: starts the real production server serving apps/game/dist, then plays the
// page in headless Chromium and WebKit on an iPhone (portrait) and an iPad (landscape) in both
// languages. Fails on any console error, page error, failed or outside request, a missing
// connection, a language toggle that does not change the text, small touch targets, or sideways
// scrolling at 360px wide.
//   node scripts/browser-check.mjs [--out <dir>] [--url <base>]
// With --url it plays a game that is already running there (the container check) instead.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, devices, webkit } from '@playwright/test';
import { PROTOCOL_VERSION } from '../packages/core/src/index.ts';
import { inTurn } from './lib/in-turn.mjs';
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

/**
 * The page plays only with a session, which the profile screen will provide. Until then the check
 * signs in as its own profile over the API, as that screen will, and hands the page the token.
 */
const CHECK_PROFILE = { name: 'Browser Check', avatar: 'purple' };
async function checkSession(base) {
  const call = async (path, body) => {
    const init = body === undefined ? {} : { method: 'POST', headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify(body) };
    const response = await fetch(`${base}/api${path}`, init);
    if (!response.ok) throw new Error(`browser-check: ${path} answered ${response.status}`);
    return response.json();
  };
  const profiles = await call('/profiles');
  const profile = profiles.find((found) => found.name === CHECK_PROFILE.name) ?? (await call('/profiles', CHECK_PROFILE));
  return (await call('/sessions', { profileId: profile.id })).token;
}
const presetSession = (token) => {
  if (localStorage.getItem('nebotok:session') === null) localStorage.setItem('nebotok:session', JSON.stringify({ token }));
};

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
const sessionToken = await checkSession(server.base);

/** Collects every sign of trouble on a page, and refuses any request off the local server. */
function watch(context, page, problems) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    if (shooting.has(page) && SCREENSHOT_STYLE_NOISE.test(message.text())) return;
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
    if (response.status() >= 400) problems.push(`HTTP ${response.status()}: ${response.url()}`);
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

async function snapshot(page) {
  await page.waitForFunction((key) => window[key]?.ready === true, HOOK, { timeout: 20_000 });
  return readState(page);
}

const smallTargets = (page) =>
  page.locator('button, a, [role="button"]').evaluateAll(
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

async function checkDevice(browser, browserName, device, language) {
  const label = `${browserName}-${device.name}-${language}`;
  const problems = [];
  const screenshots = [];
  const context = await browser.newContext({ ...device.descriptor, serviceWorkers: 'allow' });
  await context.addInitScript(presetLanguage, language);
  await context.addInitScript(presetSession, sessionToken);
  await context.addInitScript(reportCspViolations);
  const page = await context.newPage();
  watch(context, page, problems);
  try {
    await page.goto(`${server.base}/?test=1`);
    const before = await snapshot(page);
    if (before.connection !== 'connected') problems.push(`connection is ${before.connection}, not connected`);
    if (before.language !== language) problems.push(`language is ${before.language}, not ${language}`);
    if (before.protocol !== PROTOCOL_VERSION) problems.push(`protocol is ${before.protocol}`);
    if (!(before.playerCount >= 1)) problems.push(`player count is ${before.playerCount}`);
    if (before.scene !== 'island') problems.push(`scene is ${before.scene}`);
    const badgeBefore = (await page.locator('.badge-text').textContent())?.trim();
    if (badgeBefore !== STRINGS['connection.connected'][language]) problems.push(`badge says "${badgeBefore}"`);
    for (const target of await smallTargets(page)) problems.push(`touch target under ${MIN_TARGET_PX}px: ${target}`);
    const start = join(shots, `${label}-start.png`);
    await screenshot(page, start);
    screenshots.push(start);

    await page.locator('.language').tap();
    await page.waitForFunction(([key, want]) => JSON.parse(window[key].stateAsText()).language === want, [HOOK, other(language)], { timeout: 5_000 });
    const badgeAfter = (await page.locator('.badge-text').textContent())?.trim();
    if (badgeAfter === badgeBefore) problems.push('the badge text did not change after tapping the language toggle');
    if (badgeAfter !== STRINGS['connection.connected'][other(language)]) problems.push(`after the toggle the badge says "${badgeAfter}"`);
    const lang = await page.evaluate(() => document.documentElement.lang);
    if (lang !== other(language)) problems.push(`<html lang> is ${lang} after the toggle`);
    const toggled = join(shots, `${label}-toggled.png`);
    await screenshot(page, toggled);
    screenshots.push(toggled);

    // Once the service worker controls the page, a reload must still reach the server over WebSocket.
    const hasWorker = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return false;
      await navigator.serviceWorker.ready;
      return true;
    });
    if (hasWorker) {
      await page.reload();
      const after = await snapshot(page);
      if (after.connection !== 'connected') problems.push(`after a reload under the service worker the connection is ${after.connection}`);
      if (after.language !== other(language)) problems.push('the language choice did not survive a reload');
    }
    results.push({ label, ok: problems.length === 0, serviceWorkerReload: hasWorker, state: before, problems, screenshots });
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
    results.push({ label, ok: false, problems, screenshots });
  } finally {
    await context.close();
  }
}

async function checkNarrow(browser, browserName, language) {
  const label = `${browserName}-360px-${language}`;
  const problems = [];
  const context = await browser.newContext({ viewport: NARROW, hasTouch: true, isMobile: browserName === 'chromium' });
  await context.addInitScript(presetLanguage, language);
  await context.addInitScript(presetSession, sessionToken);
  await context.addInitScript(reportCspViolations);
  const page = await context.newPage();
  watch(context, page, problems);
  const shot = join(shots, `${label}.png`);
  try {
    await page.goto(`${server.base}/?test=1`);
    await snapshot(page);
    const { scrollWidth, width } = await sideways(page);
    if (scrollWidth > width) problems.push(`scrolls sideways at 360px: content is ${scrollWidth}px in ${width}px`);
    await screenshot(page, shot);
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await context.close();
  }
  results.push({ label, ok: problems.length === 0, problems, screenshots: [shot] });
}

try {
  // One browser and one page at a time, so screenshots and timings are not fighting for the GPU.
  const runs = DEVICES.flatMap((device) => LANGUAGES.map((language) => ({ device, language })));
  await inTurn(BROWSERS, async ({ name, type, options }) => {
    const browser = await type.launch(options);
    try {
      await inTurn(runs, ({ device, language }) => checkDevice(browser, name, device, language));
      await inTurn(LANGUAGES, (language) => checkNarrow(browser, name, language));
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
