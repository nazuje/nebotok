// What the browser check and the scene command (scripts/scene.mjs) share: the browsers and devices,
// watching a page for trouble, the page's ?test=1 hook (apps/game/src/test-hook.ts), the server's
// profile API and maps, and getting a courier into the world and around it past the tall grass.
import { chromium, devices, webkit } from '@playwright/test';
import { PLAYER_SPAWN, encounterZoneAt, findPath, isWalkable, readTiledMap, reachableFrom } from '../../packages/core/src/index.ts';
import { inTurn, poll } from './in-turn.mjs';
import { chromiumLaunchOptions, webkitLaunchOptions } from './launch-options.mjs';
import { livePorts } from './local-stack.mjs';

const THIS_COMPUTER = new Set(['127.0.0.1', 'localhost']);

/**
 * The origin of `url`, when it is a game the test tools may play: one on this computer and not on
 * the live game's port. Throws otherwise, so a scene or a browser check never makes players in the
 * family's world.
 */
export function testBase(url, env = process.env) {
  const parsed = new URL(url);
  if (!THIS_COMPUTER.has(parsed.hostname)) throw new Error(`${parsed.origin} is not on this computer; test tools play only 127.0.0.1 or localhost`);
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  if (livePorts(env).includes(port)) throw new Error(`${parsed.origin} is the live game's port; play npm run dev or the container check's own stack instead`);
  return parsed.origin;
}

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

/** Two frames later: the hook answers from the model at once, and the page redraws its screens on the next frame. */
export const nextFrames = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

/**
 * Waits until the page's state passes `check`, choosing the first starter on the way when the page
 * asks a new player for one, as every player entering the world for the first time is asked. The
 * world can show before the server's progress arrives, so it counts only once the progress says
 * there is a starter.
 */
export async function enterWorld(page, check, what, timeoutMs = 20_000) {
  const state = await until(page, (s) => s.screen === 'starter' || (check(s) && s.progress?.needsStarter === false), what, timeoutMs);
  if (state.screen !== 'starter') return state;
  await nextFrames(page);
  await page.locator('.starter-choice').first().tap();
  return until(page, (s) => s.progress?.needsStarter === false && check(s), `${what} after choosing a starter`, timeoutMs);
}

/** Whether `tile` is tall grass, where a wild creature may appear. `world` is a servedMap. */
export const inGrass = (world, tile) => encounterZoneAt(world.map, tile) !== null;
/** Whether the walk the page plans from `from` to `to` (the core's path) stays out of the grass. */
export const clearWalk = (world, from, to) => {
  const path = findPath(world.map, from, to);
  return path !== null && !path.some((tile) => inGrass(world, tile));
};

/** In a battle that waits for the player: no turn playing, no choice unanswered. */
export const battleIdle = (state) => state.screen === 'battle' && state.battle !== null && !state.battle.playing && !state.battle.waiting && state.battle.panel !== null;
const MAX_BATTLE_CHOICES = 40;

/**
 * `until`, tapping the battle field whenever a turn is playing, as a player in a hurry would, so
 * its lines move on at once. For steps that do not look at how long the lines stay up.
 */
export async function untilTappingThrough(page, check, what, timeoutMs = 20_000, deadline = Date.now() + timeoutMs) {
  const state = await until(page, (s) => check(s) || s.battle?.playing === true, what, Math.max(1_000, deadline - Date.now()));
  if (check(state)) return state;
  await page.locator('#battle .battle-field').tap();
  return untilTappingThrough(page, check, what, timeoutMs, deadline);
}

/** The button that gets a player out of a battle soonest from where it stands. */
function wayOut(battle) {
  if (battle.panel === 'result') return '.battle-continue';
  if (battle.panel === 'team') return '.battle-choice:enabled';
  if (battle.panel === 'treats') return '.battle-back';
  return battle.menu.run ? '.battle-run' : '.move';
}

/** Runs from the battle on the page (attacking when running is not allowed) and continues past its result; returns the state back in the world. */
export async function leaveBattle(page, choices = MAX_BATTLE_CHOICES) {
  const state = await untilTappingThrough(page, (s) => s.screen !== 'battle' || battleIdle(s), 'the battle to wait for a choice', 15_000);
  if (state.screen !== 'battle') return state;
  if (choices === 0) throw new Error(`still in battle ${state.battle.id} after ${MAX_BATTLE_CHOICES} choices`);
  const { panel, turn } = state.battle;
  await nextFrames(page);
  await page.locator(`#battle ${wayOut(state.battle)}`).first().tap();
  await until(page, (s) => !battleIdle(s) || s.battle.panel !== panel || s.battle.turn !== turn, 'the battle to take a choice', 5_000);
  return leaveBattle(page, choices - 1);
}

/**
 * `until`, with a safety net for a step that is not about battles: when a wild battle starts
 * instead, it is run from, noted in `notes`, and the wait goes on.
 */
export async function untilPastBattles(page, check, what, notes, timeoutMs = 20_000, options = {}) {
  const state = await until(page, (s) => s.screen === 'battle' || check(s), what, timeoutMs, options);
  if (state.screen !== 'battle' || check(state)) return state;
  notes.push(`ran from a wild battle that started while waiting for ${what}`);
  await leaveBattle(page);
  return until(page, check, what, timeoutMs, options);
}

const MAX_TAPS = 10;
const STEPS_AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1]];

