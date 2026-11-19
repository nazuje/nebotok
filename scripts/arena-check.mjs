// Level 4 arena check: a real fight in the real client (apps/game/src/arena/) against the real
// server, in headless, muted Chromium or WebKit. The server runs in this process, from the built
// game, with ARENA_BATTLES on. The check starts each fight through the world room, so every run meets
// the same weak wild creature rather than whatever the grass sends (the bot run's arena bot,
// scripts/lib/arena-bot.mjs, covers the grass). Each run signs in
// as a player whose save it prepared, sees the island, the cards and the buttons (each at least
// 64px, with its picture, a lock on one its level has not reached), steers with the stick, the
// mouse or the keys and fires button 1 by tap or key until the wild creature is beaten, reads the
// result and continues back to the world. The 360px run holds Leave instead. Best of 3 runs start
// a practice fight against BOT the same way (the world room's `arena.practice` switch), pick three
// on the pick screen, fight each round, check the score between rounds and finish. An iPhone, an
// iPad and 360px wide, in both languages across the two browsers. Fails on any console error, failed or
// outside request, small touch target or sideways scrolling.
//   node scripts/arena-check.mjs --browser chromium|webkit [--out <dir>]
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { matchMaker } from '@colyseus/core';
import { createGameServer } from '../apps/server/src/app.ts';
import { readConfig } from '../apps/server/src/config.ts';
import { createLog } from '../apps/server/src/log.ts';
import { createServices } from '../apps/server/src/services.ts';
import { PLAYER_SPAWN, createSave, defaultSettings, emptyProgress, newCreature } from '../packages/core/src/index.ts';
import { BROWSERS, DEVICES, animationsSettled, nextFrames, presetLanguage, readState, reportCspViolations, screenshot, until, watch } from './lib/game-page.mjs';
import { inTurn, poll, sleep } from './lib/in-turn.mjs';
import { ROOT, freePort } from './lib/server-process.mjs';
import { arenaName, runTag } from './lib/test-players.mjs';

const { values } = parseArgs({ options: { out: { type: 'string' }, browser: { type: 'string' } } });
const chosen = BROWSERS.find((browser) => browser.name === values.browser);
if (!chosen) {
  console.error(`arena-check: --browser must be one of ${BROWSERS.map((browser) => browser.name).join(', ')}, got "${values.browser}"`);
  process.exit(2);
}
if (!existsSync(join(ROOT, 'apps/game/dist/index.html'))) {
  console.error('arena-check: apps/game/dist is missing. Run: npm run build');
  process.exit(1);
}
const out = values.out ?? join(ROOT, '.proof', 'arena-check');
const shots = join(out, 'screenshots');
mkdirSync(shots, { recursive: true });
mkdirSync(join(out, 'logs'), { recursive: true });

const STRINGS = JSON.parse(readFileSync(join(ROOT, 'content/strings.json'), 'utf8'));
const STARTERS = JSON.parse(readFileSync(join(ROOT, 'content/starters.json'), 'utf8')).species;
const ARENA = JSON.parse(readFileSync(join(ROOT, 'content/creatures/arena.json'), 'utf8'));
const NARROW = { width: 360, height: 740 };
const MIN_TARGET_PX = 48;
const ARENA_BUTTON_PX = 64;
const FIGHT_MS = 40_000;
const ROUNDS_MS = 120_000;
const STEER_MS = 350;
const WINS = new Set(['won', 'wonByRingOut']);
const TAG = runTag();

/**
 * The runs of each browser: a phone, a tablet and 360px, the languages crossed so each is seen in
 * both, and each way to steer: touches on the stick (a mouse in WebKit, which has no touch
 * drag), and the keys. The 360px player's creature is too young for button 3 and holds Leave.
 * The best of 3 runs (`rounds`) take the other language of their place, so each player's name is new.
 */
