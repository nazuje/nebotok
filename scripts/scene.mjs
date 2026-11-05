// npm run scene -- <scene file> [--url <base>]
// Plays a scene (scripts/scenes/README.md): several players at once, each in its own headless,
// muted browser page against a running game, doing what the scene's steps say the way a player
// would: taps, held keys, waits, reloads and a dropped connection. After each step with a "shot"
// it saves every joined player's screenshot and test-hook state in .proof/scenes/<name>/. Fails on
// a console error, page error, failed or outside request, or a step that cannot be done. Every
// test player is signed out at the end, pass or fail.
// Without --url it plays this worktree's `npm run dev`, found through .proof/dev.json.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { PROTOCOL_VERSION, inBounds, isWalkable } from '../packages/core/src/index.ts';
import { BROWSERS, DEVICES, apiCall, inWorld, readState, reportCspViolations, screenshot, selfIn, servedMap, settledOn, signOut, tappable, tilesToScreen, until, watch } from './lib/game-page.mjs';
import { inTurn, sleep } from './lib/in-turn.mjs';
import { parseScene } from './lib/scene-file.mjs';
import { ROOT } from './lib/server-process.mjs';

const KEYS = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
// The close code the Colyseus client answers by reconnecting (MAY_TRY_RECONNECT), as after a real
// network drop; the server's side sees "going away", which it holds the seat open for.
const PAGE_CLOSE = 4010;
const SERVER_CLOSE = 1001;
const MAX_TAPS = 10;
const DEV_FILE = join(ROOT, '.proof', 'dev.json');

const fail = (message) => {
  console.error(`scene: ${message}`);
  process.exit(2);
};

const { values, positionals } = parseArgs({ allowPositionals: true, options: { url: { type: 'string' } } });
if (positionals.length !== 1) fail('usage: npm run scene -- <scene file> [--url <base>]');
const sceneFile = resolve(positionals[0]);
if (!existsSync(sceneFile)) fail(`no scene file at ${sceneFile}`);
const read = parseScene(readFileSync(sceneFile, 'utf8'));
if (!read.ok) fail(`${relative(ROOT, sceneFile)} is not a scene:\n${read.problems}`);
const scene = read.scene;

if (!values.url && !existsSync(DEV_FILE)) fail('no `npm run dev` is running in this worktree (.proof/dev.json is missing). Start it, or pass --url.');
const base = new URL(values.url ?? JSON.parse(readFileSync(DEV_FILE, 'utf8')).game).origin;
const allowedHost = new URL(base).host;

const health = (url) =>
  fetch(`${url}/healthz`)
    .then((response) => response.json())
    .then((body) => (body?.ok === true ? body : null))
    .catch(() => null);

/** In dev the page reaches the server through Vite's /colyseus proxy; a built server answers itself. */
async function serverAt(origin) {
  const [proxied, direct] = await Promise.all([health(`${origin}/colyseus`), health(origin)]);
  if (proxied) return { serverBase: `${origin}/colyseus`, protocol: proxied.protocol };
  if (direct) return { serverBase: origin, protocol: direct.protocol };
  throw new Error(`nothing at ${origin} answers /healthz like the game${values.url ? '' : ' (is `npm run dev` still running?)'}`);
}

