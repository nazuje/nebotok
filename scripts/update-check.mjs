// Level 4 update check: a page installed under the service worker reaches a new release with a
// bumped protocol, as after every deploy that changes what client and server say to each other.
// Build A is the checkout's own build (apps/game/dist), served by the real server; build B is the
// same game built into a temporary folder speaking protocol + 1, served after a restart on the same
// port and database by the server made to speak it too (scripts/lib/protocol-shift.mjs, test only).
// In Chromium (English, iPhone) and WebKit (Slovenian, iPad), four pages load A and let its service
// worker take them over, then the server switches to B:
//   auto   in the world: refused for its protocol, it reloads onto B by itself, with no tap
//   tap    in the world with its one automatic reload already spent: shows Reload, one tap reaches B
//   news   on the profile list: coming back into view finds B and offers it; one tap reaches B
//   fresh  closed before the switch: opening the game again starts straight on B
// Fails on any console error, page error, failed or outside request, except while a page is
// between A and B, and on any error the servers log.
//   node scripts/update-check.mjs [--out <dir>]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { build } from 'vite';
import { PROTOCOL_VERSION } from '../packages/core/src/index.ts';
import { BROWSERS, DEVICES, apiCall, inWorld, presetLanguage, readState, reportCspViolations, screenshot, until, watch } from './lib/game-page.mjs';
import { inTurn, poll } from './lib/in-turn.mjs';
import { protocolPlugin } from './lib/protocol-shift.mjs';
import { ROOT, startServer } from './lib/server-process.mjs';
import { runTag } from './lib/test-players.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = values.out ?? join(ROOT, '.proof', 'update-check');
const shots = join(out, 'screenshots');
const logs = join(out, 'logs');
mkdirSync(shots, { recursive: true });
mkdirSync(logs, { recursive: true });

const DIST_A = join(ROOT, 'apps/game/dist');
if (!existsSync(join(DIST_A, 'index.html'))) {
  console.error('update-check: apps/game/dist is missing. Run: npm run build');
  process.exit(1);
}

const STRINGS = JSON.parse(readFileSync(join(ROOT, 'content/strings.json'), 'utf8'));
const NEXT_PROTOCOL = PROTOCOL_VERSION + 1;
// The flag apps/game/src/updates.ts keeps while a tab's one automatic reload is spent.
const AUTO_RELOAD_KEY = 'nebotok:outdatedReload';
const MIN_TARGET_PX = 48;
// A dropped page notices the new server, is refused, and takes the new build within this.
const RECOVER_MS = 60_000;
// `serviceWorker.ready` resolves once a worker is active, before its activate handler has claimed the
// open pages; on a slow runner WebKit has taken seconds between the two.
const CLAIM_MS = 20_000;
const TAG = runTag();
const RUNS = [
  { browser: 'chromium', device: 'iphone-portrait', language: 'en' },
  { browser: 'webkit', device: 'ipad-landscape', language: 'sl' },
];
const SCENARIOS = [
  { id: 'auto', signedIn: true },
  { id: 'tap', signedIn: true },
  { id: 'news', signedIn: false },
  { id: 'fresh', signedIn: true },
];