/** Steps on foot from every tile to `to`, Infinity where it cannot be reached; `careful` keeps out of the grass. */
function stepsTo(world, to, careful) {
  const { map } = world;
  const steps = Array.from({ length: map.width * map.height }, () => Infinity);
  steps[to.y * map.width + to.x] = 0;
  const queue = [to];
  for (let at = 0; at < queue.length; at += 1) {
    const from = queue[at];
    for (const [dx, dy] of STEPS_AROUND) {
      const tile = { x: from.x + dx, y: from.y + dy };
      const index = tile.y * map.width + tile.x;
      if (isWalkable(map, tile) && !(careful && inGrass(world, tile)) && steps[index] === Infinity) {
        steps[index] = steps[from.y * map.width + from.x] + 1;
        queue.push(tile);
      }
    }
  }
  return steps;
}

/** The on-screen tile to tap next toward `to`, nearest it on foot; when `careful`, one whose walk keeps out of the grass. */
async function nextTap(page, world, self, to, careful) {
  const tiles = stepsTo(world, to, careful)
    .flatMap((count, at) => (Number.isFinite(count) ? [{ count, x: at % world.map.width, y: Math.floor(at / world.map.width) }] : []))
    .filter((tile) => !(tile.x === self.x && tile.y === self.y))
    .toSorted((a, b) => a.count - b.count);
  const spots = await tilesToScreen(page, tiles);
  const index = spots.findIndex((spot, at) => tappable(page, spot) && (!careful || clearWalk(world, self, tiles[at])));
  return index === -1 ? null : { tile: tiles[index], spot: spots[index] };
}

/**
 * Walks the page's courier to `to` by taps: on the on-screen tile nearest it on foot, waiting for
 * the courier to stop, until it stands there. Walks keep out of the tall grass when they can. A
 * wild battle on the way is run from and noted in `notes`, unless `meet` asks for one, when the walk
 * ends there instead. Returns the last state.
 */
export async function walkByTaps(page, world, to, { notes, meet = false, taps = MAX_TAPS }) {
  const state = await until(page, (s) => settledOn(s) || (meet && s.screen === 'battle'), 'the courier to stand still before walking');
  if (state.screen === 'battle') return state;
  const self = selfIn(state);
  if (self.x === to.x && self.y === to.y) return state;
  if (taps === 0) throw new Error(`still at ${self.x},${self.y} after ${MAX_TAPS} taps toward ${to.x},${to.y}`);
  const next = (!meet && (await nextTap(page, world, self, to, true))) || (await nextTap(page, world, self, to, false));
  if (!next) throw new Error(`no tile toward ${to.x},${to.y} is on screen`);
  await page.touchscreen.tap(next.spot.x, next.spot.y);
  const far = Math.abs(next.tile.x - self.x) + Math.abs(next.tile.y - self.y);
  const what = `arrival at ${next.tile.x},${next.tile.y}`;
  const arrived = await until(page, (s) => s.screen === 'battle' || (settledOn(s, next.tile) && s.marker === null), what, far * 500 + 5_000);
  if (arrived.screen === 'battle') {
    if (meet) return arrived;
    notes.push(`ran from a wild battle that started on the way to ${to.x},${to.y}`);
    await leaveBattle(page);
  }
  return walkByTaps(page, world, to, { notes, meet, taps: taps - 1 });
}

const MAX_GRASS_STEPS = 80;
const apartBy = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** The tall grass tile beside open ground nearest the spawn, and a grass tile next to it to step back and forth on (on the edge too when there is one). */
export function grassEdge(world) {
  const spawn = world.map.spawns[PLAYER_SPAWN];
  const free = (tile) => isWalkable(world.map, tile) && world.reach[tile.y * world.map.width + tile.x];
  const around = (tile) => STEPS_AROUND.map(([dx, dy]) => ({ x: tile.x + dx, y: tile.y + dy })).filter(free);
  const onEdge = (tile) => around(tile).some((next) => !inGrass(world, next));
  const mateOf = (tile) => {
    const grass = around(tile).filter((next) => inGrass(world, next));
    return grass.find(onEdge) ?? grass[0];
  };
  const [nearest] = world.map.encounterAreas
    .flatMap((area) => Array.from({ length: area.width * area.height }, (_, at) => ({ x: area.x + (at % area.width), y: area.y + Math.floor(at / area.width) })))
    .filter((tile) => free(tile) && onEdge(tile) && mateOf(tile))
    .toSorted((a, b) => apartBy(a, spawn) - apartBy(b, spawn));
  if (!nearest) throw new Error(`${world.map.id} has no tall grass to meet a wild creature in`);
  return [nearest, mateOf(nearest)];
}

/** Steps back and forth between the two grass tiles until a wild creature appears. */
async function stepInGrass(page, pair, steps) {
  const target = pair[steps % 2];
  const [spot] = await tilesToScreen(page, [target]);
  await page.touchscreen.tap(spot.x, spot.y);
  const state = await until(page, (s) => s.screen === 'battle' || (settledOn(s, target) && s.marker === null), `a step in the grass to ${target.x},${target.y}`, 5_000);
  if (state.screen === 'battle') return state;
  if (steps >= MAX_GRASS_STEPS) throw new Error(`no wild creature appeared in ${MAX_GRASS_STEPS} steps through the tall grass`);
  return stepInGrass(page, pair, steps + 1);
}

/**
 * Walks to the tall grass nearest the spawn and steps about in it until a wild creature appears on
 * the server, as a player looking for one would. Returns the state once the battle is on screen.
 */
export async function meetWildCreature(page, world, { notes }) {
  const pair = grassEdge(world);
  const met = await walkByTaps(page, world, pair[0], { notes, meet: true });
  return met.screen === 'battle' ? met : stepInGrass(page, pair, 1);
}