const RUNS = {
  chromium: [
    { where: 'iphone-portrait', language: 'en', steer: 'touch', level: 20, leave: false },
    { where: 'ipad-landscape', language: 'sl', steer: 'keys', level: 20, leave: false },
    { where: '360px', language: 'sl', steer: 'touch', level: ARENA.buttons[1], leave: true },
    { where: 'iphone-portrait', language: 'sl', steer: 'touch', level: 20, rounds: true },
    { where: '360px', language: 'en', steer: 'keys', level: 20, rounds: true },
  ],
  webkit: [
    { where: 'iphone-portrait', language: 'sl', steer: 'keys', level: 20, leave: false },
    { where: 'ipad-landscape', language: 'en', steer: 'mouse', level: 20, leave: false },
    { where: '360px', language: 'en', steer: 'keys', level: ARENA.buttons[1], leave: true },
    { where: 'ipad-landscape', language: 'sl', steer: 'mouse', level: 20, rounds: true },
  ],
}[chosen.name];

/** A best of 3's team: four creatures with the second fainted, so the defaults are places 0, 2 and 3. Its opponents are weak, so a round is won soon. */
const ROUNDS_TEAM = [STARTERS[0], STARTERS[1], STARTERS[2], STARTERS[0]];
const FAINTED_PLACE = 1;
const DEFAULT_PICKS = [0, 2, 3];
const PRACTICE = STARTERS.slice(0, 3).map((species) => ({ species, level: 2 }));

const lines = [];
const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-arena-check-'));
const config = readConfig({ NODE_ENV: 'production', DATA_DIR: dataDir, ARENA_BATTLES: 'on', LOG_LEVEL: 'info' });
const log = createLog('info', (line) => lines.push(JSON.parse(line)));
const services = createServices(config, Date.now, log);
const gameServer = createGameServer(config, log, services);
const port = await freePort();
await gameServer.listen(port, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const allowedHost = new URL(base).host;
const world = services.world;
const [zone] = world.encounters.values();
const wild = { species: zone.creatures[0].species, level: zone.creatures[0].minLevel };
const results = [];

/** A player standing at the spawn with `team` (two creatures of `level`) and a treat, saved in this server's database. */
async function preparePlayer(run, team = [newCreature(STARTERS[0], run.level, world.battle), newCreature(STARTERS[1], run.level, world.battle)]) {
  const name = arenaName(chosen.name, run.where, run.language, TAG);
  const made = await services.profiles.create({ name, avatar: 'green' });
  if (!made.ok) throw new Error(`arena-check: making ${name}: ${made.error}`);
  const position = { map: world.map.id, ...world.map.spawns[PLAYER_SPAWN], facing: 'down' };
  const progress = { ...emptyProgress(), team, inventory: [{ item: 'plain-treat', count: 3 }] };
  services.progress.save(made.value.id, createSave({ settings: defaultSettings(), name, language: run.language, createdAt: new Date().toISOString(), position, ...progress }));
  return { id: made.value.id, name };
}

/** Starts the wild fight in the world room the player is in: only that room knows them. */
async function startFight(playerId) {
  const rooms = await matchMaker.query({ name: 'world' });
  const started = await inTurn(rooms, (listed) => matchMaker.getLocalRoomById(listed.roomId)?.startWildFight(playerId, wild));
  const fightId = started.find(Boolean);
  if (!fightId) throw new Error('the world room started no fight');
  return fightId;
}

const smallTargets = (page) =>
  page.locator('button:visible').evaluateAll(
    (items, least) =>
      items
        .map((item) => ({ item, box: item.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.width < least || box.height < least))
        .map(({ item, box }) => `${item.className} ${Math.round(box.width)}x${Math.round(box.height)}`),
    MIN_TARGET_PX,
  );
const sideways = (page) => page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth);

/** Each arena button on screen: its action, size and the pictures it holds. */
const arenaButtons = (page) =>
  page.locator('#arena .arena-button:visible, #arena .arena-leave:visible').evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      const pictures = [...item.querySelectorAll('[data-picture]')].map((picture) => picture.dataset.picture);
      return { action: item.dataset.action ?? 'leave', width: Math.round(box.width), height: Math.round(box.height), pictures, shape: item.querySelector('[data-shape]')?.dataset.shape ?? null, disabled: item.disabled };
    }),
  );

const centre = async (page, selector) => {
  const box = await page.locator(selector).boundingBox();
  return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
};

/** The way from your creature to the wild one, as a unit push. */
function towardWild(state) {
  const { mine, theirs } = state.arena ?? {};
  if (!mine || !theirs) return null;
  const dx = theirs.x - mine.x;
  const dy = theirs.y - mine.y;
  const length = Math.hypot(dx, dy);
  return length === 0 ? null : { x: dx / length, y: dy / length };
}