const problems = [];
const notes = [];
const screenshots = [];
const expect = (ok, message) => {
  if (!ok) problems.push(message);
};
// The game's WebSocket URLs carry the session token, which stays out of the logs.
const redacted = (problem) => problem.replaceAll(/_authToken=[^&\s']*/g, '_authToken=<redacted>');
// Between A and B a page's connection drops, its join is refused and it reloads: that is the point.
const SWITCH_NOISE = /^(failed request|websocket error|HTTP \d+|console error: (?!CSP violation))/;
const switchNoise = [];

const scriptOf = (html) => html.match(/<script type="module" crossorigin src="([^"]+)"/)?.[1] ?? null;
const pageScript = (page) => page.evaluate(() => document.querySelector('script[type="module"][src]')?.getAttribute('src') ?? null).catch(() => null);
const controlled = (page) => page.evaluate(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined).catch(() => false);
/** Whether a worker controls the page, waiting up to timeoutMs for the controllerchange of one claiming it. */
const takenOver = (page, timeoutMs) =>
  page
    .evaluate(
      (ms) =>
        new Promise((resolve) => {
          const { serviceWorker } = navigator;
          if (serviceWorker.controller) {
            resolve(true);
            return;
          }
          const timer = setTimeout(() => resolve(serviceWorker.controller !== null), ms);
          serviceWorker.addEventListener(
            'controllerchange',
            () => {
              clearTimeout(timer);
              resolve(true);
            },
            { once: true },
          );
        }),
      timeoutMs,
    )
    .catch(() => false);
const offer = (page) => page.evaluate(() => {
  const button = document.querySelector('.update-button');
  if (!button || button.hidden) return null;
  const box = button.getBoundingClientRect();
  return { offer: button.dataset.offer, text: button.textContent, width: box.width, height: box.height };
}).catch(() => null);

/** Signs the page in once, as if the player had just picked their profile; reloads keep what the page did since. */
const seed = ([session]) => {
  try {
    if (localStorage.getItem('nebotok:update-seeded')) return;
    localStorage.setItem('nebotok:update-seeded', '1');
    if (session) localStorage.setItem('nebotok:session', JSON.stringify(session));
  } catch {
    // about:blank and other pages without storage.
  }
};

const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-update-check-'));
const distB = mkdtempSync(join(tmpdir(), 'nebotok-update-check-b-'));
const browsers = [];
const servers = [];
let server = null;
const started = Date.now();
let workers = {};

async function buildB() {
  await build({
    root: join(ROOT, 'apps/game'),
    configFile: join(ROOT, 'apps/game/vite.config.ts'),
    logLevel: 'warn',
    build: { outDir: distB, emptyOutDir: true },
    plugins: [protocolPlugin(NEXT_PROTOCOL)],
  });
  const script = scriptOf(readFileSync(join(distB, 'index.html'), 'utf8'));
  if (script === null || script === scriptOf(readFileSync(join(DIST_A, 'index.html'), 'utf8'))) throw new Error(`build B loads ${script}, which is not a new build`);
  return script;
}

async function protocolOf(base) {
  return (await (await fetch(`${base}/healthz`)).json()).protocol;
}

async function open(run, scenario, index, base) {
  const label = `${run.browser}-${scenario.id}`;
  const address = `10.73.${index + 1}.1`;
  let session = null;
  if (scenario.signedIn) {
    const api = (path, body) => apiCall(base, path, { body, headers: { 'x-forwarded-for': address } });
    const made = await api('/profiles', { name: `Nova ${scenario.id} ${run.browser.slice(0, 3)} ${TAG}`.slice(0, 16), avatar: 'green' });
    if (made.status !== 201) throw new Error(`making ${label} answered ${made.status}`);
    const login = await api('/sessions', { profileId: made.data.id });
    if (login.status !== 200) throw new Error(`signing ${label} in answered ${login.status}`);
    const { token, profile } = login.data;
    session = { token, profile: { id: profile.id, name: profile.name, avatar: profile.avatar } };
  }
  const { type, options } = BROWSERS.find((browser) => browser.name === run.browser);
  let browser = browsers.find((each) => each.name === run.browser)?.browser;
  if (!browser) {
    browser = await type.launch(options);
    browsers.push({ name: run.browser, browser });
  }
  const { descriptor } = DEVICES.find((device) => device.name === run.device);
  const context = await browser.newContext({ ...descriptor, serviceWorkers: 'allow', extraHTTPHeaders: { 'x-forwarded-for': address } });
  await context.addInitScript(presetLanguage, run.language);
  await context.addInitScript(seed, [session]);
  await context.addInitScript(reportCspViolations);
  const player = { ...run, ...scenario, label, context, page: null, switching: false, navigations: 0 };
  player.sink = {
    push: (problem) => {
      if (player.switching && SWITCH_NOISE.test(problem)) switchNoise.push(`${label}: ${redacted(problem)}`);
      else problems.push(`${label}: ${redacted(problem)}`);
    },
  };
  await openPage(player, base);
  return player;
}

async function openPage(player, base) {
  const page = await player.context.newPage();
  watch(player.context, page, player.sink, { allowedHost: new URL(base).host });
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) player.navigations += 1;
  });
  player.page = page;
  player.navigations = 0;
  await page.goto(`${base}/?test=1`);
}

