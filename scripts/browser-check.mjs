// Level 4 browser check: starts the real production server serving apps/game/dist, then plays the
// page in headless Chromium and WebKit on an iPhone (portrait) and an iPad (landscape) in both
// languages, the way a player would: make a player with a PIN on the number pad, enter the world
// and see the map and their courier, watch a bot walk past (named, smooth) and drop (away), tap a
// far tile with a real touch and arrive, walk with arrows, WASD and the joystick, reload
// and come straight back, switch player, get the PIN wrong, then right. Fails on any console
// error, page error, failed or outside request, a missing connection, a language toggle that does
// not change the text, small touch targets, or sideways scrolling at 360px wide.
//   node scripts/browser-check.mjs [--out <dir>] [--url <base>]
// With --url it plays a game that is already running there (the container check) instead.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@colyseus/sdk';
import { chromium, devices, webkit } from '@playwright/test';
import { PLAYER_SPAWN, PROTOCOL_VERSION, isWalkable, reachableFrom, readTiledMap } from '../packages/core/src/index.ts';
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
// (5 new profiles and 10 logins a minute) never throttle a check that makes many players. A server
// given by --url may not believe the header, so there the runs are spaced out instead.
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

// A bot of our own (a plain SDK client) walks past each page's courier, so the check can see that
// another player is drawn, named, walks smoothly and turns away when it drops.
const BOT = { name: 'Bot Oblak', avatar: 'red' };
const START_MAP = JSON.parse(readFileSync(join(ROOT, 'content/world.json'), 'utf8')).startMap;
// Offsets from the page's courier: where the bot starts, then where it walks to, in view of it.
const FAR = [[-4, 0], [4, 0], [0, -4], [0, 4], [-3, -2], [3, 2]];
const NEAR = [[3, 0], [-3, 0], [0, 3], [0, -3], [2, 1], [-2, -1]];

async function prepareBot() {
  const address = nextAddress();
  const made = await api('/profiles', { body: BOT, address });
  if (made.status !== 201) throw new Error(`browser-check: making the bot answered ${made.status}`);
  const login = await api('/sessions', { body: { profileId: made.data.id }, address });
  if (login.status !== 200) throw new Error(`browser-check: signing the bot in answered ${login.status}`);
  const read = readTiledMap(START_MAP, await (await fetch(`${server.base}/maps/${START_MAP}.tmj`)).json());
  if (!read.ok) throw new Error(`browser-check: the served map does not read: ${read.problems.join('; ')}`);
  return { token: login.data.token, map: read.map, reach: reachableFrom(read.map, read.map.spawns[PLAYER_SPAWN]) };
}

function tileNear(bot, from, offsets) {
  for (const [dx, dy] of offsets) {
    const tile = { x: from.x + dx, y: from.y + dy };
    if (isWalkable(bot.map, tile) && bot.reach[tile.y * bot.map.width + tile.x]) return tile;
  }
  throw new Error(`no free tile near ${from.x},${from.y}`);
}

async function joinBot(bot) {
  const client = new Client(server.base);
  client.auth.token = bot.token;
  const room = await client.joinOrCreate('world', { protocol: PROTOCOL_VERSION, language: 'en' });
  room.onMessage('welcome', () => {});
  return room;
}

const botIn = (state) => state.players.find((player) => player.name === BOT.name);
const standsOn = (player, tile) => player?.x === tile.x && player.y === tile.y && !player.moving && player.drawn.x === tile.x && player.drawn.y === tile.y;

const OFFSETS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const selfIn = (state) => state.players.find((player) => player.self);
/** Settled where the server says, drawn there too, with nothing left to do. */
const settledOn = (state, tile) => {
  const self = selfIn(state);
  return self && !self.moving && self.drawn.x === self.x && self.drawn.y === self.y && state.predicted?.intent === 'idle' && !state.predicted.moving && (!tile || (self.x === tile.x && self.y === tile.y));
};

/** A direction with two free tiles ahead, so a short hold is sure to move. */
function openDirection(bot, from, not = []) {
  const free = (tile) => isWalkable(bot.map, tile) && bot.reach[tile.y * bot.map.width + tile.x];
  const found = Object.entries(OFFSETS).find(([name, [dx, dy]]) => !not.includes(name) && free({ x: from.x + dx, y: from.y + dy }) && free({ x: from.x + 2 * dx, y: from.y + 2 * dy }));
  if (!found) throw new Error(`no open direction from ${from.x},${from.y}`);
  return found[0];
}

const movedToward = (from, to, direction) => {
  const [dx, dy] = OFFSETS[direction];
  return (to.x - from.x) * dx + (to.y - from.y) * dy >= 1 && (dx === 0 ? to.x === from.x : to.y === from.y);
};