/** A thumb, or WebKit's mouse, that lands on the stick's half of the screen and pushes. */
async function makeThumb(page) {
  if (chosen.name === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, at) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: at ? [{ x: at.x, y: at.y, id: 1 }] : [] });
    return { down: (at) => touch('touchStart', at), move: (at) => touch('touchMove', at), up: () => touch('touchEnd') };
  }
  return {
    down: async (at) => {
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
    },
    move: (at) => page.mouse.move(at.x, at.y, { steps: 2 }),
    up: () => page.mouse.up(),
  };
}

const KEYS = { right: 'd', left: 'a', down: 's', up: 'w' };
function keysToward(push) {
  const held = [];
  if (push.x > 0.38) held.push(KEYS.right);
  if (push.x < -0.38) held.push(KEYS.left);
  if (push.y > 0.38) held.push(KEYS.down);
  if (push.y < -0.38) held.push(KEYS.up);
  return held;
}

/** Steers at the wild creature and fires button 1 until the fight ends, the way `run.steer` says. */
async function fightOn(page, run, { endsBy, stopWhen }) {
  const { width, height } = page.viewportSize();
  const origin = { x: Math.round(width * 0.22), y: Math.round(height * 0.72) };
  const thumb = run.steer === 'keys' ? null : await makeThumb(page);
  const keys = { held: [] };

  /** One push toward the wild creature and one press of button 1, by thumb or by keys. */
  async function step(push) {
    if (thumb) {
      await thumb.down(origin);
      await thumb.move({ x: origin.x + push.x * 50, y: origin.y + push.y * 50 });
      await sleep(STEER_MS);
      await thumb.up();
      if (!stopWhen(await readState(page))) await page.locator('#arena .arena-button.ability-1').tap({ timeout: 2_000 }).catch(() => {});
      return;
    }
    const next = keysToward(push);
    await inTurn(keys.held.filter((key) => !next.includes(key)), (key) => page.keyboard.up(key));
    await inTurn(next.filter((key) => !keys.held.includes(key)), (key) => page.keyboard.down(key));
    keys.held = next;
    await page.keyboard.press('1');
    await sleep(STEER_MS / 2);
  }

  async function onward(state) {
    if (stopWhen(state) || Date.now() >= endsBy) return state;
    const push = towardWild(state);
    await (push ? step(push) : sleep(100));
    return onward(await readState(page));
  }

  const state = await onward(await readState(page));
  await inTurn(keys.held, (key) => page.keyboard.up(key));
  return state;
}

/** Holds Leave for longer than its second, by touch in Chromium and by mouse in WebKit. */
async function holdLeave(page) {
  const at = await centre(page, '#arena .arena-leave');
  if (!at) throw new Error('Leave is not on the screen');
  const thumb = await makeThumb(page);
  await thumb.down(at);
  await sleep(1_400);
  await thumb.up();
}

/** What is wrong with the fight on screen: its cards, its buttons' sizes and pictures, and what the scene drew. */
async function fightProblems(page, state, run) {
  const problems = [];
  const { arena } = state;
  const badge = await page.locator('#arena .arena-card.mine .arena-level').textContent();
  const wantedBadge = STRINGS['battle.level'][run.language].replace('{level}', String(run.level));
  if (badge !== wantedBadge) problems.push(`your card's level badge says "${badge}", not "${wantedBadge}"`);
  if (arena.drawn?.creatures[0] !== arena.mine?.species || arena.drawn?.creatures[1] !== arena.theirs?.species) problems.push(`the scene drew ${JSON.stringify(arena.drawn)}, not ${arena.mine?.species} and ${arena.theirs?.species}`);
  if (arena.mine?.species !== STARTERS[0] || arena.theirs?.species !== wild.species) problems.push(`the island holds ${arena.mine?.species} and ${arena.theirs?.species}`);
  const buttons = await arenaButtons(page);
  for (const button of buttons) if (button.width < ARENA_BUTTON_PX || button.height < ARENA_BUTTON_PX) problems.push(`arena button ${button.action} is ${button.width}x${button.height}, under ${ARENA_BUTTON_PX}px`);
  const actions = buttons.map((button) => button.action);
  for (const wanted of ['0', '1', '2', 'dash', 'swap', 'leave']) if (!actions.includes(wanted)) problems.push(`no ${wanted} button on screen: ${actions.join(', ')}`);
  if (actions.includes('treat')) problems.push('Treat shows while the wild creature is at full health');
  for (const button of buttons) if (button.pictures.length === 0) problems.push(`arena button ${button.action} holds no picture`);
  const third = buttons.find((button) => button.action === '2');
  const locked = run.level < ARENA.buttons[2];
  if (third && locked !== (third.pictures.includes('pictures/lock') && third.disabled)) problems.push(`button 3 at level ${run.level} shows ${JSON.stringify(third)}`);
  const first = buttons.find((button) => button.action === '0');
  if (first && first.shape === null) problems.push(`button 1 shows ${JSON.stringify(first.pictures)}, not its move's shape`);
  return problems;
}

