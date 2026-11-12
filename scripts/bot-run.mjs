// Level 3 bot run against the real server process, on a database in a temporary folder:
//   1. four bots create profiles over the HTTP API (one with a PIN), log in and join the world;
//   2. for about ten seconds they walk with both intents (walk to a tile, hold a direction), while
//      every bot's view of every player is sampled: no one may ever stand on a blocked tile;
//   3. one bot drops mid-walk and the SDK reconnects it to its own seat;
//   4. all four walk to the same tile and all arrive, since players never block each other;
//   5. they spread out, every view must agree, and the server is stopped with SIGTERM while they
//      are still connected; a fresh server on the same folder must start each bot where it stood;
//   6. two bots talk to the starter's character for a starter, step about in the tall grass until
//      a wild creature appears, and play their battles to the end at the same time, never refused
//      a request;
//   7. the other two play the story at the same time, by what core's nextGoal asks, until the
//      first quest is done: the starter from its character, the quest, its steps and its rewards;
//   8. meanwhile a fifth, courier bot, whose save was given a delivery job and its items while the
//      server was stopped, gets its board on joining, opens the job board when the map places one
//      (which draws the empty slots), and delivers the job to its character in a talk.
//   node scripts/bot-run.mjs [--out <dir>]
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Callbacks, Client } from '@colyseus/sdk';
import { loadWorld } from '../apps/server/src/world.ts';
import { DATABASE_FILE, openDatabase } from '../apps/server/src/db.ts';
import { createProgressStore } from '../apps/server/src/progress.ts';
import {
  DIRECTIONS,
  PLAYER_SPAWN,
  PROTOCOL_VERSION,
  createRng,
  createSave,
  emptyProgress,
  encounterZoneAt,
  isWalkable,
  newCreature,
  nextGoal,
  reachableFrom,
  readTiledMap,
  storyBotCommand,
} from '../packages/core/src/index.ts';
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
const COURIER = { name: 'Bot Courier', avatar: 'green' };
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
  const bot = {
    profile,
    room,
    welcomes: [],
    progress: [],
    battles: { started: [], turns: [], results: [], refused: [] },
    story: { messages: [], nodes: [], ended: [], changes: [], offers: [] },
    jobs: { boards: [], changes: [] },
    drops: 0,
    reconnects: 0,
    refusals: 0,
    count: null,
  };
  room.onMessage('welcome', (message) => bot.welcomes.push(message));
  room.onMessage('progress', (message) => bot.progress.push(message));
  room.onMessage('battle.started', (message) => bot.battles.started.push(message));
  room.onMessage('battle.turn', (message) => bot.battles.turns.push(message));
  room.onMessage('battle.result', (message) => bot.battles.results.push(message));
  room.onMessage('refused', (message) => bot.battles.refused.push(message));
  room.onMessage('storage', () => {});
  room.onMessage('story', (message) => bot.story.messages.push(message));
  room.onMessage('talk.node', (message) => bot.story.nodes.push(message));
  room.onMessage('talk.ended', (message) => bot.story.ended.push(message));
  room.onMessage('quest.changed', (message) => bot.story.changes.push(message));
  room.onMessage('move.offer', (message) => bot.story.offers.push(message));
  room.onMessage('skills', () => {});
  room.onMessage('jobs', (message) => bot.jobs.boards.push(message));
  room.onMessage('job.changed', (message) => bot.jobs.changes.push(message));
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

// Battle requests are limited per client, so bots pace theirs.
const REQUEST_GAP_MS = 250;
const STARTERS = JSON.parse(readFileSync(join(ROOT, 'content/starters.json'), 'utf8')).species;

/** The bot's request for this view: leave a beaten wild creature, send out a fresh one, or attack. */
function battleChoice(battle) {
  if (battle.phase === 'befriend') return ['battle.run', {}];
  if (battle.mustSwap) return ['battle.switch', { index: battle.team.creatures.findIndex((creature, index) => index !== battle.team.active && creature.hp > 0) }];
  return ['battle.move', { slot: 0 }];
}