/** The reachable tile on screen, clear of the corners, furthest from `from`. */
async function farTile(page, bot, from) {
  const { width, height } = page.viewportSize();
  const tiles = bot.reach.flatMap((ok, at) => (ok ? [{ x: at % bot.map.width, y: Math.floor(at / bot.map.width) }] : []));
  const spots = await page.evaluate(([key, list]) => list.map(({ x, y }) => window[key].tileToScreen(x, y)), [HOOK, tiles]);
  let best = null;
  tiles.forEach((tile, index) => {
    const spot = spots[index];
    const far = Math.abs(tile.x - from.x) + Math.abs(tile.y - from.y);
    if (spot && spot.x > 40 && spot.x < width - 40 && spot.y > 100 && spot.y < height - 90 && (!best || far > best.far)) best = { tile, spot, far };
  });
  return best;
}

/** A thumb on the left half, pushed one way and held. Real touches in Chromium; a mouse in WebKit. */
async function pushJoystick(page, browserName, direction, holdMs) {
  const { width, height } = page.viewportSize();
  const start = { x: Math.round(width * 0.22), y: Math.round(height * 0.62) };
  const [dx, dy] = OFFSETS[direction];
  const end = { x: start.x + dx * 50, y: start.y + dy * 50 };
  let release;
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: at.x, y: at.y, id: 1 }] : [] });
    await touch('touchStart', start);
    await inTurn([0.3, 0.6, 1], (step) => touch('touchMove', { x: start.x + (end.x - start.x) * step, y: start.y + (end.y - start.y) * step }));
    release = () => touch('touchEnd');
  } else {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 3 });
    release = () => page.mouse.up();
  }
  const during = await readState(page);
  await page.waitForTimeout(holdMs);
  return { during, release };
}