const shot = async (player, step) => {
  const path = join(shots, `update-${player.label}-${step}.png`);
  await screenshot(player.page, path);
  screenshots.push(path);
};

/** Build A is up, its service worker controls the page, and the page is where its scenario starts. */
async function onA(player) {
  const { page } = player;
  const arrive = () =>
    player.signedIn
      ? until(page, (s) => inWorld(s) && s.protocol === PROTOCOL_VERSION, `${player.label} in the world on build A`, 30_000)
      : until(page, (s) => s.screen === 'profiles', `${player.label} on the profile list on build A`, 30_000);
  await arrive();
  const hasWorker = await page.evaluate(() => 'serviceWorker' in navigator);
  if (!hasWorker) return false;
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  // A worker that does not claim open pages controls them from their next load, as for a returning
  // player; that is a failure, but the check carries on to show what else it costs.
  if (!(await takenOver(page, CLAIM_MS))) {
    problems.push(`${player.label}: build A's service worker did not take the open page over`);
    await page.reload();
    await arrive();
  }
  const took = await poll(() => controlled(page), { deadline: Date.now() + 30_000, intervalMs: 100 });
  if (!took) throw new Error(`${player.label}: build A's service worker never took the page over`);
  if (player.id === 'tap') await page.evaluate((key) => sessionStorage.setItem(key, '1'), AUTO_RELOAD_KEY);
  if (player.id === 'fresh') await page.close();
  return true;
}

/** Waits until the page runs build B and stands where its scenario should end. */
async function onB(player, scriptB, what) {
  const reached = await poll(
    async () => {
      if ((await pageScript(player.page)) !== scriptB) return false;
      const state = await readState(player.page).catch(() => null);
      if (state === null) return false;
      return player.signedIn ? inWorld(state) && state.protocol === NEXT_PROTOCOL : state.screen === 'profiles';
    },
    { deadline: Date.now() + RECOVER_MS, intervalMs: 200 },
  );
  if (!reached) {
    const state = await readState(player.page).catch(() => null);
    throw new Error(`${player.label}: ${what}; the page runs ${await pageScript(player.page)}, connection ${state?.connection}, screen ${state?.screen}`);
  }
  player.switching = false;
  expect((await offer(player.page)) === null, `${player.label}: build B still offers an update: ${JSON.stringify(await offer(player.page))}`);
}

function checkOffer(player, shown, kind) {
  const id = kind === 'reload' ? 'update.reload' : 'update.available';
  expect(shown?.offer === kind, `${player.label}: the page offers ${JSON.stringify(shown)}, not ${kind}`);
  expect(shown?.text === STRINGS[id][player.language], `${player.label}: the button says "${shown?.text}", not "${STRINGS[id][player.language]}"`);
  expect(shown && shown.width >= MIN_TARGET_PX && shown.height >= MIN_TARGET_PX, `${player.label}: the button is ${shown?.width}x${shown?.height}px, under ${MIN_TARGET_PX}px`);
}

async function playB(player, scriptB) {
  const { page } = player;
  if (player.id === 'auto') {
    await onB(player, scriptB, 'never reached build B by itself');
    expect(player.navigations >= 2, `${player.label}: reached build B without reloading (${player.navigations} load(s))`);
    const flag = await page.evaluate((key) => sessionStorage.getItem(key), AUTO_RELOAD_KEY);
    expect(flag === null, `${player.label}: the automatic reload stays spent after connecting`);
    await shot(player, '2-on-b');
  } else if (player.id === 'tap') {
    await until(page, (s) => s.connection === 'outdated', `${player.label} to be refused as out of date`, RECOVER_MS, { ready: false });
    const shown = await poll(() => offer(page), { deadline: Date.now() + 5_000, intervalMs: 100 });
    checkOffer(player, shown, 'reload');
    expect((await page.locator('.badge-text').textContent()) === STRINGS['connection.outdated'][player.language], `${player.label}: the badge does not say the page is out of date`);
    expect((await pageScript(page)) !== scriptB, `${player.label}: the page reloaded by itself with its automatic reload spent`);
    await shot(player, '2-outdated');
    await page.locator('.update-button').tap();
    await onB(player, scriptB, 'one tap on Reload did not reach build B');
    await shot(player, '3-on-b');
  } else if (player.id === 'news') {
    // The page coming back into view, as when a tablet is woken or the app is switched back to.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    const shown = await poll(() => offer(page), { deadline: Date.now() + 20_000, intervalMs: 100 });
    checkOffer(player, shown, 'update');
    expect((await pageScript(page)) !== scriptB, `${player.label}: the page reloaded without being asked`);
    await shot(player, '2-offer');
    await page.locator('.update-button').tap();
    await onB(player, scriptB, 'one tap on the update offer did not reach build B');
    await shot(player, '3-on-b');
  } else {
    await openPage(player, server.base);
    await onB(player, scriptB, 'opening the game again did not start on build B');
    expect(player.navigations === 1, `${player.label}: opening the game again needed ${player.navigations} loads, not 1`);
    await shot(player, '2-on-b');
  }
}