/** Steps back and forth between two tall-grass tiles until wild creature number `index` appears. */
async function pace(bot, tiles, index = 0, steps = 0) {
  if (bot.battles.started.length > index) return bot.battles.started[index].battle;
  if (steps > 200) throw new Error(`${bot.profile.name} met no wild creature in 200 steps`);
  const tile = tiles[steps % 2];
  bot.room.send('walk.to', tile);
  await until(() => standsOn(bot, tile) || bot.battles.started.length > 0, `${bot.profile.name} to step in the grass`);
  return pace(bot, tiles, index, steps + 1);
}

/** Answers each battle view until the battle is over. */
async function playBattle(bot, battle, turns = 0) {
  if (battle.phase === 'over') return;
  if (turns > 80) throw new Error(`${bot.profile.name}'s battle did not end`);
  await sleep(REQUEST_GAP_MS);
  const seen = bot.battles.turns.length;
  bot.room.send(...battleChoice(battle));
  await until(() => bot.battles.turns.length > seen, `${bot.profile.name}'s battle turn`);
  return playBattle(bot, bot.battles.turns.at(-1).battle, turns + 1);
}

/** Gets a starter from the character who offers it, paces in the tall grass until a wild creature appears, and plays the battle out. */
async function battleInGrass(bot, { map, tiles }, area, index) {
  await until(() => bot.story.messages.length > 0 && bot.progress.length > 0, `${bot.profile.name}'s story`);
  const command = storyBotCommand(storyProgress(bot), STORY_RULES);
  if (command?.starter === undefined) throw new Error(`${bot.profile.name} has no starter to talk for: ${JSON.stringify(command)}`);
  await talkTo(bot, map, tiles, { ...command, starter: STARTERS[index % STARTERS.length] });
  await until(() => bot.progress.at(-1)?.needsStarter === false, `${bot.profile.name} to get a starter`);
  await playBattle(bot, await pace(bot, [{ x: area.x, y: area.y }, { x: area.x + 1, y: area.y }]));
  await until(() => bot.battles.results.length === 1 && mine(bot)?.inBattle === false, `${bot.profile.name}'s battle result`);
  expect(bot.battles.refused.length === 0, `${bot.profile.name} had battle requests refused: ${JSON.stringify(bot.battles.refused)}`);
  return bot.battles.results[0].outcome;
}

// The story bots play the real story by asking core's storyBotCommand what nextGoal wants, as a
// player would, until STORY_QUEST is done; they never follow a list of steps written here.
const WORLD = loadWorld();
const STORY_RULES = { content: WORLD.story, starters: WORLD.starters };
const STORY_QUEST = 'first-round';
const MAX_STORY_COMMANDS = 40;
const WALK_DEADLINE_MS = 30_000;

/** Sends a request after the gap the rate limit needs. */
async function request(bot, type, payload) {
  await sleep(REQUEST_GAP_MS);
  bot.room.send(type, payload);
}

/** The bot's progress as its own messages tell it; storage comes only at shrines, and no bot keeps any. */
function storyProgress(bot) {
  const { team, inventory, lastShrine, seen, befriended } = bot.progress.at(-1);
  return { team, storage: [], inventory, lastShrine, seen, befriended, story: bot.story.messages.at(-1), skills: [], jobs: null };
}

/** The reachable tiles next to `point`, out of the tall grass first. */
function besideTiles(map, tiles, point) {
  const near = tiles.filter((tile) => Math.abs(tile.x - point.x) + Math.abs(tile.y - point.y) === 1);
  return near.toSorted((a, b) => Number(encounterZoneAt(map, a) !== null) - Number(encounterZoneAt(map, b) !== null));
}

/** Skips every move a level up offered, waiting for the progress each answer brings. */
async function answerOffers(bot) {
  const offer = bot.story.offers.shift();
  if (!offer) return;
  const seen = bot.progress.length;
  await request(bot, 'move.choose', { offer: offer.offer, forget: null });
  await until(() => bot.progress.length > seen, `${bot.profile.name}'s progress after a move offer`);
  return answerOffers(bot);
}

/** Plays out the battle that started as number `index`, then any move it offers. */
async function finishBattle(bot, index) {
  await playBattle(bot, bot.battles.started[index].battle);
  await until(() => bot.battles.results.length > index && mine(bot)?.inBattle === false, `${bot.profile.name}'s battle result`);
  await sleep(REQUEST_GAP_MS);
  await answerOffers(bot);
}