/**
 * A run's player, prepared with `team`, and its page on the run's device and language: `tab`, with
 * what it found wrong, its notes and screenshots, and `signIn` to the world as that player.
 */
async function openRun(browser, run, team) {
  const label = `${chosen.name}-${run.where}-${run.language}${run.rounds ? '-rounds' : ''}`;
  const problems = [];
  const notes = [];
  const screenshots = [];
  const expect = (ok, message) => {
    if (!ok) problems.push(message);
  };
  const player = await preparePlayer(run, team);
  const device = DEVICES.find((each) => each.name === run.where);
  const contextOptions = device ? { ...device.descriptor } : { viewport: NARROW, hasTouch: true, isMobile: chosen.name === 'chromium' };
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(presetLanguage, run.language);
  await context.addInitScript(reportCspViolations);
  const tab = await context.newPage();
  watch(context, tab, problems, { allowedHost });
  const shot = async (step) => {
    const path = join(shots, `${label}-${step}.png`);
    await screenshot(tab, path);
    screenshots.push(path);
  };
  const fits = async (where) => {
    for (const target of await smallTargets(tab)) problems.push(`${where}: touch target under ${MIN_TARGET_PX}px: ${target}`);
    const over = await sideways(tab);
    if (over > 0) problems.push(`${where} scrolls sideways by ${over}px`);
  };
  const signIn = async () => {
    await tab.goto(`${base}/?test=1`);
    await until(tab, (s) => s.screen === 'profiles', 'the profile list');
    await tab.locator(`.profile-card[data-profile-id="${player.id}"]`).tap();
    await until(tab, (s) => s.screen === 'world' && s.connection === 'connected' && s.progress?.team.length === (team?.length ?? 2), 'the world as the arena player');
  };
  return { label, player, tab, problems, notes, screenshots, expect, shot, fits, signIn, close: () => context.close() };
}

