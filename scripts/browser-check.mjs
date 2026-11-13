// Level 4 browser check: starts the real production server serving apps/game/dist, then plays the
// page in headless Chromium and WebKit on an iPhone (portrait) and an iPad (landscape) in both
// languages, the way a player would: make a player with a PIN on the number pad, enter the world
// and see the map and their courier, watch a bot walk past (named, smooth) and drop (away), tap a
// far tile with a real touch and arrive, walk with arrows, WASD and the joystick, reload
// and come straight back, switch player, get the PIN wrong, then right. A new player takes the
// hint to the character who gives the starters, taps them and talks until they offer them, and
// takes the first; walks keep out of the tall grass, and each device run also walks into the grass
// until a wild creature appears on the real server, attacks once and runs. Once on each device in
// each language it also takes a quest by talking (a choice) and delivers its note to the
// character marked for it. A wild battle met where none was meant is run from and noted, not failed. Every device run
// then signs in as a player whose save the check prepared in its own server's database
// (scripts/lib/battle-check.mjs): their worn-out team faints and wakes at the shrine, a wild
// creature is befriended onto the team, the team screen shows it, and storage at the shrine takes
// one along and leaves one there. Four device runs (each device in each language, the browsers
// sharing them) then sign in as a player whose save has a quest at a step done by resting at a
// shrine (scripts/lib/story-check.mjs): they open the bag and the journal, ask "Where next?", walk
// to the shrine for the quest toast and see the journal move on. Four more (the other language on
// each device) sign in beside a fishing spot (scripts/lib/skill-check.mjs): they fish, see the catch
// and a full stack toasted, are told the spot rests, miss and then win a foraging game, cook from
// the recipe book and read the Skills tab; at 360px a player opens the book, a game and the tab. The
// same four then sign in beside the job board (scripts/lib/board-check.mjs): they read its three
// cards, hand a delivery over in a talk, see the job toast and find the new card in its place; at
// 360px a player opens the board for the first time. At 360px wide it also checks the lock messages (a first and a
// second lock), the PIN hint and a full profile list, and adds a PIN to a profile made without one
// from the settings, then signs in with it and meets a wild creature. Against its own server, a
// player saved one point short of a level up wins a wild battle at 360px and answers the offer of
// a new move (scripts/lib/learn-check.mjs), opening the bag and the journal on the way. Fails on any console
// error, page error, failed or outside request, a missing connection, a language toggle that does
// not change the text, small touch targets, or sideways scrolling at 360px wide.
//   node scripts/browser-check.mjs [--out <dir>] [--url <base>] [--part <name>]
// With --url it plays a game that is already running there (the container check) instead. With
// --part it plays one part of scripts/lib/browser-check-parts.mjs, as each level 4 verify step
// does; without it, every part in turn on one server.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@colyseus/sdk';
import { MAX_PROFILES, PIN_LOCK_MS, PLAYER_SPAWN, PROTOCOL_VERSION, SERVER_MESSAGES, isWalkable } from '../packages/core/src/index.ts';
import {
  BROWSERS,
  DEVICES,
  HOOK,
  apiCall,
  battleIdle,
  clearWalk,
  enterPin,
  enterWorld,
  hurryThrough,
  inGrass,
  inWorld,
  leaveBattle,
  meetWildCreature,
  nextFrames,
  openTalk,
  presetLanguage,
  readState,
  reportCspViolations,
  screenshot,
  selfIn,
  servedMap,
  settledOn,
  signOut,
  startsQuest,
  talkThrough,
  tappable,
  testBase,
  tilesToScreen,
  until,
  untilPastBattles,
  untilTappingThrough,
  walkByTaps,
  watch,
} from './lib/game-page.mjs';
import { battleSave, chooseStarter, playBattles } from './lib/battle-check.mjs';
import { learnerSave, playLearning } from './lib/learn-check.mjs';
import { playStory, storySave, storyScreensFit } from './lib/story-check.mjs';
import { playSkills, skillScreensFit } from './lib/skill-check.mjs';
import { boardSave, skillSave } from './lib/skill-saves.mjs';
import { boardScreenFits, playBoard } from './lib/board-check.mjs';
import { inTurn, poll, sleep } from './lib/in-turn.mjs';
import { deleteProfile, prepareSave } from './lib/prepared-saves.mjs';
import { ROOT, startServer } from './lib/server-process.mjs';
import { BROWSER_CHECK_PARTS } from './lib/browser-check-parts.mjs';
import { battlerName, boardName, botName, deviceName, learnerName, lockedName, pinlessName, runTag, skillerName, storyName } from './lib/test-players.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' }, url: { type: 'string' }, part: { type: 'string' } } });
const parts = values.part === undefined ? BROWSER_CHECK_PARTS : BROWSER_CHECK_PARTS.filter((part) => part.name === values.part);
if (parts.length === 0) {
  console.error(`browser-check: --part must be one of ${BROWSER_CHECK_PARTS.map((part) => part.name).join(', ')}, got "${values.part}"`);
  process.exit(2);
}
const logName = values.part === undefined ? 'browser-check' : `browser-check-${values.part}`;
let given = null;
if (values.url) {
  try {
    given = testBase(values.url);
  } catch (error) {
    console.error(`browser-check: ${error.message}`);
    process.exit(1);
  }
}
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
const LANGUAGES = ['en', 'sl'];
const other = (language) => (language === 'en' ? 'sl' : 'en');
const PIN = '2580';
const WRONG_PIN = '1111';

// A server of our own keeps its database in a temporary folder, removed at the end.
const dataDir = values.url ? null : mkdtempSync(join(tmpdir(), 'nebotok-browser-check-'));
const server = given
  ? { base: given, external: true }
  : await startServer({ env: { NODE_ENV: 'production', DATA_DIR: dataDir }, logFile: join(out, 'logs', `${logName}-server.log`) });
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

const api = (path, { body, address } = {}) => apiCall(server.base, path, { body, headers: asDevice(address) });

// Invented names of letters only, with Slovenian letters in the Slovenian runs. A server given by
// --url keeps the players of earlier checks, so this check's names carry a tag of its own.
const TAG = runTag();

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