const results = [];
try {
  const scriptB = await buildB();
  server = await startServer({ env: { NODE_ENV: 'production', DATA_DIR: dataDir }, logFile: join(logs, 'update-check-server-a.log') });
  servers.push(server);
  const { port, base } = server;
  expect((await protocolOf(base)) === PROTOCOL_VERSION, `server A speaks protocol ${await protocolOf(base)}`);

  const players = await inTurn(
    RUNS.flatMap((run) => SCENARIOS.map((scenario) => ({ run, scenario }))),
    ({ run, scenario }, index) => open(run, scenario, index, base),
  );
  workers = Object.fromEntries(await inTurn(RUNS, async (run) => {
    const own = players.filter((player) => player.browser === run.browser);
    const has = await inTurn(own, (player) => onA(player));
    return [run.browser, has.every(Boolean)];
  }));
  const playing = players.filter((player) => workers[player.browser]);
  for (const run of RUNS) if (!workers[run.browser]) notes.push(`${run.browser} has no service worker here, so its update was not checked`);
  await inTurn(playing.filter((player) => player.id !== 'fresh'), (player) => shot(player, '1-on-a'));

  for (const player of playing) player.switching = true;
  await server.stop();
  const hooks = pathToFileURL(join(ROOT, 'scripts/lib/protocol-shift-hooks.mjs')).href;
  server = await startServer({
    port,
    logFile: join(logs, 'update-check-server-b.log'),
    env: {
      NODE_ENV: 'production',
      DATA_DIR: dataDir,
      GAME_DIST: distB,
      NEBOTOK_TEST_PROTOCOL: String(NEXT_PROTOCOL),
      NODE_OPTIONS: [process.env.NODE_OPTIONS, `--import=${hooks}`].filter(Boolean).join(' '),
    },
  });
  servers.push(server);
  expect((await protocolOf(base)) === NEXT_PROTOCOL, `server B speaks protocol ${await protocolOf(base)}, not ${NEXT_PROTOCOL}`);

  await inTurn(playing, async (player) => {
    const before = problems.length;
    try {
      await playB(player, scriptB);
    } catch (error) {
      problems.push(error.message.split('\n')[0]);
    }
    results.push({ label: player.label, ok: problems.length === before });
  });
} catch (error) {
  problems.push(error.message.split('\n')[0]);
} finally {
  await Promise.all(browsers.map(({ browser }) => browser.close()));
  if (server) {
    const stopped = await server.stop();
    if (stopped.code !== 0) problems.push(`server B exited with code ${stopped.code}`);
  }
  for (const each of servers) {
    problems.push(...each.problems().map((problem) => `server: ${problem}`));
    each.saveLog();
  }
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(distB, { recursive: true, force: true });
}

const ok = problems.length === 0;
writeFileSync(join(logs, 'update-check.json'), `${JSON.stringify({ ok, durationMs: Date.now() - started, workers, results, problems, notes, switchNoise, screenshots }, null, 2)}\n`);
for (const result of results) console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.label}`);
for (const note of notes) console.log(`note: ${note}`);
console.log(`${switchNoise.length} expected failure(s) while pages moved from build A to build B`);
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(ok ? `update-check: passed, ${screenshots.length} screenshot(s)` : `update-check: ${problems.length} problem(s)`);
process.exit(ok ? 0 : 1);