/** Walks to `tile`, playing out any wild creature met on the way (and walking on from wherever that leaves the bot). */
async function goTo(bot, tile, tries = 0) {
  if (standsOn(bot, tile)) return;
  if (tries > 10) throw new Error(`${bot.profile.name} could not get to ${tile.x},${tile.y}`);
  const battles = bot.battles.started.length;
  bot.room.send('walk.to', tile);
  await until(() => standsOn(bot, tile) || bot.battles.started.length > battles, `${bot.profile.name} to walk to ${tile.x},${tile.y}`, Date.now() + WALK_DEADLINE_MS);
  if (bot.battles.started.length > battles) await finishBattle(bot, battles);
  return goTo(bot, tile, tries + 1);
}

/** Gives a talk's answers in turn, choosing the starter where a node offers it, then walks away from what is left. */
async function talkThrough(bot, command, node, answers) {
  const ended = () => bot.story.ended.some((end) => end.conversation === node.conversation);
  if (command.starter !== undefined && node.cue === 'offerStarter') {
    await request(bot, 'starter.choose', { species: command.starter });
    await until(ended, `${bot.profile.name}'s talk to end after the starter`);
    return;
  }
  if (ended()) {
    expect(answers.length === 0, `${bot.profile.name}'s talk with ${command.talk} ended with ${answers.length} answers left`);
    return;
  }
  if (answers.length === 0) {
    await request(bot, 'talk.end', { conversation: node.conversation });
    await until(ended, `${bot.profile.name}'s talk to end`);
    return;
  }
  const seen = bot.story.nodes.length;
  await request(bot, 'talk.next', { conversation: node.conversation, choice: answers[0] });
  await until(() => bot.story.nodes.length > seen || ended(), `${bot.profile.name}'s next node`);
  return talkThrough(bot, command, bot.story.nodes.length > seen ? bot.story.nodes.at(-1) : node, answers.slice(1));
}

async function talkTo(bot, map, tiles, command) {
  await goTo(bot, besideTiles(map, tiles, map.npcs[command.talk])[0]);
  const seen = bot.story.nodes.length;
  await request(bot, 'talk.start', { npc: command.talk });
  await until(() => bot.story.nodes.length > seen, `${bot.profile.name}'s talk with ${command.talk} to open`);
  await talkThrough(bot, command, bot.story.nodes.at(-1), command.answers);
}

/** Steps back and forth in `area` until a wild creature appears, and plays the battle out. */
async function battleIn(bot, area) {
  const index = bot.battles.started.length;
  await playBattle(bot, await pace(bot, [{ x: area.x, y: area.y }, { x: area.x + 1, y: area.y }], index));
  await until(() => bot.battles.results.length > index && mine(bot)?.inBattle === false, `${bot.profile.name}'s battle result`);
  await sleep(REQUEST_GAP_MS);
  await answerOffers(bot);
}

/** Makes `event` happen in the world: a mark reached, a shrine rested at or a battle won. */
async function makeHappen(bot, map, tiles, event) {
  if (event.kind === 'reached') {
    const mark = map.marks[event.mark];
    await goTo(bot, tiles.some((tile) => tile.x === mark.x && tile.y === mark.y) ? mark : besideTiles(map, tiles, mark)[0]);
  } else if (event.kind === 'rested') {
    // A rest counts on arriving, so step off the shrine first.
    const shrine = map.shrines[event.shrine];
    await goTo(bot, besideTiles(map, tiles, shrine)[0]);
    await goTo(bot, shrine);
  } else if (event.kind === 'battleWon') {
    await battleIn(bot, map.encounterAreas.find((area) => event.zone === null || area.zone === event.zone));
  } else {
    throw new Error(`the story bot cannot make a "${event.kind}" event happen yet`);
  }
}