/** A lock message as the page words it for a wait of `timeId` (a `profile.time.*` string), with `{n}` filled in. */
const lockText = (id, language, timeId, n) => STRINGS[id][language].replace('{time}', STRINGS[timeId][language].replace('{n}', String(n)));

// A bot of our own (a plain SDK client) walks past each page's courier, so the check can see that
// another player is drawn, named, walks smoothly and turns away when it drops.
const BOT = { name: botName(TAG), avatar: 'red' };
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
  return { token: login.data.token, fresh: true, ...(await servedMap(server.base, START_MAP)) };
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
  // The bot only walks, so it ignores every message about itself, storage when it passes the shrine
  // and a battle or move offer included, rather than have the SDK warn about each.
  for (const type of Object.values(SERVER_MESSAGES)) room.onMessage(type, () => {});
  return room;
}

const botIn = (state) => state.players.find((player) => player.name === BOT.name);
const apart = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const standsOn = (player, tile) => player?.x === tile.x && player.y === tile.y && !player.moving && player.drawn.x === tile.x && player.drawn.y === tile.y;

const OFFSETS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

// A short hold walks about three tiles; the tiles this far ahead must be free of tall grass.
const HOLD_REACH = 5;

/** A direction with two free tiles ahead and no tall grass within a short hold, so a hold is sure to move and meets no wild creature. */
function openDirection(bot, from, not = []) {
  const free = (tile) => isWalkable(bot.map, tile) && bot.reach[tile.y * bot.map.width + tile.x];
  const ahead = ([dx, dy], n) => ({ x: from.x + n * dx, y: from.y + n * dy });
  const reached = (offset) => {
    const tiles = [];
    for (let n = 1; n <= HOLD_REACH && isWalkable(bot.map, ahead(offset, n)); n += 1) tiles.push(ahead(offset, n));
    return tiles;
  };
  const open = (offset) => free(ahead(offset, 1)) && free(ahead(offset, 2)) && !reached(offset).some((tile) => inGrass(bot, tile));
  const found = Object.entries(OFFSETS).find(([name, offset]) => !not.includes(name) && open(offset));
  if (!found) throw new Error(`no open direction from ${from.x},${from.y}`);
  return found[0];
}
const movedToward = (from, to, direction) => {
  const [dx, dy] = OFFSETS[direction];
  return (to.x - from.x) * dx + (to.y - from.y) * dy >= 1 && (dx === 0 ? to.x === from.x : to.y === from.y);
};

/** The reachable tile on screen, clear of the corners and the tall grass, furthest from `from` along a walk that keeps out of the grass. */
async function farTile(page, bot, from) {
  const tiles = bot.reach.flatMap((ok, at) => (ok ? [{ x: at % bot.map.width, y: Math.floor(at / bot.map.width) }] : [])).filter((tile) => !inGrass(bot, tile));
  const spots = await tilesToScreen(page, tiles);
  return (
    tiles
      .map((tile, index) => ({ tile, spot: spots[index], far: Math.abs(tile.x - from.x) + Math.abs(tile.y - from.y) }))
      .filter(({ spot }) => tappable(page, spot))
      .toSorted((a, b) => b.far - a.far)
      .find(({ tile }) => clearWalk(bot, from, tile)) ?? null
  );
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
async function moveAround(page, browserName, bot, language, { expect, shot, notes }) {
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
  state = await until(page, (s) => s.screen === 'battle' || (settledOn(s, far.tile) && s.marker === null), `arrival at the tapped tile ${far.tile.x},${far.tile.y}`, far.far * 400 + 5_000);
  if (state.screen === 'battle') {
    notes.push(`ran from a wild battle that started on the way to the tapped tile ${far.tile.x},${far.tile.y}`);
    await leaveBattle(page);
    state = await walkByTaps(page, bot, far.tile, { notes });
  }

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
    state = await untilPastBattles(page, (s) => settledOn(s), `the courier to stop after holding ${keys[direction]}`, notes, 5_000);
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
  state = await untilPastBattles(page, (s) => s.input.joystick === null && settledOn(s), 'the courier to stop when the thumb lifts', notes, 5_000);
  expect(movedToward(from, selfIn(state), direction), `the joystick moved the courier from ${from.x},${from.y} to ${selfIn(state).x},${selfIn(state).y}, not ${direction}`);
  expect(!(await page.locator('.joystick').isVisible()), 'the joystick stays after the thumb lifts');

  // Back to taps, since a tap on the left half drives the joystick instead of walking.
  await page.locator('.settings-button').tap();
  await page.locator('.controls').tap();
  await until(page, (s) => s.controls === 'tap', 'tap controls again');
  await page.locator('.settings-button').tap();
  await until(page, (s) => !s.settingsOpen, 'the settings to close');
}

// A quest is taken and delivered once on each device in each language, the two browsers sharing
// the four runs, so the whole check keeps inside its time.
const questRun = (browserName, device, language) => (BROWSERS.findIndex((browser) => browser.name === browserName) + DEVICES.indexOf(device) + LANGUAGES.indexOf(language)) % 2 === 0;
const QUEST_ITEMS = new Set(JSON.parse(readFileSync(join(ROOT, 'content/items.json'), 'utf8')).items.filter((item) => item.kind === 'quest').map((item) => item.id));
const questItems = (state) => (state.progress?.inventory ?? []).filter((entry) => QUEST_ITEMS.has(entry.item)).reduce((sum, entry) => sum + entry.count, 0);

/**
 * With a talk's choices up: a tap on the map above the talk box leaves the talk where it is, and,
 * where Tab moves between buttons (Chromium), the first Tab lands on the first choice, not on close.
 */
async function talkIgnoresMapAndTabsToChoice(page, talk, { expect, tabs }) {
  const box = await page.locator('#talk .talk-box').boundingBox();
  if (box && box.y > 40) {
    await page.touchscreen.tap(box.x + box.width / 2, box.y - 20);
    await nextFrames(page);
    const after = await readState(page);
    expect(after.talk?.conversation === talk.conversation && after.talk.node === talk.node, `a tap on the map above the talk box moved the talk from ${talk.node} to ${after.talk?.node ?? 'its end'}`);
  }
  if (!tabs) return;
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => {
    const at = document.activeElement;
    return { first: at === document.querySelector('#talk .talk-choice'), className: at?.className ?? null };
  });
  expect(focused.first, `the first Tab in the talk box focused ${focused.className}, not the first choice`);
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : undefined));
}