const out = join(ROOT, '.proof', 'scenes', scene.name);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Each player is its own device: the server believes X-Forwarded-For from loopback (the dev proxy
// and a local `npm start` both connect from there), so the per-address API limits stay apart.
const players = new Map(scene.players.map((player, index) => [player.id, { ...player, address: `10.78.0.${index + 1}`, page: null, context: null, token: null, sockets: [], offlineUntil: 0, problems: [] }]));
const nameOf = (id) => players.get(id).name;
const browsers = new Map();
const problems = [];
const captures = [];
const done = [];
let serverBase = '';
let world = null;

const api = (player, path, options = {}) => apiCall(serverBase, path, { ...options, headers: { 'x-forwarded-for': player.address, ...options.headers } });

/** Logs the player's invented profile in, making it first when there is none by that name. */
async function signIn(player) {
  const listed = await api(player, '/profiles');
  let profile = Array.isArray(listed.data) ? listed.data.find((entry) => entry.name === player.name) : undefined;
  if (!profile) {
    const made = await api(player, '/profiles', { body: { name: player.name, avatar: player.avatar, ...(player.pin ? { pin: player.pin } : {}) } });
    if (made.status !== 201) throw new Error(`making ${player.name} answered ${made.status} ${JSON.stringify(made.data)}`);
    profile = made.data;
  }
  const login = await api(player, '/sessions', { body: { profileId: profile.id, ...(player.pin ? { pin: player.pin } : {}) } });
  if (login.status !== 200) throw new Error(`signing ${player.name} in answered ${login.status} ${JSON.stringify(login.data)}`);
  return login.data;
}

/** The page's first load finds the language and session as if the player had just signed in. */
const seed = ([language, session]) => {
  try {
    if (sessionStorage.getItem('nebotok:scene-seeded')) return;
    sessionStorage.setItem('nebotok:scene-seeded', '1');
    localStorage.setItem('nebotok:language', JSON.stringify(language));
    localStorage.setItem('nebotok:session', JSON.stringify(session));
  } catch {
    // about:blank and other pages without storage.
  }
};

async function browserFor(name) {
  if (!browsers.has(name)) {
    const { type, options } = BROWSERS.find((browser) => browser.name === name);
    browsers.set(name, await type.launch(options));
  }
  return browsers.get(name);
}

/**
 * Every WebSocket passes through here, so `drop` can cut the game's own. Vite's reload socket in
 * dev (on "/") passes untouched. While the player is offline, each new attempt is closed at once.
 */
function routeSockets(player) {
  return player.context.routeWebSocket(
    () => true,
    (socket) => {
      const game = new URL(socket.url()).pathname !== '/';
      if (game && Date.now() < player.offlineUntil) {
        socket.close({ code: PAGE_CLOSE, reason: 'scene: still offline' }).catch(() => {});
        return;
      }
      const server = socket.connectToServer();
      if (game) player.sockets.push({ socket, server });
    },
  );
}

async function joinWorld(player) {
  const login = await signIn(player);
  player.token = login.token;
  const { descriptor } = DEVICES.find((device) => device.name === player.device);
  player.context = await (await browserFor(player.browser)).newContext({ ...descriptor, extraHTTPHeaders: { 'x-forwarded-for': player.address } });
  await player.context.addInitScript(seed, [player.language, { token: login.token, profile: { id: login.profile.id, name: login.profile.name, avatar: login.profile.avatar } }]);
  await player.context.addInitScript(reportCspViolations);
  await routeSockets(player);
  player.page = await player.context.newPage();
  watch(player.context, player.page, player.problems, { allowedHost });
  await player.page.goto(`${base}/?test=1`);
  const state = await until(player.page, (s) => inWorld(s) && settledOn(s), `${player.id} to stand in the world`);
  if (state.profile?.name !== player.name) throw new Error(`${player.id} is signed in as ${state.profile?.name}, not ${player.name}`);
}

const checkTile = (tile) => {
  if (!isWalkable(world.map, tile) || !world.reach[tile.y * world.map.width + tile.x]) throw new Error(`no courier can stand on tile ${tile.x},${tile.y}`);
};

const checkOnMap = (tile) => {
  if (!inBounds(world.map, tile)) throw new Error(`tile ${tile.x},${tile.y} is off the map`);
};

/** Steps on foot from every tile to `to`, Infinity where it cannot be reached. */
function stepsTo(to) {
  const { map } = world;
  const steps = Array.from({ length: map.width * map.height }, () => Infinity);
  steps[to.y * map.width + to.x] = 0;
  const queue = [to];
  for (let at = 0; at < queue.length; at += 1) {
    const from = queue[at];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const tile = { x: from.x + dx, y: from.y + dy };
      const index = tile.y * map.width + tile.x;
      if (isWalkable(map, tile) && steps[index] === Infinity) {
        steps[index] = steps[from.y * map.width + from.x] + 1;
        queue.push(tile);
      }
    }
  }
  return steps;
}