/** Plays commands until STORY_QUEST is done, and returns what each was (an npc talked to, or an event). */
async function playStoryBot(bot, map, tiles, played = []) {
  const progress = storyProgress(bot);
  if (progress.story.done.includes(STORY_QUEST)) return played;
  if (played.length >= MAX_STORY_COMMANDS) throw new Error(`${bot.profile.name} played ${played.length} story commands without finishing ${STORY_QUEST}`);
  const command = storyBotCommand(progress, STORY_RULES);
  if (!command) throw new Error(`${bot.profile.name} is stuck at ${JSON.stringify(nextGoal(progress, WORLD.story))}`);
  const stories = bot.story.messages.length;
  await ('talk' in command ? talkTo(bot, map, tiles, command) : makeHappen(bot, map, tiles, command.event));
  // A lost battle changes no story, so this only waits a moment for one that does.
  await poll(() => bot.story.messages.length > stories, { deadline: Date.now() + 2_000 });
  return playStoryBot(bot, map, tiles, [...played, 'talk' in command ? `talk:${command.talk}` : `event:${command.event.kind}`]);
}

/** Plays the story through STORY_QUEST and checks what the server sent for it. */
async function storyRun(bot, map, tiles) {
  await until(() => bot.story.messages.length > 0 && bot.progress.length > 0, `${bot.profile.name}'s story`);
  const played = await playStoryBot(bot, map, tiles);
  const done = bot.story.changes.find((change) => change.quest === STORY_QUEST && change.change === 'done');
  expect(done !== undefined, `${bot.profile.name} got no "done" quest.changed for ${STORY_QUEST}`);
  const rewarded = (done?.rewards?.items ?? []).every((reward) => bot.progress.at(-1).inventory.some((held) => held.item === reward.item && held.count >= reward.count));
  expect(rewarded, `${bot.profile.name}'s bag lacks the rewards of ${STORY_QUEST}`);
  // State patches can come a moment after talk.ended.
  expect(await poll(() => mine(bot)?.talking === false, { deadline: Date.now() + 2_000 }), `${bot.profile.name} still shows the speech mark`);
  expect(bot.battles.refused.length === 0, `${bot.profile.name} had requests refused: ${JSON.stringify(bot.battles.refused)}`);
  return { bot: bot.profile.name, played };
}
/** The courier's job: the first delivery a new player can be given, to the first of its characters. */
function courierJob() {
  const template = [...WORLD.story.skills.templates.values()].find((each) => each.kind === 'deliver' && each.needs.level === 1);
  if (!template) throw new Error('jobs.json has no delivery a new player can be given');
  return { job: 1, template: template.id, item: template.item, count: template.count[0], to: template.to[0], progress: 0 };
}

/**
 * Writes the courier's save while no server runs: a creature, every quest done (so its character's
 * first dialogue entry that holds is the delivery), a board holding only `job`, and the items for
 * it, which only gathering could give otherwise.
 */
function seedCourier(profile, job, at) {
  const db = openDatabase(join(dataDir, DATABASE_FILE));
  try {
    const store = createProgressStore({ db, now: Date.now, repair: (_id, data) => data });
    const progress = {
      ...emptyProgress(),
      team: [newCreature(STARTERS[0], 5, WORLD.battle)],
      inventory: [{ item: job.item, count: job.count }],
      story: { active: [], done: [...WORLD.story.quests.keys()], flags: [] },
      jobs: { seed: 1, drawn: job.job, done: 0, board: [job] },
    };
    store.save(profile.id, createSave({ name: profile.name, language: 'en', createdAt: new Date().toISOString(), position: { map: WORLD.map.id, ...at, facing: 'down' }, ...progress }));
  } finally {
    db.close();
  }
}