/**
 * A quest by talking, against the real server: the character marked with a new quest is tapped,
 * their choices show and the one that takes the quest is tapped; the quest item they give is
 * carried to the character marked to take it, who takes it in a talk tapped through 8 times a
 * second, and their mark goes.
 */
async function questTalk(page, bot, { expect, check, notes, tabs }) {
  const offered = await until(page, (s) => settledOn(s) && s.talk === null && s.npcs.some((npc) => npc.mark === 'newQuest'), 'a character with a quest to give');
  const giver = offered.npcs.find((npc) => npc.mark === 'newQuest').id;
  await openTalk(page, bot, giver, { notes });
  let choices = 0;
  const seenChoices = async (s) => {
    if (choices > 0 || s.talk.choices.length === 0) return;
    choices = s.talk.choices.length;
    expect((await page.locator('#talk .talk-choice:visible').count()) === choices, `the talk box shows ${await page.locator('#talk .talk-choice:visible').count()} choices, not the ${choices} the talk has`);
    await check('choices in the talk box', 't1-choices');
    await talkIgnoresMapAndTabsToChoice(page, s.talk, { expect, tabs });
  };
  await talkThrough(page, { toward: startsQuest, seen: seenChoices });
  expect(choices > 0, `${giver} gave a quest without a choice to take it`);
  const carrying = await until(page, (s) => s.talk === null && s.npcs.some((npc) => npc.mark === 'turnIn'), `a character to take ${giver}'s quest to`);
  const to = carrying.npcs.find((npc) => npc.mark === 'turnIn').id;
  expect(questItems(carrying) > questItems(offered), `${giver}'s quest gave no quest item to deliver: ${JSON.stringify(carrying.progress?.inventory)}`);
  await openTalk(page, bot, to, { notes });
  await until(page, (s) => s.talk === null || (s.talk.typed && !s.talk.waiting), `${to}'s first line`);
  await nextFrames(page);
  await check('handing a delivery over', 't2-deliver');
  await hurryThrough(page);
  const after = await until(page, (s) => s.talk === null && s.npcs.find((npc) => npc.id === to)?.mark !== 'turnIn', `${to} to take the delivery`);
  expect(questItems(after) < questItems(carrying), `${to} took nothing: the bag still holds ${JSON.stringify(after.progress?.inventory)}`);
}
/** Runs once the first turn is played, unless that turn ended the battle; returns the state on the result. */
async function runAfterTurn(page, state, expect) {
  if (state.battle.panel === 'result') return state;
  expect(state.battle.panel === 'menu' && state.battle.menu.run, `after one turn the wild battle shows ${state.battle.panel} with ${JSON.stringify(state.battle.menu)}, no way to run`);
  if (!(state.battle.panel === 'menu' && state.battle.menu.run)) return null;
  await nextFrames(page);
  await page.locator('#battle .battle-run').tap();
  return untilTappingThrough(page, (s) => battleIdle(s) && s.battle.panel === 'result', 'the result after running', 15_000);
}

/**
 * Against the real server: walks into the tall grass nearest the spawn and steps about until a wild
 * creature appears, attacks once with the starter, runs, and walks back to the spawn.
 */
async function wildBattle(page, bot, { expect, check, notes }) {
  await meetWildCreature(page, bot, { notes });
  await untilTappingThrough(page, battleIdle, 'the wild battle to offer a choice', 15_000);
  await nextFrames(page);
  const { battle, progress } = await readState(page);
  const fighter = battle.team[battle.active];
  expect(fighter?.species === progress?.team[0]?.species, `the wild battle sent out ${fighter?.species}, not the starter ${progress?.team[0]?.species}`);
  expect(battle.drawn?.creatures[0] === fighter?.species && battle.drawn?.creatures[1] === battle.opponent?.species, `the field drew ${JSON.stringify(battle.drawn)}, not the creatures out`);
  expect(battle.menu.moves.length > 0 && (await page.locator('#battle .move').count()) === battle.menu.moves.length, `the wild battle offers ${JSON.stringify(battle.menu)}`);
  await check('the wild battle', '11-wild-battle');
  await page.locator('#battle .move').first().tap();
  const turned = await untilTappingThrough(page, (s) => battleIdle(s) && (s.battle.turn > battle.turn || s.battle.panel === 'result'), 'the first turn against the wild creature', 15_000);
  const ended = await runAfterTurn(page, turned, expect);
  if (!ended) {
    await leaveBattle(page);
    return;
  }
  expect(ended.battle.outcome !== null, 'the wild battle shows a result without an outcome');
  await nextFrames(page);
  await check('the wild battle result', '12-wild-result');
  await page.locator('#battle .battle-continue').tap();
  const back = await until(page, (s) => s.screen === 'world' && s.battle === null && s.progress !== null, 'the world after the wild battle');
  expect(back.progress.team.length >= 1, 'the team is empty after the wild battle');
  await walkByTaps(page, bot, bot.map.spawns[PLAYER_SPAWN], { notes });
}

/**
 * At a shrine with only the starter, the team screen never offers to leave it there (the server
 * refuses, core `swapStorage`) and says it stays with you instead.
 */
async function keepOne(page, bot, { language, expect, check, notes }) {
  const shrine = Object.keys(bot.map.shrines).toSorted()[0];
  await walkByTaps(page, bot, bot.map.shrines[shrine], { notes });
  await until(page, (s) => s.storage?.shrine === shrine, `the storage of ${shrine} after resting there`);
  await page.locator('.team-button').tap();
  const opened = await until(page, (s) => s.screen === 'team' && s.teamScreen !== null, 'the team screen');
  await until(page, (s) => s.toast === null, 'the toast about resting to go', 6_000);
  await nextFrames(page);
  expect(opened.progress?.team.length === 1, `the new player has ${opened.progress?.team.length} creatures, not just the starter`);
  expect((await page.locator('#team .team-store').count()) === 0, 'the team screen offers to leave the only creature at the shrine');
  expect((await textOf(page, '#team .team-keep')) === STRINGS['storage.keepOne'][language], `the team screen says "${await textOf(page, '#team .team-keep')}" about the only creature`);
  await check('the team screen with one creature at a shrine', 'b5-team');
}

