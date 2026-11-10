// Level 4 restart check: the server stops dead in the middle of a wild battle and starts again on
// the same port and database, as after a crash or a power cut. Two players are in the world, one
// on an iPhone in Chromium (English) and one on an iPad in WebKit (Slovenian). The first meets a
// wild creature and plays a turn; then the server is killed and started again. Battles live only
// in the server's memory, so the page must give the old one up: back in the world, standing where
// the battle started, with the team as it was before it, walking where it is tapped. The other
// player must count two players again. Fails on any console error, page error, failed or outside
// request outside the outage itself, and on any error the server logs.
//   node scripts/restart-check.mjs [--out <dir>]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PLAYER_SPAWN } from '../packages/core/src/index.ts';
import {
  BROWSERS,
  DEVICES,
  HOOK,
  apiCall,
  battleIdle,
  enterWorld,
  inWorld,
  meetWildCreature,
  nextFrames,
  readState,
  reportCspViolations,
  screenshot,
  selfIn,
  servedMap,
  settledOn,
  until,
  untilTappingThrough,
  walkByTaps,
  watch,
} from './lib/game-page.mjs';
import { inTurn, poll, sleep } from './lib/in-turn.mjs';
import { ROOT, startServer } from './lib/server-process.mjs';
import { runTag } from './lib/test-players.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = values.out ?? join(ROOT, '.proof', 'restart-check');
const shots = join(out, 'screenshots');
const logs = join(out, 'logs');
mkdirSync(shots, { recursive: true });
mkdirSync(logs, { recursive: true });

if (!existsSync(join(ROOT, 'apps/game/dist/index.html'))) {
  console.error('restart-check: apps/game/dist is missing. Run: npm run build');
  process.exit(1);
}

const START_MAP = JSON.parse(readFileSync(join(ROOT, 'content/world.json'), 'utf8')).startMap;
// The SDK reconnects by itself only to a room that has been up this long; the issue it guards
// against showed after such a reconnection gave up, so the battle starts later than this.
const SDK_MIN_UPTIME_MS = 5_000;
// How long the server stays down: long enough for both pages to notice, as in a real restart.
const DOWN_MS = 3_000;
// How long both pages must keep counting two players once they are back.
const COUNT_HELD_MS = 3_000;
const TAG = runTag();

const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-restart-check-'));
const env = { NODE_ENV: 'production', DATA_DIR: dataDir };
let server = await startServer({ env, logFile: join(logs, 'restart-check-server-1.log') });
const { port, base } = server;
const allowedHost = new URL(base).host;
const servers = [server];

const problems = [];
const notes = [];
const screenshots = [];
const expect = (ok, message) => {
  if (!ok) problems.push(message);
};