async function checkRun(browser, run) {
  const opened = await openRun(browser, run);
  const { label, player, tab: page, problems, notes, screenshots, expect, shot, fits } = opened;
  try {
    await opened.signIn();
    const fightId = await startFight(player.id);
    let state = await until(page, (s) => s.screen === 'arena' && s.arena?.joined && s.arena.phase === 'fighting' && s.arena.drawn !== null && s.arena.mine !== null, 'the arena fight on screen', 15_000);
    expect(state.arena.fightId === fightId && state.arena.mode === 'wild' && state.arena.side === 0, `the page shows fight ${JSON.stringify(state.arena)}, not ${fightId}`);
    expect(state.players.find((each) => each.self)?.inBattle === true, 'your courier is not shown fighting');
    await nextFrames(page);
    for (const problem of await fightProblems(page, state, run)) problems.push(problem);
    await fits('the arena fight');
    const startedAt = state.arena.mine;
    if (run.leave) {
      state = await fightOn(page, { ...run, steer: 'keys' }, { endsBy: Date.now() + 1_500, stopWhen: (s) => s.arena?.result != null });
      await shot('1-fight');
      await holdLeave(page);
    } else {
      state = await fightOn(page, run, { endsBy: Date.now() + 2_500, stopWhen: (s) => s.arena?.result != null });
      await shot('1-fight');
      state = await fightOn(page, run, { endsBy: Date.now() + FIGHT_MS, stopWhen: (s) => s.arena?.result != null });
    }
    const moved = state.arena?.mine && (state.arena.mine.x !== startedAt.x || state.arena.mine.y !== startedAt.y);
    expect(state.arena?.result != null || moved, `your creature never moved from ${JSON.stringify(startedAt)}`);
    expect((state.arena?.inputs ?? 0) > 20 && (run.leave || (state.arena?.presses ?? 0) > 0), `the page sent ${state.arena?.inputs} inputs with ${state.arena?.presses} presses`);
    state = await until(page, (s) => s.arena?.result != null, 'the fight result', 10_000);
    const outcome = state.arena.result.outcome?.result ?? null;
    notes.push(`${outcome} after ${state.arena.inputs} inputs and ${state.arena.presses} presses`);
    if (run.leave) expect(outcome === 'ran', `holding Leave ended the fight with ${outcome}`);
    else expect(WINS.has(outcome), `the fight ended with ${outcome}, not a win`);
    if (WINS.has(outcome)) expect(state.arena.result.rewards.length > 0, 'a won fight gave no experience');
    await page.locator('#arena .arena-continue').waitFor({ state: 'visible', timeout: 5_000 });
    await nextFrames(page);
    const line = (await page.locator('#arena .arena-result-line').textContent())?.trim();
    const wantedLine = STRINGS[run.leave ? 'battle.ranAway' : 'battle.won'][run.language];
    expect(line === wantedLine, `the result says "${line}", not "${wantedLine}"`);
    const picture = await page.locator('#arena .arena-result-picture').getAttribute('data-picture');
    expect(picture === `pictures/${run.leave ? 'leave' : outcome === 'wonByRingOut' ? 'ring-out' : 'trophy'}`, `the result shows the picture ${picture}`);
    await fits('the arena result');
    await shot('2-result');
    await page.locator('#arena .arena-continue').tap();
    state = await until(page, (s) => s.screen === 'world' && s.arena === null && s.players.find((each) => each.self)?.inBattle === false, 'the world after the fight', 10_000);
    await nextFrames(page);
    expect(!(await page.locator('#arena').isVisible()), 'the arena screen stays after Continue');
    const saved = services.progress.load(player.id)?.data;
    const reward = state.arena === null && WINS.has(outcome) ? (await readState(page)).progress?.team[0] : null;
    if (reward) expect(saved?.team[0]?.xp === reward.xp && saved?.team[0]?.level === reward.level, `the page shows ${JSON.stringify(reward)} after the fight, not the saved ${JSON.stringify(saved?.team[0])}`);
    await shot('3-world');
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await opened.close();
  }
  results.push({ label: `${label} (arena)`, ok: problems.length === 0, problems, notes, screenshots });
}

/** Starts a best of 3 against BOT, the `arena.practice` switch, in the world room the player is in. */
async function startPractice(playerId) {
  const rooms = await matchMaker.query({ name: 'world' });
  const started = await inTurn(rooms, (listed) => matchMaker.getLocalRoomById(listed.roomId)?.startPractice(playerId, PRACTICE));
  const fightId = started.find(Boolean);
  if (!fightId) throw new Error('the world room started no best of 3');
  return fightId;
}

/** What is wrong with the pick screen: the team's choices, the fainted one, the three slots and Go. */
async function pickProblems(page) {
  const problems = [];
  const choices = await page.locator('#arena .arena-choice:visible').evaluateAll((items) =>
    items.map((item) => ({ place: Number(item.dataset.place), disabled: item.disabled, portrait: Math.round(item.querySelector('canvas')?.getBoundingClientRect().width ?? 0), weather: item.querySelector('[data-picture^="weather"]') !== null, level: item.querySelector('.arena-level')?.textContent ?? '' })),
  );
  if (choices.length !== ROUNDS_TEAM.length) problems.push(`the pick screen shows ${choices.length} creatures, not ${ROUNDS_TEAM.length}`);
  for (const choice of choices) {
    if (choice.portrait < 64) problems.push(`the creature at place ${choice.place} has a ${choice.portrait}px portrait, under 64px`);
    if (choice.disabled !== (choice.place === FAINTED_PLACE)) problems.push(`the creature at place ${choice.place} is ${choice.disabled ? '' : 'not '}greyed out`);
    if (!choice.weather || choice.level === '') problems.push(`the creature at place ${choice.place} shows no weather type or level: ${JSON.stringify(choice)}`);
  }
  const slots = await page.locator('#arena .arena-slot:visible').count();
  if (slots !== 3) problems.push(`the pick screen has ${slots} slots, not 3`);
  const go = await page.locator('#arena .arena-go:visible [data-picture="pictures/check"]').count();
  if (go !== 1) problems.push('Go shows no tick');
  return problems;
}