/**
 * Makes a player over the API and prepares their save in our own server's database
 * (battleSave), then signs in as them from the profile list the page shows next. A server given
 * by --url keeps its database to itself, so there the battles are skipped and noted.
 */
async function prepareBattler(browserName, device, language, bot) {
  if (!dataDir) return null;
  const name = battlerName(browserName, device.name, language, TAG);
  const made = await api('/profiles', { body: { name, avatar: 'yellow' }, address: nextAddress() });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  const { shrine, data } = battleSave(bot, { name, language });
  prepareSave(dataDir, made.data.id, data);
  return { id: made.data.id, name, shrine };
}

/** From the profile list: signs in as the prepared player, plays the battles, signs out, and deletes the player. */
async function preparedBattles(page, battler, { language, expect, check, notes }) {
  try {
    await page.locator(`.profile-card[data-profile-id="${battler.id}"]`).tap();
    const state = await enterWorld(page, bot, inWorld, 'the world as the prepared player', { notes });
    expect(state.profile?.name === battler.name, `signed in as ${state.profile?.name}, not ${battler.name}`);
    await playBattles(page, bot, { shrine: battler.shrine, language, strings: STRINGS, expect, check, notes });
    await signOut(page);
  } finally {
    deleteProfile(dataDir, battler.id);
  }
}

/** The device runs that play the story part: each device in each language, with the browsers taking turns. */
const STORY_RUNS = new Set(['chromium-iphone-portrait-en', 'chromium-ipad-landscape-sl', 'webkit-iphone-portrait-sl', 'webkit-ipad-landscape-en']);

/** Like prepareBattler, for the story part (storySave). */
async function prepareStoryPlayer(browserName, device, language, bot) {
  if (!dataDir) return null;
  const name = storyName(browserName, device.name, language, TAG);
  const made = await api('/profiles', { body: { name, avatar: 'blue' }, address: nextAddress() });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  const { plan, data } = storySave(bot, { name, language });
  prepareSave(dataDir, made.data.id, data);
  return { id: made.data.id, name, plan };
}

/** From the profile list: signs in as the story player, plays the story part, signs out, and deletes the player. */
async function preparedStory(page, player, { language, expect, check, notes }) {
  try {
    await page.locator(`.profile-card[data-profile-id="${player.id}"]`).tap();
    const state = await enterWorld(page, bot, inWorld, 'the world as the story player', { notes });
    expect(state.profile?.name === player.name, `signed in as ${state.profile?.name}, not ${player.name}`);
    await playStory(page, bot, player.plan, { language, strings: STRINGS, expect, check, notes });
    await signOut(page);
  } finally {
    deleteProfile(dataDir, player.id);
  }
}

/** The device runs that play the skill part: each device in each language, the other way round from the story part. */
const SKILL_RUNS = new Set(['chromium-iphone-portrait-sl', 'chromium-ipad-landscape-en', 'webkit-iphone-portrait-en', 'webkit-ipad-landscape-sl']);

/** Like prepareBattler, for the skill part (skillSave): a player beside the gathering spots, standing at `where`. */
async function prepareSkillPlayer(browserName, device, language, bot, where = 'fish') {
  if (!dataDir) return null;
  const name = skillerName(browserName, device, language, TAG);
  const made = await api('/profiles', { body: { name, avatar: 'purple' }, address: nextAddress() });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  const { plan, data } = skillSave(bot, { name, language, where });
  prepareSave(dataDir, made.data.id, data);
  return { id: made.data.id, name, plan };
}

/** From the profile list: signs in as the skill player, plays the skill part, signs out, and deletes the player. */
async function preparedSkills(page, player, { language, expect, check, notes }) {
  try {
    await page.locator(`.profile-card[data-profile-id="${player.id}"]`).tap();
    const state = await enterWorld(page, bot, inWorld, 'the world as the skill player', { notes });
    expect(state.profile?.name === player.name, `signed in as ${state.profile?.name}, not ${player.name}`);
    await playSkills(page, bot, player.plan, { language, strings: STRINGS, expect, check, notes });
    await signOut(page);
  } finally {
    deleteProfile(dataDir, player.id);
  }
}

/** Like prepareSkillPlayer, for the board part (boardSave): beside the job board, with it `opened` and a delivery ready, or never opened. */
async function prepareBoardPlayer(browserName, device, language, bot, opened = true) {
  if (!dataDir) return null;
  const name = boardName(browserName, device, language, TAG);
  const made = await api('/profiles', { body: { name, avatar: 'orange' }, address: nextAddress() });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  const { plan, data } = boardSave(bot, { name, language, opened });
  prepareSave(dataDir, made.data.id, data);
  return { id: made.data.id, name, plan };
}

/** From the profile list: signs in as the board player, plays the board part, signs out, and deletes the player. */
async function preparedBoard(page, player, { language, expect, check, notes }) {
  try {
    await page.locator(`.profile-card[data-profile-id="${player.id}"]`).tap();
    const state = await enterWorld(page, bot, inWorld, 'the world as the board player', { notes });
    expect(state.profile?.name === player.name, `signed in as ${state.profile?.name}, not ${player.name}`);
    await playBoard(page, bot, player.plan, { language, strings: STRINGS, expect, check, notes });
    await signOut(page);
  } finally {
    deleteProfile(dataDir, player.id);
  }
}