/** Tap a far tile with a real touch, then walk with the keyboard and the joystick. */
async function moveAround(page, browserName, bot, language, { expect, shot }) {
  let state = await readState(page);
  const before = selfIn(state);
  const far = await farTile(page, bot, before);
  expect(far && far.far >= 5, `no far tile to tap on screen: ${JSON.stringify(far)}`);
  if (!far) return;
  await page.touchscreen.tap(far.spot.x, far.spot.y);
  state = await until(page, (s) => s.predicted?.intent === 'path' || (s.predicted?.moving ?? false), 'the courier to start walking after a tap', 2_000);
  expect(state.marker?.x === far.tile.x && state.marker?.y === far.tile.y, `the marker is on ${JSON.stringify(state.marker)}, not the tapped ${far.tile.x},${far.tile.y}`);
  await page.waitForTimeout(300);
  await shot('7-tap');
  state = await until(page, (s) => settledOn(s, far.tile) && s.marker === null, `arrival at the tapped tile ${far.tile.x},${far.tile.y}`, far.far * 400 + 5_000);

  const keySets = [
    { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' },
    { up: 'w', down: 's', left: 'a', right: 'd' },
  ];
  await inTurn(keySets, async (keys) => {
    const from = selfIn(state);
    const direction = openDirection(bot, from);
    await page.keyboard.down(keys[direction]);
    await page.waitForTimeout(450);
    await page.keyboard.up(keys[direction]);
    state = await until(page, (s) => settledOn(s), `the courier to stop after holding ${keys[direction]}`, 5_000);
    expect(movedToward(from, selfIn(state), direction), `holding ${keys[direction]} moved the courier from ${from.x},${from.y} to ${selfIn(state).x},${selfIn(state).y}, not ${direction}`);
  });

  await page.locator('.settings-button').tap();
  await page.locator('.controls').tap();
  state = await until(page, (s) => s.controls === 'joystick', 'the joystick to be chosen');
  expect((await textOf(page, '.controls [aria-current="true"]')) === STRINGS['settings.controls.joystick'][language], 'the controls toggle does not show the joystick chosen');
  await page.locator('.settings-button').tap();
  await until(page, (s) => !s.settingsOpen, 'the settings to close');
  const from = selfIn(state);
  const direction = openDirection(bot, from);
  const { during, release } = await pushJoystick(page, browserName, direction, 450);
  expect(during.input.joystick === direction, `the joystick reads ${during.input.joystick}, not ${direction}`);
  expect(await page.locator('.joystick').isVisible(), 'the joystick is not shown under the thumb');
  await shot('8-joystick');
  await release();
  state = await until(page, (s) => s.input.joystick === null && settledOn(s), 'the courier to stop when the thumb lifts', 5_000);
  expect(movedToward(from, selfIn(state), direction), `the joystick moved the courier from ${from.x},${from.y} to ${selfIn(state).x},${selfIn(state).y}, not ${direction}`);
  expect(!(await page.locator('.joystick').isVisible()), 'the joystick stays after the thumb lifts');
}
/** The bot joins, walks past the page's courier while the page is sampled, then drops. */
async function meetBot(bot, page, self, { expect, shot }) {
  const room = await joinBot(bot);
  try {
    await until(page, (s) => botIn(s)?.connected === true, 'the page to see the bot');
    const seesPage = await poll(() => [...(room.state.players?.values() ?? [])].some((player) => player.name === self.name && player.x === self.x && player.y === self.y), {
      deadline: Date.now() + 5_000,
    });
    expect(seesPage, 'the bot does not see the page’s courier where the page says it stands');

    const start = tileNear(bot, self, FAR);
    room.send('walk.to', start);
    await until(page, (s) => standsOn(botIn(s), start), 'the bot at its starting tile', 15_000);
    const goal = tileNear(bot, self, NEAR);
    room.send('walk.to', goal);
    const seen = [];
    const arrived = await poll(
      async () => {
        const seenBot = botIn(await readState(page));
        if (seenBot) seen.push(seenBot);
        return standsOn(seenBot, goal);
      },
      { deadline: Date.now() + 15_000, intervalMs: 30 },
    );
    expect(arrived, `the page never drew the bot standing on ${goal.x},${goal.y}; last ${JSON.stringify(seen.at(-1))}`);
    expect(seen.some((seenBot) => seenBot.walking), 'the page never drew the bot walking');
    expect(seen.some((seenBot) => !Number.isInteger(seenBot.drawn.x) || !Number.isInteger(seenBot.drawn.y)), 'the page never drew the bot between two tiles');

    // Measured in one go after two frames, so the name has been placed for the bot's final position.
    const placed = await page.evaluate(async ([key, x, y, name]) => {
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const tag = [...document.querySelectorAll('.name-tag')].find((element) => element.textContent === name)?.getBoundingClientRect();
      const spot = window[key].tileToScreen(x, y);
      const next = window[key].tileToScreen(x + 1, y);
      return { tag: tag && { x: tag.x, y: tag.y, width: tag.width, height: tag.height }, spot, tilePx: next && spot ? next.x - spot.x : null };
    }, [HOOK, goal.x, goal.y, BOT.name]);
    const { tag, spot, tilePx } = placed;
    const above = tag && spot ? spot.y - (tag.y + tag.height) : null;
    expect(tag && spot && Math.abs(tag.x + tag.width / 2 - spot.x) < tilePx / 2 && above > 0 && above < tilePx * 2, `the bot’s name is not just above it: ${JSON.stringify(placed)}`);
    await shot('5-others');

    room.reconnection.enabled = false;
    void room.leave(false);
    await until(page, (s) => botIn(s)?.connected === false, 'the page to show the bot away');
    // The name tag is restyled on the next drawn frame, which a busy machine can be slow to draw.
    const dimmed = await poll(async () => (await page.locator('.name-tag.away', { hasText: BOT.name }).count()) === 1, { deadline: Date.now() + 3_000, intervalMs: 50 });
    expect(dimmed, 'the away bot’s name is not dimmed');
    await shot('6-away');
  } finally {
    if (room.connection?.isOpen) await room.leave().catch(() => {});
  }
}

async function checkDevice(browser, browserName, device, language, bot) {
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
    expect(state.scene === 'world', `scene is ${state.scene}`);
    expect(state.map === START_MAP, `the map drawn is ${state.map}, not ${START_MAP}`);
    const self = state.players.find((player) => player.self);
    expect(self?.name === name && self.avatar === 'green', `the page's own courier is ${JSON.stringify(self)}`);
    const selfSpot = self ? await page.evaluate(([key, x, y]) => window[key].tileToScreen(x, y), [HOOK, self.x, self.y]) : null;
    const viewport = page.viewportSize();
    expect(selfSpot && selfSpot.x > 0 && selfSpot.y > 0 && selfSpot.x < viewport.width && selfSpot.y < viewport.height, `the page's own courier is off screen at ${JSON.stringify(selfSpot)}`);
    expect((await textOf(page, '.badge-text')) === STRINGS['connection.connected'][language], 'the badge does not say connected');
    await targets('world');
    await shot('4-world');
    if (self) await meetBot(bot, page, self, { expect, shot });
    if (self) await moveAround(page, browserName, bot, language, { expect, shot });

    await page.reload();
    state = await until(page, inWorld, 'the world straight after a reload');
    expect(state.profile?.name === name, 'a reload did not resume the same player');

    await page.locator('.settings-button').tap();
    await until(page, (s) => s.settingsOpen, 'the settings panel');
    expect((await textOf(page, '.switch-player')) === STRINGS['profile.switch'][language], 'the switch player button has the wrong text');
    await targets('settings');
    await shot('9-settings');
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
    await shot('10-pin-wrong');
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
    // Sign out, so this run's courier does not stand on the spawn, away, through the runs after it.
    await page.locator('.settings-button').tap();
    await page.locator('.switch-player').tap();
    await until(page, (s) => s.screen === 'profiles' && s.profile === null, 'the profile list after signing out');
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
  const bot = await prepareBot();
  await inTurn(BROWSERS, async ({ name, type, options }) => {
    const browser = await type.launch(options);
    try {
      await inTurn(runs, ({ device, language }) => checkDevice(browser, name, device, language, bot));
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