/** What is wrong with the score between rounds: its pips for the rounds so far and both next creatures. */
async function betweenProblems(page, state) {
  const problems = [];
  const pips = await page.locator('#arena .arena-pip:visible').evaluateAll((items) => items.map((item) => [item.dataset.pip, item.querySelector('[data-picture]')?.dataset.picture ?? null]));
  const [mine, theirs] = state.arena.score;
  const won = pips.filter(([pip, picture]) => pip === 'won' && picture === 'pictures/trophy').length;
  const lost = pips.filter(([pip, picture]) => pip === 'lost' && picture === 'pictures/puff').length;
  if (pips.length !== 3 || won !== mine || lost < theirs || pips.filter(([pip]) => pip === 'empty').length !== 3 - won - lost) problems.push(`the score ${mine} to ${theirs} shows the pips ${JSON.stringify(pips)}`);
  const next = await page.locator('#arena .arena-next canvas:visible').count();
  if (next !== 2) problems.push(`the score shows ${next} next creatures, not 2`);
  return problems;
}

/**
 * A best of 3 against BOT: the pick screen with a fainted creature greyed out, a tap that takes
 * the first pick out and one that puts it back last, Go, then each round fought as a wild fight
 * is, with the score between rounds, to the result and back to the world.
 */
async function checkRoundsRun(browser, run) {
  const opened = await openRun(browser, run, ROUNDS_TEAM.map((species, place) => ({ ...newCreature(species, run.level, world.battle), ...(place === FAINTED_PLACE ? { hp: 0 } : {}) })));
  const { tab, problems, notes, expect, shot, fits } = opened;
  try {
    await opened.signIn();
    const fightId = await startPractice(opened.player.id);
    let state = await until(tab, (s) => s.screen === 'arena' && s.arena?.joined && s.arena.phase === 'picking' && s.arena.picks?.length === 3, 'the pick screen', 15_000);
    expect(state.arena.fightId === fightId && state.arena.mode === 'rounds', `the page shows fight ${JSON.stringify(state.arena)}, not the best of 3 ${fightId}`);
    expect(JSON.stringify(state.arena.picks) === JSON.stringify(DEFAULT_PICKS), `the defaults are ${JSON.stringify(state.arena.picks)}, not ${JSON.stringify(DEFAULT_PICKS)}`);
    await tab.locator('#arena .arena-pick').waitFor({ state: 'visible', timeout: 5_000 });
    await nextFrames(tab);
    for (const problem of await pickProblems(tab)) problems.push(problem);
    const [first, ...rest] = DEFAULT_PICKS;
    await tab.locator(`#arena .arena-choice[data-place="${first}"]`).tap();
    state = await until(tab, (s) => JSON.stringify(s.arena?.picks) === JSON.stringify(rest), 'the first pick to be taken out', 5_000);
    await tab.locator(`#arena .arena-choice[data-place="${first}"]`).tap();
    state = await until(tab, (s) => JSON.stringify(s.arena?.picks) === JSON.stringify([...rest, first]), 'the first pick to come back last', 5_000);
    await nextFrames(tab);
    await fits('the pick screen');
    await shot('1-pick');
    await tab.locator('#arena .arena-go').tap();
    state = await until(tab, (s) => s.arena?.phase === 'fighting' && s.arena.mine !== null, 'round 1', 10_000);
    expect(state.arena.mine.species === ROUNDS_TEAM[rest[0]], `round 1 sends out ${state.arena.mine.species}, not the first pick`);
    const endsBy = Date.now() + ROUNDS_MS;
    let pauses = 0;
    /** Fights each round to its end, checking the score between rounds, until the result or `endsBy`. */
    const fightRounds = async (now) => {
      if (now.arena?.result != null || Date.now() >= endsBy) return now;
      const after = await fightOn(tab, run, { endsBy, stopWhen: (s) => s.arena?.result != null || s.arena?.phase === 'between' });
      if (after.arena?.phase !== 'between') return fightRounds(after);
      pauses += 1;
      await tab.locator('#arena .arena-between').waitFor({ state: 'visible', timeout: 5_000 });
      await animationsSettled(tab, 1_500);
      for (const problem of await betweenProblems(tab, after)) problems.push(problem);
      if (pauses === 1) {
        await fits('the score between rounds');
        await shot('2-score');
      }
      return fightRounds(await until(tab, (s) => s.arena?.phase !== 'between', 'the next round', 10_000));
    };
    state = await fightRounds(state);
    state = await until(tab, (s) => s.arena?.result != null, 'the best of 3 result', 10_000);
    const outcome = state.arena.result.outcome?.result ?? null;
    notes.push(`${outcome} ${state.arena.score.join(' to ')} in ${state.arena.result.rounds?.length ?? '?'} rounds after ${state.arena.inputs} inputs`);
    expect(outcome === 'won', `the best of 3 ended with ${outcome}, not a win`);
    expect(pauses >= 1, 'the score never showed between rounds');
    await tab.locator('#arena .arena-continue').waitFor({ state: 'visible', timeout: 5_000 });
    const picture = await tab.locator('#arena .arena-result-picture').getAttribute('data-picture');
    expect(picture === 'pictures/trophy', `the result shows the picture ${picture}`);
    await fits('the best of 3 result');
    await shot('3-result');
    await tab.locator('#arena .arena-continue').tap();
    await until(tab, (s) => s.screen === 'world' && s.arena === null && s.players.find((each) => each.self)?.inBattle === false, 'the world after the best of 3', 10_000);
    const saved = services.progress.load(opened.player.id)?.data;
    expect(saved?.team.every((creature, place) => creature.level === run.level && (place === FAINTED_PLACE) === (creature.hp === 0)), `a best of 3 changed the saved team: ${JSON.stringify(saved?.team.map(({ level, hp }) => ({ level, hp })))}`);
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await opened.close();
  }
  results.push({ label: `${opened.label} (best of 3)`, ok: problems.length === 0, problems, notes, screenshots: opened.screenshots });
}

