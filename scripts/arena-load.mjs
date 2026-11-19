// The arena's load budget (#149): BOT_FIGHTS arena rooms of the computer against the computer,
// each a best of 3, and WALKERS bots walking the world, on one in-process server for SECONDS.
// Passes when an arena step (two core steps) takes under 1 ms on average and the event loop, which
// runs every world tick, is never more than 10 ms late. A fight that ends is replaced at once.
//   node scripts/arena-load.mjs [--seconds 30] [--fights 6] [--walkers 4]
// Under the container's limits (1 CPU, 512 MB, compose.yaml), from the repository, on an image
// already pulled:
//   docker run --rm --network none --cpus 1 --memory 512m -v "$PWD":/app:ro -w /app \
//     --entrypoint node ghcr.io/nazuje/nebotok@<digest> scripts/arena-load.mjs
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs } from 'node:util';
import { Client } from '@colyseus/sdk';
import { createGameServer } from '../apps/server/src/app.ts';
import { readConfig } from '../apps/server/src/config.ts';
import { createFightBook } from '../apps/server/src/fights.ts';
import { createLog } from '../apps/server/src/log.ts';
import { createServices } from '../apps/server/src/services.ts';
import { DIRECTIONS, PLAYER_SPAWN, PROTOCOL_VERSION, arenaContentOf, createRng, createSave, defaultSettings, emptyProgress, newCreature, wildLoadout } from '../packages/core/src/index.ts';
import { sleep } from './lib/in-turn.mjs';
import { freePort } from './lib/server-process.mjs';

const { values } = parseArgs({ options: { seconds: { type: 'string', default: '30' }, fights: { type: 'string', default: '6' }, walkers: { type: 'string', default: '4' } } });
const SECONDS = Number(values.seconds);
const BOT_FIGHTS = Number(values.fights);
const WALKERS = Number(values.walkers);
const BUDGET = { meanStepMs: 1, worldLateMs: 10 };
const TURN_MS = 700;
const LEVEL = 30;

const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-arena-load-'));
const lines = [];
const log = createLog('info', (line) => lines.push(JSON.parse(line)));
const config = readConfig({ NODE_ENV: 'test', DATA_DIR: dataDir, ARENA_BATTLES: 'on' });
const services = createServices(config, Date.now, log);
const fights = createFightBook();
const server = createGameServer(config, log, services, { fights });
const port = await freePort();
await server.listen(port, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const world = services.world;
const arenaContent = arenaContentOf(world.battle);
const rng = createRng('arena-load');
const species = [...world.battle.species.keys()].toSorted();

const fighter = (id, kind) => ({ id, species: kind, level: LEVEL, loadout: wildLoadout(kind, LEVEL, arenaContent), turtle: false, computer: true });
const picks = (side) => [0, 1, 2].map((place) => ({ place: null, fighter: fighter(`${side}${place + 1}`, rng.pick(species)) }));

let opened = 0;
let ended = 0;
let running = true;
/** Opens a computer-against-computer best of 3, and another whenever one ends. */
async function openFight() {
  opened += 1;
  const fightId = `load-${opened}`;
  await fights.open({
    fightId,
    setup: { mode: 'rounds', seed: opened, picks: [picks('a'), picks('b')] },
    seats: [],
    minds: [
      { side: 0, mind: 'BOT' },
      { side: 1, mind: 'BOT' },
    ],
    ended: () => {
      ended += 1;
      if (running) void openFight();
    },
  });
}

/** A walker holds a random direction, turning every TURN_MS, as players wandering about do. */
async function walker(index, endsAt) {
  const made = await services.profiles.create({ name: `Load Walker ${String.fromCodePoint(65 + index)}`, avatar: 'green' });
  if (!made.ok) throw new Error(made.error);
  const spawn = world.map.spawns[PLAYER_SPAWN];
  const team = [newCreature(species[0], 5, world.battle)];
  services.progress.save(made.value.id, createSave({ settings: defaultSettings(), name: `Load Walker ${index}`, language: 'en', createdAt: new Date().toISOString(), position: { map: world.map.id, ...spawn, facing: 'down' }, ...emptyProgress(), team }));
  const session = await services.profiles.login({ profileId: made.value.id });
  if (!session.ok) throw new Error(session.error);
  const client = new Client(base);
  client.auth.token = session.value.token;
  const room = await client.joinOrCreate('world', { protocol: PROTOCOL_VERSION });
  room.onMessage('*', () => {});
  const turn = async () => {
    if (Date.now() > endsAt) return;
    room.send('walk.hold', { direction: rng.pick(DIRECTIONS) });
    await sleep(TURN_MS);
    await turn();
  };
  await turn();
  await room.leave();
}

const loop = monitorEventLoopDelay({ resolution: 1 });
let rssPeak = 0;
const memory = setInterval(() => {
  rssPeak = Math.max(rssPeak, process.memoryUsage().rss);
}, 250);

await Promise.all(Array.from({ length: BOT_FIGHTS }, () => openFight()));
const endsAt = Date.now() + SECONDS * 1000;
// Warm-up steps, while the walkers join, are not measured.
await sleep(1_000);
loop.enable();
await Promise.all(Array.from({ length: WALKERS }, (_, index) => walker(index, endsAt)));
loop.disable();
running = false;

const endedBefore = ended;
// Each fight logs its step count and times as it ends, so the ones still going are stopped first.
for (let index = 1; index <= opened; index += 1) fights.stop(`load-${index}`, 'shutdown');
const endedLines = lines.filter((line) => line.msg === 'fight ended');
const steps = endedLines.reduce((sum, line) => sum + line.steps, 0);
const totalMs = endedLines.reduce((sum, line) => sum + line.meanStepMs * line.steps, 0);
const worstStepMs = Math.max(0, ...endedLines.map((line) => line.worstStepMs));
clearInterval(memory);
await server.gracefullyShutdown(false);
services.close();
rmSync(dataDir, { recursive: true, force: true });

const meanStepMs = steps === 0 ? Infinity : totalMs / steps;
const worldLateMs = loop.max / 1e6;
const errors = lines.filter((line) => line.level === 'error').map((line) => line.msg);
const summary = {
  ok: meanStepMs < BUDGET.meanStepMs && worldLateMs <= BUDGET.worldLateMs && errors.length === 0 && steps > 0,
  budget: BUDGET,
  seconds: SECONDS,
  fights: { atOnce: BOT_FIGHTS, started: opened, endedDuringRun: endedBefore },
  walkers: WALKERS,
  arenaSteps: steps,
  meanStepMs: Number(meanStepMs.toFixed(3)),
  worstStepMs: Number(worstStepMs.toFixed(3)),
  worldLateMs: Number(worldLateMs.toFixed(1)),
  loopDelayP99Ms: Number((loop.percentile(99) / 1e6).toFixed(1)),
  rssPeakMb: Math.round(rssPeak / 2 ** 20),
  errors,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