/** Taps the tile on screen nearest `to` on foot, waits for the courier to arrive, and repeats until there. */
async function walk(page, to, taps = MAX_TAPS) {
  const state = await until(page, (s) => settledOn(s), 'the courier to stand still before walking');
  const self = selfIn(state);
  if (self.x === to.x && self.y === to.y) return;
  if (taps === 0) throw new Error(`still at ${self.x},${self.y} after ${MAX_TAPS} taps toward ${to.x},${to.y}`);
  const steps = stepsTo(to);
  const tiles = steps
    .flatMap((count, at) => (Number.isFinite(count) ? [{ count, x: at % world.map.width, y: Math.floor(at / world.map.width) }] : []))
    .filter((tile) => !(tile.x === self.x && tile.y === self.y))
    .toSorted((a, b) => a.count - b.count);
  const spots = await tilesToScreen(page, tiles);
  const index = spots.findIndex((spot) => tappable(page, spot));
  if (index === -1) throw new Error(`no tile toward ${to.x},${to.y} is on screen`);
  const target = tiles[index];
  await page.touchscreen.tap(spots[index].x, spots[index].y);
  const far = Math.abs(target.x - self.x) + Math.abs(target.y - self.y);
  await until(page, (s) => settledOn(s, target) && s.marker === null, `arrival at ${target.x},${target.y}`, far * 500 + 5_000);
  return walk(page, to, taps - 1);
}

/** Another player drawn standing still on `tile`, where the server has them too. */
const standing = (player, tile) => player && !player.moving && player.x === tile.x && player.y === tile.y && player.drawn.x === tile.x && player.drawn.y === tile.y;
const quietly = (closing) => closing.catch(() => {});

const apart = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
/** No name tag on the page covers another. */
const tagsApart = (state) => state.tags.every((tag, index) => state.tags.every((other, at) => at === index || apart(tag, other)));

/** Whether the page shows everything a `waitFor` step asks for. */
function shows(state, wanted) {
  const other = (id) => state.players.find((player) => !player.self && player.name === nameOf(id));
  return (
    (!wanted.connection || state.connection === wanted.connection) &&
    (!wanted.settled || Boolean(settledOn(state))) &&
    (!wanted.at || Boolean(settledOn(state, wanted.at))) &&
    (wanted.sees ?? []).every((id) => other(id)?.connected === true) &&
    (wanted.away ?? []).every((id) => other(id)?.connected === false) &&
    Object.entries(wanted.seesAt ?? {}).every(([id, tile]) => other(id)?.connected === true && standing(other(id), tile)) &&
    (!wanted.tagsApart || tagsApart(state)) &&
    (!wanted.unmarked || state.marker === null) &&
    (!wanted.welcome || wanted.welcome.includes(state.welcome === null ? 'hidden' : state.welcome.replace('welcome.', ''))) &&
    (!wanted.toast || wanted.toast === (state.toast === null ? 'hidden' : state.toast.replace('walk.', ''))) &&
    (!wanted.hint || wanted.hint === (state.hint ?? 'hidden'))
  );
}

const pageOf = (id) => players.get(id).page;

const STEPS = {
  join: (entry) => joinWorld(players.get(entry.player)),
  walk: (entry) => {
    checkTile(entry.to);
    return walk(pageOf(entry.player), entry.to);
  },
  tap: async (entry) => {
    checkOnMap(entry.tile);
    const page = pageOf(entry.player);
    const [spot] = await tilesToScreen(page, [entry.tile]);
    if (!tappable(page, spot)) throw new Error(`tile ${entry.tile.x},${entry.tile.y} is not on ${entry.player}'s screen; "walk" there instead`);
    await page.touchscreen.tap(spot.x, spot.y);
  },
  hold: async (entry) => {
    const page = pageOf(entry.player);
    await page.keyboard.down(KEYS[entry.direction]);
    await page.waitForTimeout(entry.ms);
    await page.keyboard.up(KEYS[entry.direction]);
  },
  wait: (entry) => sleep(entry.ms),
  waitFor: (entry) => until(pageOf(entry.player), (state) => shows(state, entry.until), `${entry.player} to show ${JSON.stringify(entry.until)}`, entry.ms, { ready: false }),
  reload: async (entry) => {
    await pageOf(entry.player).reload();
    await until(pageOf(entry.player), inWorld, `${entry.player} back in the world after a reload`);
  },
  drop: async (entry) => {
    const player = players.get(entry.player);
    player.offlineUntil = Date.now() + entry.ms;
    const open = player.sockets.splice(0);
    await Promise.all(open.flatMap(({ socket, server }) => [quietly(server.close({ code: SERVER_CLOSE })), quietly(socket.close({ code: PAGE_CLOSE, reason: 'scene: connection dropped' }))]));
  },
};