// While the server is down, a page's failed attempts to reach it are the point, not a problem.
let outage = false;
const outageNoise = [];
const OUTAGE_NOISE = /^(failed request|console error|websocket error)/;
// The game's WebSocket URLs carry the session token, which stays out of the logs.
const redacted = (problem) => problem.replaceAll(/_authToken=[^&\s']*/g, '_authToken=<redacted>');
const sinkFor = (who) => ({
  push: (problem) => {
    if (outage && OUTAGE_NOISE.test(problem)) outageNoise.push(`${who}: ${redacted(problem)}`);
    else problems.push(`${who}: ${redacted(problem)}`);
  },
});

/** The page's first load finds the language and session as if the player had just signed in. */
const seed = ([language, session]) => {
  try {
    if (sessionStorage.getItem('nebotok:restart-seeded')) return;
    sessionStorage.setItem('nebotok:restart-seeded', '1');
    localStorage.setItem('nebotok:language', JSON.stringify(language));
    localStorage.setItem('nebotok:session', JSON.stringify(session));
  } catch {
    // about:blank and other pages without storage.
  }
};

const PLAYERS = [
  { id: 'lan', name: `Znova Kro Ab ${TAG}`, avatar: 'green', browser: 'chromium', device: 'iphone-portrait', language: 'en', address: '10.79.0.1' },
  { id: 'zarja', name: `Znova Web Čž ${TAG}`, avatar: 'purple', browser: 'webkit', device: 'ipad-landscape', language: 'sl', address: '10.79.0.2' },
];

const browsers = [];
async function enter(player, world) {
  const api = (path, body) => apiCall(base, path, { body, headers: { 'x-forwarded-for': player.address } });
  const made = await api('/profiles', { name: player.name, avatar: player.avatar });
  if (made.status !== 201) throw new Error(`making ${player.id} answered ${made.status}`);
  const login = await api('/sessions', { profileId: made.data.id });
  if (login.status !== 200) throw new Error(`signing ${player.id} in answered ${login.status}`);
  const { type, options } = BROWSERS.find((browser) => browser.name === player.browser);
  const browser = await type.launch(options);
  browsers.push(browser);
  const { descriptor } = DEVICES.find((device) => device.name === player.device);
  const context = await browser.newContext({ ...descriptor, extraHTTPHeaders: { 'x-forwarded-for': player.address } });
  const { token, profile } = login.data;
  await context.addInitScript(seed, [player.language, { token, profile: { id: profile.id, name: profile.name, avatar: profile.avatar } }]);
  await context.addInitScript(reportCspViolations);
  const page = await context.newPage();
  watch(context, page, sinkFor(player.id), { allowedHost });
  await page.goto(`${base}/?test=1`);
  await enterWorld(page, world, (s) => inWorld(s) && settledOn(s), `${player.id} to stand in the world`, { notes });
  return { ...player, page, joinedAt: Date.now() };
}

const shot = async (step, players) => {
  await inTurn(players, async (player) => {
    const path = join(shots, `restart-${step}-${player.id}.png`);
    await screenshot(player.page, path);
    screenshots.push(path);
  });
};

const otherIn = (state, name) => state.players.find((player) => !player.self && player.name === name);
const sameTeam = (a, b) => JSON.stringify(a?.map(({ species, level, hp }) => ({ species, level, hp }))) === JSON.stringify(b?.map(({ species, level, hp }) => ({ species, level, hp })));

/** Meets a wild creature and plays one turn of the weather call, which does no damage, so the battle goes on. */
async function battleTurn(page, world) {
  await meetWildCreature(page, world, { notes });
  const before = await until(page, battleIdle, 'the wild battle to offer a choice', 15_000);
  await nextFrames(page);
  const slot = Math.min(3, before.battle.menu.moves.length - 1);
  await page.locator('#battle .move').nth(slot).tap();
  const turned = await untilTappingThrough(page, (s) => battleIdle(s) && (s.battle.turn > before.battle.turn || s.battle.panel === 'result'), 'the first turn to play', 15_000);
  if (turned.battle.panel === 'result') throw new Error('the first turn ended the battle, so there was no battle to restart in');
  await nextFrames(page);
  return turned;
}

/**
 * Waits until the page is back in the world after the restart and its courier has settled (the
 * prediction catches up a frame or two after the room's state), noting every toast it showed on
 * the way.
 */
async function backInWorld(page, toasts) {
  let last = null;
  const back = await poll(
    async () => {
      last = await readState(page).catch(() => null);
      if (last?.toast) toasts.add(last.toast);
      const ready = await page.evaluate((key) => window[key]?.ready === true, HOOK).catch(() => false);
      return ready && last !== null && inWorld(last) && last.screen === 'world' && last.battle === null && settledOn(last);
    },
    { deadline: Date.now() + 45_000, intervalMs: 100 },
  );
  if (!back) throw new Error(`the page never came back to the world, settled, after the restart; last state ${JSON.stringify(last)}`);
  return last;
}

/** Both pages count two players, and keep counting two for COUNT_HELD_MS. */
async function countsTwo(players) {
  const both = () => Promise.all(players.map((player) => readState(player.page).then((s) => s.playerCount)));
  const reached = await poll(async () => (await both()).every((count) => count === 2), { deadline: Date.now() + 20_000, intervalMs: 100 });
  expect(reached, `after the restart the pages count ${JSON.stringify(await both())} players, not 2 each`);
  const dropped = await poll(async () => (await both()).some((count) => count !== 2), { deadline: Date.now() + COUNT_HELD_MS, intervalMs: 100 });
  expect(!dropped, `after the restart a page went back to ${JSON.stringify(await both())} players`);
}

const started = Date.now();
try {
  const world = await servedMap(base, START_MAP);
  const [lan, zarja] = await inTurn(PLAYERS, (player) => enter(player, world));
  await sleep(Math.max(0, lan.joinedAt + SDK_MIN_UPTIME_MS - Date.now()));

  const inBattle = await battleTurn(lan.page, world);
  const battleTile = { x: selfIn(inBattle).x, y: selfIn(inBattle).y };
  const teamBefore = inBattle.progress?.team;
  await until(zarja.page, (s) => otherIn(s, lan.name)?.inBattle === true, 'the friend to see the battle mark');
  await shot('1-battle', [lan, zarja]);

  outage = true;
  await server.kill();
  await until(lan.page, (s) => s.connection !== 'connected', 'the page to notice the server is gone', 20_000, { ready: false });
  await sleep(DOWN_MS);
  await shot('2-outage', [lan]);

  server = await startServer({ env, port, logFile: join(logs, 'restart-check-server-2.log') });
  servers.push(server);
  const toasts = new Set();
  const back = await backInWorld(lan.page, toasts);
  await until(zarja.page, (s) => inWorld(s) && otherIn(s, lan.name)?.connected === true, 'the friend back in the world, seeing the player', 30_000);
  outage = false;
  expect(toasts.has('battle.interrupted'), `the page did not say the battle was cut short; it showed ${JSON.stringify([...toasts])}`);
  expect(!toasts.has('refused.notInBattle'), 'the page was refused as not in a battle');
  expect(back.screen === 'world' && back.battle === null, `after the restart the page shows ${back.screen} with battle ${JSON.stringify(back.battle)}`);
  expect(settledOn(back, battleTile), `after the restart the courier stands on ${JSON.stringify(selfIn(back))}, not where the battle started, ${JSON.stringify(battleTile)}`);
  expect(sameTeam(back.progress?.team, teamBefore), `after the restart the team is ${JSON.stringify(back.progress?.team)}, not as before the battle, ${JSON.stringify(teamBefore)}`);
  await countsTwo([lan, zarja]);
  await nextFrames(lan.page);
  await shot('3-back', [lan, zarja]);

  const spawn = world.map.spawns[PLAYER_SPAWN];
  const walked = await walkByTaps(lan.page, world, spawn, { notes });
  expect(settledOn(walked, spawn), `taps after the restart left the courier on ${JSON.stringify(selfIn(walked))}, not the spawn`);
  const seen = await until(zarja.page, (s) => {
    const other = otherIn(s, lan.name);
    return other?.connected === true && other.x === spawn.x && other.y === spawn.y && !other.moving;
  }, 'the friend to see the player walk to the spawn', 20_000).catch((error) => {
    problems.push(error.message.split('\n')[0]);
    return null;
  });
  if (seen) await shot('4-walked', [lan, zarja]);
} catch (error) {
  problems.push(error.message.split('\n')[0]);
} finally {
  await Promise.all(browsers.map((browser) => browser.close()));
  const stopped = await server.stop();
  if (stopped.code !== 0) problems.push(`the restarted server exited with code ${stopped.code}`);
  for (const each of servers) {
    problems.push(...each.problems().map((problem) => `server: ${problem}`));
    each.saveLog();
  }
  rmSync(dataDir, { recursive: true, force: true });
}

const ok = problems.length === 0;
writeFileSync(join(logs, 'restart-check.json'), `${JSON.stringify({ ok, durationMs: Date.now() - started, problems, notes, outageNoise, screenshots }, null, 2)}\n`);
for (const note of notes) console.log(`note: ${note}`);
console.log(`${outageNoise.length} expected failure(s) to reach the server while it was down`);
for (const problem of problems) console.log(`FAIL ${problem}`);
console.log(ok ? `restart-check: passed, ${screenshots.length} screenshot(s)` : `restart-check: ${problems.length} problem(s)`);
process.exit(ok ? 0 : 1);
