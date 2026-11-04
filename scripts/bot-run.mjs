// Level 3 bot run against the real server process, on a database in a temporary folder:
//   1. four bots create profiles over the HTTP API (one with a PIN), log in and join the world;
//   2. for about ten seconds they walk with both intents (walk to a tile, hold a direction), while
//      every bot's view of every player is sampled: no one may ever stand on a blocked tile;
//   3. one bot drops mid-walk and the SDK reconnects it to its own seat;
//   4. all four walk to the same tile and all arrive, since players never block each other;
//   5. they spread out, every view must agree, and the server is stopped with SIGTERM while they
//      are still connected; a fresh server on the same folder must start each bot where it stood.
//   node scripts/bot-run.mjs [--out <dir>]
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Callbacks, Client } from '@colyseus/sdk';
import { DIRECTIONS, PLAYER_SPAWN, PROTOCOL_VERSION, createRng, isWalkable, reachableFrom, readTiledMap } from '../packages/core/src/index.ts';
import { inTurn, poll, sleep } from './lib/in-turn.mjs';
import { ROOT, startServer } from './lib/server-process.mjs';

const WALK_MS = 10_000;
const SAMPLE_MS = 50;
// Invented names, one with the Slovenian letters the name rules allow.
const PROFILES = [
  { name: 'Bot Red', avatar: 'red' },
  { name: 'Bot Čebela', avatar: 'yellow', pin: '4826' },
  { name: 'Bot Blue', avatar: 'blue' },
  { name: 'Bot Green', avatar: 'green' },
];
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = values.out ?? join(ROOT, '.proof', 'bot-run');
mkdirSync(join(out, 'logs'), { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-bot-run-'));
const rng = createRng('bot-run');

const failures = [];
const step = (message) => console.log(`bot-run: ${message}`);
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};
async function until(check, what, deadline = Date.now() + 5_000) {
  if (!(await poll(check, { deadline }))) throw new Error(`timed out waiting for ${what}`);
}

async function api(base, method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { origin: base, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status} ${data.error}`);
  return data;
}

const view = (room) =>
  [...room.state.players.values()]
    .map((player) => `${player.name}@${player.x},${player.y}${player.moving ? '>' : ''}${player.connected ? '' : '(away)'}`)
    .toSorted()
    .join(' ');
// state.players exists only once the first state has arrived.
const mine = (bot) => bot.room.state.players?.get(bot.room.sessionId);
const standsOn = (bot, tile) => mine(bot)?.x === tile.x && mine(bot)?.y === tile.y && mine(bot)?.moving === false;
const settled = (bots) => bots.every((bot) => [...bot.room.state.players.values()].every((player) => !player.moving && player.connected));
const agree = (bots) => new Set(bots.map((bot) => view(bot.room))).size === 1;

async function joinWorld(base, profile, token) {
  const client = new Client(base);
  client.auth.token = token;
  const room = await client.joinOrCreate('world', { protocol: PROTOCOL_VERSION });
  const bot = { profile, room, welcomes: [], drops: 0, reconnects: 0, refusals: 0, count: null };
  room.onMessage('welcome', (message) => bot.welcomes.push(message));
  room.onMessage('walk.refused', () => {
    bot.refusals += 1;
  });
  Callbacks.get(room).listen('playerCount', (count) => {
    bot.count = count;
  });
  room.onDrop(() => {
    bot.drops += 1;
  });
  room.onReconnect(() => {
    bot.reconnects += 1;
  });
  return bot;
}

const login = (base, profile) => api(base, 'POST', '/api/sessions', profile.pin === undefined ? { profileId: profile.id } : { profileId: profile.id, pin: profile.pin });

async function loadMap(base, room) {
  const response = await fetch(`${base}/maps/${room.state.map}.tmj`);
  const result = readTiledMap(room.state.map, await response.json());
  if (!result.ok) throw new Error(`the served map does not read: ${result.problems.join('; ')}`);
  const reach = reachableFrom(result.map, result.map.spawns[PLAYER_SPAWN]);
  const tiles = reach.flatMap((ok, at) => (ok ? [{ x: at % result.map.width, y: Math.floor(at / result.map.width) }] : []));
  return { map: result.map, tiles };
}

/** Every SAMPLE_MS, checks every bot's view of every player against the map, until stopped. */
function sampleViews(bots, map) {
  const tally = { samples: 0, blocked: 0, sawAway: new Set() };
  const timer = setInterval(() => {
    for (const bot of bots) {
      for (const player of bot.room.state.players.values()) {
        tally.samples += 1;
        if (!isWalkable(map, player)) tally.blocked += 1;
        if (!player.connected) tally.sawAway.add(player.name);
      }
    }
  }, SAMPLE_MS);
  return { tally, stop: () => clearInterval(timer) };
}

/** One random intent per bot every 400 to 1200 ms until WALK_MS has passed. */
async function wander(bot, tiles, endsAt, intents) {
  if (Date.now() >= endsAt) return;
  if (rng.next() < 0.5) {
    bot.room.send('walk.to', rng.pick(tiles));
    intents.to += 1;
  } else {
    bot.room.send('walk.hold', { direction: rng.pick(DIRECTIONS) });
    intents.hold += 1;
  }
  await sleep(rng.int(400, 1_200));
  if (rng.next() < 0.3) bot.room.send('walk.stop', {});
  return wander(bot, tiles, endsAt, intents);
}

async function dropMidWalk(bot, tiles) {
  bot.room.reconnection.minUptime = 0;
  const sessionBefore = bot.room.sessionId;
  bot.room.send('walk.to', tiles.at(-1));
  await sleep(300);
  // leave(false) resolves only when the room is finally left, which a successful reconnect postpones.
  void bot.room.leave(false);
  await until(() => bot.reconnects === 1, 'the dropped bot to reconnect', Date.now() + 10_000);
  expect(bot.drops === 1, `the dropped bot saw ${bot.drops} drops`);
  expect(bot.room.sessionId === sessionBefore, 'the reconnected bot came back with a new session');
}

const positions = {};
const servers = [];
const EVENTS = ['player joined', 'player dropped', 'player reconnected', 'player left'];
const eventCounts = (server) => Object.fromEntries(EVENTS.map((event) => [event, server.lines.filter((line) => line.msg === event).length]));
const intents = { to: 0, hold: 0 };
let tally = null;

try {
  const first = await startServer({ env: { NODE_ENV: 'test', DATA_DIR: dataDir }, logFile: join(out, 'logs', 'bot-run-server.log') });
  servers.push(first);
  await inTurn(PROFILES, async (profile) => {
    profile.id = (await api(first.base, 'POST', '/api/profiles', profile)).id;
  });
  const listed = await api(first.base, 'GET', '/api/profiles');
  expect(listed.length === PROFILES.length && listed.every((row) => !('pin' in row)), 'the profile list is wrong or shows a PIN');

  // One at a time, so each bot's welcome carries a known player count.
  const bots = await inTurn(PROFILES, async (profile) => joinWorld(first.base, profile, (await login(first.base, profile)).token));
  step(`${bots.length} bots created profiles, logged in and joined`);
  await until(() => bots.every((bot) => bot.welcomes.length === 1 && bot.count === bots.length), 'every bot to be welcomed and count everyone');
  expect(new Set(bots.map((bot) => bot.room.roomId)).size === 1, 'bots ended up in different rooms');
  bots.forEach((bot, index) => expect(bot.welcomes[0]?.playerCount === index + 1, `bot ${index} was welcomed as player ${bot.welcomes[0]?.playerCount}`));
  const { map, tiles } = await loadMap(first.base, bots[0].room);

  const sampler = sampleViews(bots, map);
  tally = sampler.tally;
  const endsAt = Date.now() + WALK_MS;
  const dropper = bots[1];
  const others = bots.filter((bot) => bot !== dropper);
  await Promise.all([
    ...others.map((bot) => wander(bot, tiles, endsAt, intents)),
    sleep(WALK_MS / 2)
      .then(() => dropMidWalk(dropper, tiles))
      .then(() => wander(dropper, tiles, endsAt, intents)),
  ]);
  step(`bots walked for ${WALK_MS / 1000} s with ${intents.to} walk-to and ${intents.hold} hold intents; one dropped and reconnected`);
  expect(tally.sawAway.has(dropper.profile.name), 'no bot ever saw the dropped bot as away');

  for (const bot of bots) bot.room.send('walk.stop', {});
  await until(() => settled(bots) && agree(bots), 'every view to agree once everyone stopped', Date.now() + 10_000);

  const meeting = rng.pick(tiles);
  for (const bot of bots) bot.room.send('walk.to', meeting);
  await until(() => bots.every((bot) => standsOn(bot, meeting)), 'all four bots to stand on one tile', Date.now() + 20_000);
  step('all four bots stood on the same tile');

  const spread = Math.floor(tiles.length / bots.length);
  const homes = bots.map((_bot, index) => tiles[index * spread + rng.int(0, spread - 1)]);
  bots.forEach((bot, index) => bot.room.send('walk.to', homes[index]));
  await until(() => bots.every((bot, index) => standsOn(bot, homes[index])), 'every bot to reach its own tile', Date.now() + 20_000);
  await until(() => settled(bots) && agree(bots), 'every view to agree after spreading out');
  sampler.stop();
  expect(tally.blocked === 0, `${tally.blocked} of ${tally.samples} sampled positions were on blocked tiles`);
  for (const bot of bots) positions[bot.profile.name] = { x: mine(bot).x, y: mine(bot).y, facing: mine(bot).facing };
  step(`every view agrees: ${view(bots[0].room)}`);

  step('stopping the server with SIGTERM while every bot is connected');
  const stopped = await first.stop();
  expect(stopped.code === 0 && !stopped.timedOut, `server exited with code ${stopped.code} (${stopped.signal ?? 'no signal'})`);
  expect(first.lines.some((line) => line.msg === 'shutdown complete'), 'server did not log "shutdown complete"');

  const second = await startServer({ env: { NODE_ENV: 'test', DATA_DIR: dataDir }, logFile: join(out, 'logs', 'bot-run-restart.log') });
  servers.push(second);
  const back = await inTurn(PROFILES, async (profile) => joinWorld(second.base, profile, (await login(second.base, profile)).token));
  await until(() => back.every((bot) => mine(bot) !== undefined), 'every bot to see itself after the restart');
  for (const bot of back) {
    const was = positions[bot.profile.name];
    const now = mine(bot);
    expect(now.x === was.x && now.y === was.y && now.facing === was.facing, `${bot.profile.name} came back at ${now.x},${now.y} ${now.facing}, not ${was.x},${was.y} ${was.facing}`);
  }
  step('after a restart every bot started where it stood');
  await Promise.all(back.map((bot) => bot.room.leave()));
  await until(() => second.lines.filter((line) => line.msg === 'player left').length === back.length, 'the restarted server to log every leave');
} catch (error) {
  failures.push(error.message);
} finally {
  await Promise.all(servers.map(async (server, index) => {
    if (index === servers.length - 1) {
      const stopped = await server.stop();
      expect(stopped.code === 0 && !stopped.timedOut, `server ${index + 1} exited with code ${stopped.code}`);
    }
    for (const problem of server.problems()) failures.push(`server ${index + 1}: ${problem}`);
    server.saveLog();
  }));
  rmSync(dataDir, { recursive: true, force: true });
}

const summary = {
  ok: failures.length === 0,
  bots: PROFILES.length,
  intents,
  sampledPositions: tally?.samples ?? 0,
  blockedPositions: tally?.blocked ?? 0,
  positionsChecked: Object.keys(positions).length,
  events: servers.map(eventCounts),
  failures,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
