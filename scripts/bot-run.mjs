// Level 3 bot run: starts the real server process, connects four bot players for about five
// seconds, drops and reconnects one, then checks that every bot was welcomed, every count agreed,
// and the server logged no errors and shut down cleanly on SIGTERM.
//   node scripts/bot-run.mjs [--out <dir>]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Callbacks, Client } from '@colyseus/sdk';
import { PROTOCOL_VERSION } from '../packages/core/src/index.ts';
import { inTurn, poll, sleep } from './lib/in-turn.mjs';
import { ROOT, startServer } from './lib/server-process.mjs';

const BOTS = 4;
const RUN_MS = 5_000;
const { values } = parseArgs({ options: { out: { type: 'string' } } });
const out = values.out ?? join(ROOT, '.proof', 'bot-run');
mkdirSync(join(out, 'logs'), { recursive: true });

async function until(check, what, deadline = Date.now() + 5_000) {
  if (!(await poll(check, { deadline }))) throw new Error(`timed out waiting for ${what}`);
}

/** Pings from every bot four times a second until the run has lasted RUN_MS. */
async function pingUntilDone(bots, started) {
  if (Date.now() - started >= RUN_MS) return;
  for (const bot of bots) bot.room.send('ping', { sentAt: Date.now() });
  await sleep(250);
  return pingUntilDone(bots, started);
}

const failures = [];
const step = (message) => console.log(`bot-run: ${message}`);
const expect = (ok, message) => {
  if (!ok) failures.push(message);
};

const server = await startServer({ env: { NODE_ENV: 'test' }, logFile: join(out, 'logs', 'bot-run-server.log') });
const started = Date.now();
const bots = [];

try {
  const client = new Client(server.base);
  // One at a time, so each bot's welcome carries a known player count.
  await inTurn(Array.from({ length: BOTS }, (_, index) => index), async (index) => {
    const room = await client.joinOrCreate('world', { protocol: PROTOCOL_VERSION });
    const bot = { index, room, welcomes: [], pongs: 0, count: null, drops: 0, reconnects: 0 };
    room.onMessage('welcome', (message) => bot.welcomes.push(message));
    room.onMessage('pong', () => {
      bot.pongs += 1;
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
    bots.push(bot);
  });

  step(`${BOTS} bots joined`);
  await until(() => bots.every((bot) => bot.welcomes.length === 1), 'every bot to be welcomed');
  await until(() => bots.every((bot) => bot.count === BOTS), `every bot to see ${BOTS} players`);
  expect(new Set(bots.map((bot) => bot.room.roomId)).size === 1, 'bots ended up in different rooms');
  bots.forEach((bot, index) => {
    const welcome = bot.welcomes[0];
    expect(welcome?.protocol === PROTOCOL_VERSION, `bot ${index} welcome has protocol ${welcome?.protocol}`);
    expect(welcome?.playerCount === index + 1, `bot ${index} was welcomed as player ${welcome?.playerCount}, not ${index + 1}`);
    expect(welcome?.messageKey === (index === 0 ? 'welcome.alone' : 'welcome.together'), `bot ${index} got ${welcome?.messageKey}`);
  });

  // A drop is a connection lost without leaving. The SDK only retries rooms older than minUptime.
  step('every bot welcomed and counting the same');
  const dropper = bots[1];
  dropper.room.reconnection.minUptime = 0;
  const sessionBefore = dropper.room.sessionId;
  // leave(false) resolves only when the room is finally left, which a successful reconnect postpones.
  void dropper.room.leave(false);
  await until(() => dropper.reconnects === 1, 'the dropped bot to reconnect', Date.now() + 10_000);
  expect(dropper.drops === 1, `the dropped bot saw ${dropper.drops} drops`);
  expect(dropper.room.sessionId === sessionBefore, 'the reconnected bot came back with a new session');

  step('a dropped bot reconnected to its own seat');
  await pingUntilDone(bots, started);
  await until(() => bots.every((bot) => bot.pongs > 0), 'every bot to get a pong');
  await until(() => bots.every((bot) => bot.count === BOTS), 'counts to settle after the reconnect');

  step('every bot got pongs');
  const leaver = bots.pop();
  await leaver.room.leave();
  await until(() => bots.every((bot) => bot.count === BOTS - 1), `the others to see ${BOTS - 1} players`);
  step('one bot left and the others counted down');
  await Promise.all(bots.map((bot) => bot.room.leave()));
  await until(() => server.lines.filter((line) => line.msg === 'player left').length === BOTS, 'the server to log every leave');
} catch (error) {
  failures.push(error.message);
} finally {
  step('stopping the server with SIGTERM');
  const stopped = await server.stop();
  expect(stopped.code === 0 && !stopped.timedOut, `server exited with code ${stopped.code} (${stopped.signal ?? 'no signal'})`);
  expect(server.lines.some((line) => line.msg === 'shutdown complete'), 'server did not log "shutdown complete"');
  for (const problem of server.problems()) failures.push(problem);
  server.saveLog();
}

const count = (message) => server.lines.filter((line) => line.msg === message).length;
const summary = {
  ok: failures.length === 0,
  bots: BOTS,
  seconds: Math.round((Date.now() - started) / 100) / 10,
  joined: count('player joined'),
  dropped: count('player dropped'),
  reconnected: count('player reconnected'),
  left: count('player left'),
  failures,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