/** Opens the job board if the map places one, then delivers `job` to its character and checks what the server sent. */
async function courierRun(bot, map, tiles, job) {
  const name = bot.profile.name;
  await until(() => bot.jobs.boards.length > 0, `${name}'s board on joining`);
  expect(bot.jobs.boards[0].board.map((each) => each.job).join() === String(job.job), `${name} joined with the board ${JSON.stringify(bot.jobs.boards[0])}`);
  const board = Object.entries(map.stations).find(([id]) => WORLD.story.skills.stations.get(id)?.kind === 'jobBoard');
  let opened = 'the map places no job board yet';
  if (board) {
    await goTo(bot, besideTiles(map, tiles, board[1])[0]);
    const seen = bot.jobs.boards.length;
    await request(bot, 'board.open', { station: board[0] });
    await until(() => bot.jobs.boards.length > seen, `${name}'s board to open`);
    const shown = bot.jobs.boards.at(-1).board;
    expect(shown.length === WORLD.story.skills.slots && shown[0]?.job === job.job, `${name}'s opened board is ${JSON.stringify(shown)}`);
    opened = `opened ${board[0]}: ${shown.map((each) => each.template).join(', ')}`;
  }
  await goTo(bot, besideTiles(map, tiles, map.npcs[job.to])[0]);
  const nodes = bot.story.nodes.length;
  await request(bot, 'talk.start', { npc: job.to });
  await until(() => bot.story.nodes.length > nodes, `${name}'s talk with ${job.to} to open`);
  const node = bot.story.nodes.at(-1);
  const done = bot.jobs.changes.find((change) => change.job === job.job && change.change === 'done');
  expect(done?.next != null, `${name} got no "done" job.changed with a next job: ${JSON.stringify(bot.jobs.changes)}`);
  expect(!bot.jobs.boards.at(-1).board.some((each) => each.job === job.job), `${name}'s delivered job is still on the board`);
  expect(!bot.progress.at(-1).inventory.some((held) => held.item === job.item), `${name} still carries ${job.item}`);
  await request(bot, 'talk.end', { conversation: node.conversation });
  await until(() => bot.story.ended.some((end) => end.conversation === node.conversation), `${name}'s talk to end`);
  expect(bot.battles.refused.length === 0, `${name} had requests refused: ${JSON.stringify(bot.battles.refused)}`);
  return { bot: name, opened, delivered: `${job.count} ${job.item} to ${job.to}`, next: done?.next?.template ?? null };
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
const battles = [];
const stories = [];
let courier = null;
let tally = null;

try {
  const first = await startServer({ env: { NODE_ENV: 'test', DATA_DIR: dataDir }, logFile: join(out, 'logs', 'bot-run-server.log') });
  servers.push(first);
  await inTurn(PROFILES, async (profile) => {
    profile.id = (await api(first.base, 'POST', '/api/profiles', profile)).id;
  });
  const listed = await api(first.base, 'GET', '/api/profiles');
  expect(listed.length === PROFILES.length && listed.every((row) => !('pin' in row)), 'the profile list is wrong or shows a PIN');
  COURIER.id = (await api(first.base, 'POST', '/api/profiles', COURIER)).id;

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
  const job = courierJob();
  seedCourier(COURIER, job, besideTiles(map, tiles, map.npcs[job.to])[0]);

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

  const fighters = back.slice(0, 2);
  const meadow = map.encounterAreas[0];
  const outcomes = await Promise.all(fighters.map((bot, index) => battleInGrass(bot, { map, tiles }, meadow, index)));
  battles.push(...outcomes.map((outcome) => outcome.reason));
  step(`two bots got a starter from its character, met wild creatures in the grass at once and finished their battles: ${battles.join(', ')}`);
  const courierBot = await joinWorld(second.base, COURIER, (await login(second.base, COURIER)).token);
  const [played, delivered] = await Promise.all([Promise.all(back.slice(2).map((bot) => storyRun(bot, map, tiles))), courierRun(courierBot, map, tiles, job)]);
  stories.push(...played);
  courier = delivered;
  for (const story of stories) step(`${story.bot} played the story through ${STORY_QUEST}: ${story.played.join(', ')}`);
  step(`${courier.bot} ${courier.opened}; delivered ${courier.delivered}, and ${courier.next} took its place`);
  const everyone = [...back, courierBot];
  await Promise.all(everyone.map((bot) => bot.room.leave()));
  await until(() => second.lines.filter((line) => line.msg === 'player left').length === everyone.length, 'the restarted server to log every leave');
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
  battles,
  stories,
  courier,
  sampledPositions: tally?.samples ?? 0,
  blockedPositions: tally?.blocked ?? 0,
  positionsChecked: Object.keys(positions).length,
  events: servers.map(eventCounts),
  failures,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(summary.ok ? 0 : 1);