/** Every joined player's screenshot and state, named by step number, shot label and player. */
async function capture(number, label) {
  await inTurn([...players.values()].filter((player) => player.page), async (player) => {
    const stem = join(out, `${String(number).padStart(2, '0')}-${label}-${player.id}`);
    await screenshot(player.page, `${stem}.png`);
    const state = await readState(player.page).catch((error) => ({ unreadable: error.message.split('\n')[0] }));
    writeFileSync(`${stem}.json`, `${JSON.stringify(state, null, 2)}\n`);
    captures.push(relative(ROOT, `${stem}.png`));
  });
}

/** Signs each player out on their page, or ends the session on the server when the page cannot. */
async function signOutAll() {
  await inTurn([...players.values()].filter((player) => player.page), async (player) => {
    try {
      await signOut(player.page);
    } catch {
      const ended = await api(player, '/sessions/current', { method: 'DELETE', headers: { authorization: `Bearer ${player.token}` } });
      if (ended.status >= 400) problems.push(`${player.id} could not be signed out (${ended.status})`);
    }
  });
}

const started = Date.now();
try {
  const found = await serverAt(base);
  serverBase = found.serverBase;
  if (found.protocol !== PROTOCOL_VERSION) throw new Error(`the game at ${base} speaks protocol ${found.protocol}, this checkout ${PROTOCOL_VERSION}`);
  world = await servedMap(serverBase, JSON.parse(readFileSync(join(ROOT, 'content/world.json'), 'utf8')).startMap);
  console.log(`scene: ${scene.name} at ${base}`);
  await inTurn(scene.steps, async (entry, index) => {
    const at = Date.now();
    const label = `${index + 1} ${entry.do}${entry.player ? ` ${entry.player}` : ''}`;
    try {
      await STEPS[entry.do](entry);
      if (entry.shot) await capture(index + 1, entry.shot);
    } catch (error) {
      throw new Error(`step ${label}: ${error.message.split('\n')[0]}`, { cause: error });
    }
    done.push({ step: index + 1, do: entry.do, player: entry.player ?? null, shot: entry.shot ?? null, ms: Date.now() - at });
    console.log(`  ok   ${label}${entry.shot ? `, shot "${entry.shot}"` : ''} (${((Date.now() - at) / 1000).toFixed(1)}s)`);
  });
} catch (error) {
  problems.push(error.message);
} finally {
  await signOutAll().catch((error) => problems.push(`signing out: ${error.message}`));
  for (const player of players.values()) problems.push(...player.problems.map((problem) => `${player.id}: ${problem}`));
  await Promise.all([...players.values()].map((player) => player.context?.close()));
  await Promise.all([...browsers.values()].map((browser) => browser.close()));
}

const ok = problems.length === 0;
writeFileSync(join(out, 'scene.json'), `${JSON.stringify({ ok, scene: scene.name, file: relative(ROOT, sceneFile), url: base, durationMs: Date.now() - started, steps: done, problems, captures }, null, 2)}\n`);
for (const problem of problems) console.log(`  FAIL ${problem}`);
console.log(`\nscene ${scene.name}: ${ok ? 'PASSED' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)}s, ${captures.length} screenshot(s) with their state beside them:`);
for (const path of captures) console.log(`  ${path}`);
process.exit(ok ? 0 : 1);