try {
  const browser = await chosen.type.launch(chosen.options);
  try {
    await inTurn(RUNS, async (run) => {
      const started = performance.now();
      await (run.rounds ? checkRoundsRun(browser, run) : checkRun(browser, run));
      results.at(-1).durationMs = Math.round(performance.now() - started);
    });
  } finally {
    await browser.close();
  }
} finally {
  await gameServer.gracefullyShutdown(false);
  services.close();
  const serverProblems = lines.filter((line) => line.level === 'error').map((line) => `server error log: ${line.msg}`);
  const closed = await poll(() => lines.filter((line) => line.msg === 'fight settled').length === RUNS.length, { deadline: Date.now() + 1_000 });
  if (!closed) serverProblems.push(`the server settled ${lines.filter((line) => line.msg === 'fight settled').length} fights, not ${RUNS.length}`);
  results.push({ label: 'server', ok: serverProblems.length === 0, problems: serverProblems, screenshots: [] });
  writeFileSync(join(out, 'logs', `arena-check-${chosen.name}-server.log`), `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  rmSync(dataDir, { recursive: true, force: true });
}

writeFileSync(join(out, 'logs', `arena-check-${chosen.name}.json`), `${JSON.stringify(results, null, 2)}\n`);
for (const result of results) {
  const took = result.durationMs === undefined ? '' : ` ${(result.durationMs / 1000).toFixed(1)}s`;
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.label}${took}`);
  for (const problem of result.problems) console.log(`       - ${problem}`);
  for (const note of result.notes ?? []) console.log(`       note: ${note}`);
}
const failed = results.filter((result) => !result.ok).length;
console.log(failed ? `\narena-check: ${failed} run(s) failed` : `\narena-check: all ${results.length} runs passed`);
process.exit(failed ? 1 : 0);