/** The bot joins, walks past the page's courier while the page is sampled, then drops. */
async function meetBot(bot, page, self, { expect, shot }) {
  const room = await joinBot(bot);
  try {
    const landed = botIn(await until(page, (s) => botIn(s)?.connected === true, 'the page to see the bot'));
    // The first run's courier is new and alone. The bot, new too, arrives on the spawn, or on a
    // free tile beside it when the courier stands there.
    if (bot.fresh) {
      bot.fresh = false;
      const spawn = bot.map.spawns[PLAYER_SPAWN];
      const wanted = apart(self, spawn) === 0 ? 'a free tile beside the courier on the spawn' : 'the free spawn';
      expect(apart(self, spawn) === 0 ? apart(landed, self) === 1 : apart(landed, spawn) === 0, `a new player arrived on ${landed.x},${landed.y}, not on ${wanted} at ${spawn.x},${spawn.y}`);
    }
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
  const name = deviceName(browserName, device.name, language, TAG);
  const problems = [];
  const screenshots = [];
  const notes = [];
  const expect = (ok, message) => {
    if (!ok) problems.push(message);
  };
  let wrongPinExpected = false;
  await spaceRuns();
  const context = await browser.newContext({ ...device.descriptor, serviceWorkers: 'allow', extraHTTPHeaders: asDevice(nextAddress()) });
  await context.addInitScript(presetLanguage, language);
  await context.addInitScript(reportCspViolations);
  const page = await context.newPage();
  watch(context, page, problems, { allowedHost, expectStatus: () => wrongPinExpected });
  const shot = async (step) => {
    const path = join(shots, `${label}-${step}.png`);
    await screenshot(page, path);
    screenshots.push(path);
  };
  const targets = async (where) => {
    for (const target of await smallTargets(page)) problems.push(`${where}: touch target under ${MIN_TARGET_PX}px: ${target}`);
  };
  const check = async (where, step) => {
    await targets(where);
    await shot(step);
  };
  const say = (id) => STRINGS[id][language];
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
    await chooseStarter(page, bot, { say, expect, check, notes });
    state = await enterWorld(page, bot, inWorld, 'the world after making a player', { notes });
    expect(state.profile?.name === name, `signed in as ${state.profile?.name}, not ${name}`);
    expect(state.playerCount >= 1, `player count is ${state.playerCount}`);
    expect(state.protocol === PROTOCOL_VERSION, `protocol is ${state.protocol}`);
    expect(state.scene === 'world', `scene is ${state.scene}`);
    expect(state.map === START_MAP, `the map drawn is ${state.map}, not ${START_MAP}`);
    const self = state.players.find((player) => player.self);
    expect(self?.name === name && self.avatar === 'green', `the page's own courier is ${JSON.stringify(self)}`);
    const [selfSpot] = self ? await tilesToScreen(page, [self]) : [null];
    const viewport = page.viewportSize();
    expect(selfSpot && selfSpot.x > 0 && selfSpot.y > 0 && selfSpot.x < viewport.width && selfSpot.y < viewport.height, `the page's own courier is off screen at ${JSON.stringify(selfSpot)}`);
    expect((await textOf(page, '.badge-text')) === STRINGS['connection.connected'][language], 'the badge does not say connected');
    await targets('world');
    await shot('4-world');
    if (self) await meetBot(bot, page, self, { expect, shot });
    if (self) await moveAround(page, browserName, bot, language, { expect, shot, notes });
    if (self) await wildBattle(page, bot, { expect, check, notes });
    if (self && questRun(browserName, device, language)) await questTalk(page, bot, { expect, check, notes, tabs: browserName === 'chromium' });

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
    // Made before signing out, so the profile list the page shows next has the prepared player on it.
    const battler = await prepareBattler(browserName, device, language, bot);
    const storyPlayer = STORY_RUNS.has(label) ? await prepareStoryPlayer(browserName, device, language, bot) : null;
    const skillPlayer = SKILL_RUNS.has(label) ? await prepareSkillPlayer(browserName, device.name, language, bot) : null;
    const boardPlayer = SKILL_RUNS.has(label) ? await prepareBoardPlayer(browserName, device.name, language, bot) : null;
    // Sign out, so this run's courier does not stand on the spawn, away, through the runs after it.
    await signOut(page);
    if (battler) await preparedBattles(page, battler, { language, expect, check, notes });
    else notes.push('the battles from a prepared save need the database of a server the check started, so they were skipped');
    if (storyPlayer) await preparedStory(page, storyPlayer, { language, expect, check, notes });
    else if (STORY_RUNS.has(label) && !dataDir) notes.push('the story part needs a prepared save, so it was skipped');
    if (skillPlayer) await preparedSkills(page, skillPlayer, { language, expect, check, notes });
    else if (SKILL_RUNS.has(label) && !dataDir) notes.push('the skill part needs a prepared save, so it was skipped');
    if (boardPlayer) await preparedBoard(page, boardPlayer, { language, expect, check, notes });
    results.push({ label, ok: problems.length === 0, serviceWorkerReload: hasWorker, state, problems, notes, screenshots });
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
    results.push({ label, ok: false, state, problems, notes, screenshots });
  } finally {
    await context.close();
  }
}

async function pinnedProfile(name) {
  const made = await api('/profiles', { body: { name, avatar: 'orange', pin: '1357' }, address: nextAddress() });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  return made.data.id;
}

/** Five wrong PINs in a row, from an address of their own: what locks a profile. */
function lockOut(profileId) {
  const address = nextAddress();
  return inTurn([1, 2, 3, 4, 5], () => api('/sessions', { body: { profileId, pin: '0000' }, address }));
}

/** A profile locked by five wrong PINs, made over the API, so the 360px runs can show the locked state. */
async function lockedProfile(browserName) {
  const id = await pinnedProfile(lockedName('Zaklep', browserName, TAG));
  await lockOut(id);
  return id;
}

/**
 * A profile locked now, and the step that locks it again once that first lock is over: the second
 * lock lasts two minutes, which the 360px runs must word as two minutes, not one.
 */
async function lockedTwiceLater(browserName) {
  const id = await pinnedProfile(lockedName('Dvakrat', browserName, TAG));
  await lockOut(id);
  const firstOver = Date.now() + PIN_LOCK_MS + 1_000;
  return async () => {
    await sleep(Math.max(0, firstOver - Date.now()));
    await lockOut(id);
    return id;
  };
}

async function narrowPage(browser, browserName, label, language, problems, screenshots) {
  await spaceRuns();
  const context = await browser.newContext({ viewport: NARROW, hasTouch: true, isMobile: browserName === 'chromium', extraHTTPHeaders: asDevice(nextAddress()) });
  await context.addInitScript(presetLanguage, language);
  await context.addInitScript(reportCspViolations);
  const page = await context.newPage();
  watch(context, page, problems, { allowedHost });
  const shot = async (step) => {
    const path = join(shots, `${label}-${step}.png`);
    await screenshot(page, path);
    screenshots.push(path);
  };
  const noSideways = async (where) => {
    const { scrollWidth, width } = await sideways(page);
    if (scrollWidth > width) problems.push(`${where} scrolls sideways at 360px: content is ${scrollWidth}px in ${width}px`);
  };
  return { context, page, shot, noSideways };
}

/** Taps a locked profile and checks its tag and the message both say the wait `timeId` words. */
async function checkLockShown(page, { id, language, timeId, n, what, problems }) {
  const card = page.locator(`.profile-card[data-profile-id="${id}"]`);
  const tagSays = (await card.locator('.tag.locked').textContent())?.trim();
  const tagWanted = lockText('profile.locked', language, timeId, n);
  if (tagSays !== tagWanted) problems.push(`${what}: the card says "${tagSays}", not "${tagWanted}"`);
  await card.tap();
  const wanted = lockText('profile.error.locked', language, timeId, n);
  const said = await poll(async () => {
    const shown = await textOf(page, '#profiles .notice');
    return shown === wanted ? shown : null;
  }, { deadline: Date.now() + 5_000, intervalMs: 100 });
  if (said !== wanted) problems.push(`${what}: the message says "${await textOf(page, '#profiles .notice')}", not "${wanted}"`);
  await page.locator('#profiles .notice').scrollIntoViewIfNeeded();
}

async function checkNarrow(browser, browserName, language, { lockedId, twiceId }) {
  const label = `${browserName}-360px-${language}`;
  const problems = [];
  const screenshots = [];
  const { context, page, shot, noSideways } = await narrowPage(browser, browserName, label, language, problems, screenshots);
  try {
    await page.goto(`${server.base}/?test=1`);
    const state = await until(page, (s) => s.screen === 'profiles', 'the profile list');
    await noSideways('the profile list');
    // The bot has no PIN, so the list shows the gentle PIN hint and the outline lock on its card.
    if ((await textOf(page, '.pin-nudge')) !== STRINGS['profile.pinNudge'][language]) problems.push('the PIN hint is missing or has the wrong text');
    if ((await page.locator('.tag.no-pin').count()) === 0) problems.push('no card shows the outline lock of a profile without a PIN');
    await shot('profiles');
    if (lockedId !== null) {
      const locked = state.profiles.find((profile) => profile.id === lockedId);
      if (!locked?.locked) problems.push(`the profile locked by wrong PINs is not shown locked: ${JSON.stringify(locked)}`);
      await checkLockShown(page, { id: lockedId, language, timeId: 'profile.time.minute', n: 1, what: 'the first lock', problems });
      await shot('locked');
    }
    if (twiceId !== null) {
      const twice = state.profiles.find((profile) => profile.id === twiceId);
      if (!twice?.locked) problems.push(`the profile locked twice is not shown locked: ${JSON.stringify(twice)}`);
      await checkLockShown(page, { id: twiceId, language, timeId: 'profile.time.minutes.two', n: 2, what: 'the second lock', problems });
      await shot('locked-twice');
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

/**
 * A player made without a PIN adds one from the settings: typed twice, wrong the second time once,
 * then confirmed. After switching player, the profile asks for that PIN and signs in with it.
 */
async function checkAddPin(browser, browserName, language, bot) {
  const label = `${browserName}-360px-${language}`;
  const name = pinlessName(browserName, language, TAG);
  const problems = [];
  const screenshots = [];
  const notes = [];
  const expect = (ok, message) => {
    if (!ok) problems.push(message);
  };
  const made = await api('/profiles', { body: { name, avatar: 'blue' }, address: nextAddress() });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  const { context, page, shot, noSideways } = await narrowPage(browser, browserName, label, language, problems, screenshots);
  const targets = async (where) => {
    for (const target of await smallTargets(page)) problems.push(`${where}: touch target under ${MIN_TARGET_PX}px: ${target}`);
  };
  try {
    await page.goto(`${server.base}/?test=1`);
    await until(page, (s) => s.screen === 'profiles', 'the profile list');
    await page.locator(`.profile-card[data-profile-id="${made.data.id}"]`).tap();
    let state = await enterWorld(page, bot, (s) => inWorld(s) && s.canAddPin, 'the world, with a PIN to add', { notes });
    expect(state.profile?.name === name, `signed in as ${state.profile?.name}, not ${name}`);

    await page.locator('.settings-button').tap();
    await until(page, (s) => s.settingsOpen, 'the settings panel');
    expect((await textOf(page, '.add-pin')) === STRINGS['settings.addPin'][language], 'the add a PIN button has the wrong text');
    await targets('settings with add a PIN');
    await noSideways('the settings with add a PIN');
    await shot('add-pin-1-settings');
    await page.locator('.add-pin').tap();
    await until(page, (s) => s.screen === 'pinSetup' && s.pinStep === 'choose' && !s.settingsOpen, 'the PIN pad to choose a PIN');
    expect((await textOf(page, '#pin-setup .screen-title')) === STRINGS['profile.pinChoose'][language], 'the add a PIN pad has the wrong title');
    await targets('add a PIN');
    await noSideways('the add a PIN pad');
    await shot('add-pin-2-choose');

    await enterPin(page, PIN);
    await until(page, (s) => s.pinStep === 'confirm' && s.pinDigits === 0, 'the pad to ask for the PIN again');
    expect((await textOf(page, '#pin-setup .screen-title')) === STRINGS['profile.pinAgain'][language], 'the second pad has the wrong title');
    await enterPin(page, WRONG_PIN);
    state = await until(page, (s) => s.pinStep === 'choose' && s.notice === 'profile.pinMismatch', 'the PINs-differ message');
    expect((await textOf(page, '#pin-setup .notice')) === STRINGS['profile.pinMismatch'][language], 'the PINs-differ message has the wrong text');
    await noSideways('the PINs-differ message');
    await shot('add-pin-3-mismatch');

    await enterPin(page, PIN);
    await until(page, (s) => s.pinStep === 'confirm' && s.pinDigits === 0, 'the pad to ask for the PIN again');
    await enterPin(page, PIN);
    state = await until(page, (s) => s.pinStep === 'done', 'the PIN to be set');
    expect(!state.canAddPin, 'the settings still offer to add a PIN');
    expect((await textOf(page, '.pin-added')) === STRINGS['profile.pinAdded'][language], 'the confirmation has the wrong text');
    await targets('PIN added');
    await noSideways('the PIN added confirmation');
    await shot('add-pin-4-done');
    await page.locator('.pin-done').tap();
    state = await until(page, inWorld, 'the world after adding a PIN');
    expect(state.profile?.name === name, 'adding a PIN ended the session');
    const listed = await api('/profiles', { address: nextAddress() });
    expect(listed.data.find((profile) => profile.id === made.data.id)?.hasPin === true, 'the server does not list the profile with a PIN');

    await page.locator('.settings-button').tap();
    await until(page, (s) => s.settingsOpen, 'the settings panel');
    expect(!(await page.locator('.add-pin').isVisible()), 'the settings still show add a PIN');
    await page.locator('.switch-player').tap();
    state = await until(page, (s) => s.screen === 'profiles' && s.profile === null, 'the profile list after switching player');
    expect(state.profiles.find((profile) => profile.id === made.data.id)?.hasPin === true, 'the list does not show the new PIN');
    await page.locator(`.profile-card[data-profile-id="${made.data.id}"]`).tap();
    await until(page, (s) => s.screen === 'pin' && s.pinFor === 'enter', 'the PIN pad to sign in');
    await enterPin(page, PIN);
    state = await until(page, inWorld, 'the world after signing in with the added PIN');
    expect(state.profile?.name === name, 'the added PIN signed in as someone else');
    await shot('add-pin-5-signed-in');
    const check = async (where, step) => {
      await targets(where);
      await noSideways(where);
      await shot(step);
    };
    await wildBattle(page, bot, { expect, check, notes });
    await keepOne(page, bot, { language, expect, check, notes });
    await page.locator('#team .team-close').tap();
    await until(page, (s) => s.screen === 'world', 'the world after closing the team');
    await signOut(page);
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await context.close();
  }
  results.push({ label: `${label} (add a PIN)`, ok: problems.length === 0, problems, notes, screenshots });
}

/**
 * Learning a move, on our own server only: a player whose glowbun is a point of experience short of
 * a learnset level, prepared in the server's database (scripts/lib/learn-check.mjs), wins a wild
 * battle and is asked which move to forget for the new one. Chromium forgets one, in English;
 * WebKit keeps them all, in Slovenian. The learner is deleted afterwards, as the battlers are.
 */
async function checkLearn(browser, browserName, bot) {
  const language = browserName === 'chromium' ? 'en' : 'sl';
  const label = `${browserName}-360px-${language}`;
  const name = learnerName(browserName, language, TAG);
  const problems = [];
  const screenshots = [];
  const notes = [];
  const expect = (ok, message) => {
    if (!ok) problems.push(message);
  };
  const made = await api('/profiles', { body: { name, avatar: 'green' }, address: nextAddress() });
  if (made.status !== 201) throw new Error(`browser-check: making ${name} answered ${made.status}`);
  prepareSave(dataDir, made.data.id, learnerSave({ name, language, position: { map: START_MAP, ...bot.map.spawns[PLAYER_SPAWN], facing: 'down' } }));
  const { context, page, shot, noSideways } = await narrowPage(browser, browserName, label, language, problems, screenshots);
  const check = async (where, step) => {
    for (const target of await smallTargets(page)) problems.push(`${where}: touch target under ${MIN_TARGET_PX}px: ${target}`);
    await noSideways(where);
    await shot(step);
  };
  try {
    await page.goto(`${server.base}/?test=1`);
    await until(page, (s) => s.screen === 'profiles', 'the profile list');
    await page.locator(`.profile-card[data-profile-id="${made.data.id}"]`).tap();
    await until(page, (s) => inWorld(s) && s.progress?.team.length === 1, 'the world with the learner');
    await storyScreensFit(page, { noSideways, check });
    await meetWildCreature(page, bot, { notes });
    await playLearning(page, { language, strings: STRINGS, forget: browserName === 'chromium' ? 1 : null, expect, check });
    await signOut(page);
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await context.close();
    deleteProfile(dataDir, made.data.id);
  }
  results.push({ label: `${label} (learn a move)`, ok: problems.length === 0, problems, screenshots, notes });
}

/**
 * At 360px wide, a player prepared beside a bush and a cooking pot (scripts/lib/skill-saves.mjs)
 * opens the recipe book, a tiny game's card and the Skills tab, which must fit without scrolling
 * sideways. Chromium plays it in Slovenian, WebKit in English.
 */
async function checkSkillsNarrow(browser, browserName, bot) {
  const language = browserName === 'chromium' ? 'sl' : 'en';
  const label = `${browserName}-360px-${language}`;
  const problems = [];
  const screenshots = [];
  const notes = [];
  const player = await prepareSkillPlayer(browserName, '360px', language, bot, 'bush');
  const { context, page, shot, noSideways } = await narrowPage(browser, browserName, label, language, problems, screenshots);
  const check = async (where, step) => {
    for (const target of await smallTargets(page)) problems.push(`${where}: touch target under ${MIN_TARGET_PX}px: ${target}`);
    await shot(step);
  };
  try {
    await page.goto(`${server.base}/?test=1`);
    await until(page, (s) => s.screen === 'profiles', 'the profile list');
    await page.locator(`.profile-card[data-profile-id="${player.id}"]`).tap();
    await enterWorld(page, bot, inWorld, 'the world as the skill player at 360px', { notes });
    await skillScreensFit(page, player.plan, { noSideways, check });
    await signOut(page);
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await context.close();
    deleteProfile(dataDir, player.id);
  }
  results.push({ label: `${label} (skills)`, ok: problems.length === 0, problems, screenshots, notes });
}

/**
 * At 360px wide, a player beside the job board who never opened it (scripts/lib/skill-saves.mjs)
 * opens it for the first time: three cards and the hint, without scrolling sideways. Chromium plays
 * it in Slovenian, WebKit in English.
 */
async function checkBoardNarrow(browser, browserName, bot) {
  const language = browserName === 'chromium' ? 'sl' : 'en';
  const label = `${browserName}-360px-${language}`;
  const problems = [];
  const screenshots = [];
  const notes = [];
  const expect = (ok, message) => {
    if (!ok) problems.push(message);
  };
  const player = await prepareBoardPlayer(browserName, '360px', language, bot, false);
  const { context, page, shot, noSideways } = await narrowPage(browser, browserName, label, language, problems, screenshots);
  const check = async (where, step) => {
    for (const target of await smallTargets(page)) problems.push(`${where}: touch target under ${MIN_TARGET_PX}px: ${target}`);
    await shot(step);
  };
  try {
    await page.goto(`${server.base}/?test=1`);
    await until(page, (s) => s.screen === 'profiles', 'the profile list');
    await page.locator(`.profile-card[data-profile-id="${player.id}"]`).tap();
    await enterWorld(page, bot, inWorld, 'the world as the board player at 360px', { notes });
    await boardScreenFits(page, player.plan, { language, strings: STRINGS, expect, noSideways, check });
    await signOut(page);
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await context.close();
    deleteProfile(dataDir, player.id);
  }
  results.push({ label: `${label} (job board)`, ok: problems.length === 0, problems, screenshots, notes });
}

/** Fills our own server's list to MAX_PROFILES over the API, the way a big family would. */
async function fillProfiles() {
  const listed = await api('/profiles', { address: nextAddress() });
  if (listed.status !== 200) throw new Error(`browser-check: listing profiles answered ${listed.status}`);
  const letters = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].slice(0, Math.max(0, MAX_PROFILES - listed.data.length));
  await inTurn(letters, async (letter) => {
    const made = await api('/profiles', { body: { name: `Poln ${letter}`, avatar: 'purple' }, address: nextAddress() });
    if (made.status !== 201) throw new Error(`browser-check: filling the list answered ${made.status}`);
  });
}

/** A full list offers no "New player" and says why on the list itself. */
async function checkFull(browser, browserName, language) {
  const label = `${browserName}-360px-${language}`;
  const problems = [];
  const screenshots = [];
  const { context, page, shot, noSideways } = await narrowPage(browser, browserName, label, language, problems, screenshots);
  try {
    await page.goto(`${server.base}/?test=1`);
    const state = await until(page, (s) => s.screen === 'profiles', 'the full profile list');
    if (state.profiles.length !== MAX_PROFILES) problems.push(`the full list shows ${state.profiles.length} profiles, not ${MAX_PROFILES}`);
    if ((await page.locator('.new-profile').count()) !== 0) problems.push('a full list still offers "New player"');
    if ((await textOf(page, '.list-full')) !== STRINGS['profile.error.full'][language]) problems.push('the full list does not say it is full');
    for (const target of await smallTargets(page)) problems.push(`the full list: touch target under ${MIN_TARGET_PX}px: ${target}`);
    await noSideways('the full profile list');
    await page.locator('.list-full').scrollIntoViewIfNeeded();
    await shot('full');
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await context.close();
  }
  results.push({ label: `${label} (full list)`, ok: problems.length === 0, problems, screenshots });
}

/** Runs one check and notes on the result it adds how long it took. */
async function timed(check) {
  const started = performance.now();
  const from = results.length;
  await check();
  for (const result of results.slice(from)) result.durationMs = Math.round(performance.now() - started);
}

/** A part's device runs (each device in each language), then its 360px runs. */
async function playPart(browser, part, bot) {
  const name = part.browser;
  // A lock lasts a minute and needs five logins at once, which only our own server can spare.
  // The second lock waits for the first to end, so it starts before the device runs.
  const relock = part.narrow && LOCAL ? await lockedTwiceLater(name) : null;
  const runs = DEVICES.filter((device) => part.devices.includes(device.name)).flatMap((device) => LANGUAGES.map((language) => ({ device, language })));
  await inTurn(runs, ({ device, language }) => timed(() => checkDevice(browser, name, device, language, bot)));
  if (!part.narrow) return;
  const lockedId = LOCAL ? await lockedProfile(name) : null;
  const twiceId = relock ? await relock() : null;
  await inTurn(LANGUAGES, (language) => timed(() => checkNarrow(browser, name, language, { lockedId, twiceId })));
  await inTurn(LANGUAGES, (language) => timed(() => checkAddPin(browser, name, language, bot)));
  if (LOCAL) await timed(() => checkLearn(browser, name, bot));
  if (LOCAL) await timed(() => checkSkillsNarrow(browser, name, bot));
  if (LOCAL) await timed(() => checkBoardNarrow(browser, name, bot));
}

let bot = null;
try {
  // One browser and one page at a time, so screenshots and timings are not fighting for the GPU.
  bot = await prepareBot();
  await inTurn(BROWSERS.filter((browser) => parts.some((part) => part.browser === browser.name)), async ({ name, type, options }) => {
    const browser = await type.launch(options);
    try {
      await inTurn(parts.filter((part) => part.browser === name), (part) => playPart(browser, part, bot));
    } finally {
      await browser.close();
    }
  });
  // Last of all, since a full list stops every run after it from making a player.
  const full = parts.find((part) => part.fullList);
  if (LOCAL && full) {
    await fillProfiles();
    const { name, type, options } = BROWSERS.find((browser) => browser.name === full.browser);
    const browser = await type.launch(options);
    try {
      await inTurn(LANGUAGES, (language) => timed(() => checkFull(browser, name, language)));
    } finally {
      await browser.close();
    }
  }
} finally {
  // The pages sign their own players out; the bot signs out here.
  if (bot) {
    const ended = await apiCall(server.base, '/sessions/current', { method: 'DELETE', headers: { authorization: `Bearer ${bot.token}` } });
    if (ended.status !== 204) results.push({ label: 'bot sign-out', ok: false, problems: [`signing the bot out answered ${ended.status}`], screenshots: [] });
  }
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

writeFileSync(join(out, 'logs', `${logName}.json`), `${JSON.stringify(results, null, 2)}\n`);
for (const result of results) {
  const took = result.durationMs === undefined ? '' : ` ${(result.durationMs / 1000).toFixed(1)}s`;
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.label}${result.serviceWorkerReload ? ' (+ reload under service worker)' : ''}${took}`);
  for (const problem of result.problems) console.log(`       - ${problem}`);
  for (const note of result.notes ?? []) console.log(`       note: ${note}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(failed ? `\nbrowser-check: ${failed} run(s) failed` : `\nbrowser-check: all ${results.length} runs passed`);
process.exit(failed ? 1 : 0);
