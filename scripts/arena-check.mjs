// Level 4 arena check: a real fight in the real client (apps/game/src/arena/) against the real
// server, in headless, muted Chromium or WebKit. The server runs in this process, from the built
// game, with ARENA_BATTLES on. The check starts each fight through the world room, so every run meets
// the same wild creature, one the first starter's moves hit hard, rather than whatever the grass
// sends (the bot run's arena bot, scripts/lib/arena-bot.mjs, covers the grass). Each run signs in
// as a player whose save it prepared, sees the island, the cards (level badges coloured by the
// gap, and an arrow to the shrine on yours when it came in hurt, as the 360px runs' lead does) and
// the buttons (each at least 64px, with its picture, a big lock and the level in big digits on one
// its level has not reached), steers with the stick, the mouse or the keys and fires button 1 by tap or key, takes a
// picture of a strong hit's number, reads the result and continues back to the world. One run on
// a phone or tablet waits for the storm's warning with the weather called; the other weakens the
// wild creature and befriends it with a treat. The 360px run asks for reduced motion, checks a hit
// gives no shake, no hit-stop and no sparks, and holds Leave. Each of these runs first walks 5 s
// at a fake lag of 0, 50 or 150 ms with the net meters on (?net=1) and checks the prediction's
// mean error and snaps (#152). Best of 3 runs start a practice fight against BOT the same way (the
// world room's `arena.practice` switch), pick three on the pick screen, fight each round, check
// the score between rounds and finish. Trainer runs (#156) stand beside Vetrinka with the first
// chapter done, take her challenge in a talk, pick three, win the best of 3 against her trainer
// made easy for the check, and see the talk come back at her won line once the result is put
// away, with her first win's treats and flag saved. An iPhone, an iPad and 360px wide, in both
// languages across the two browsers. Back in the world, the team button shows the shrine while a
// creature's bar is no longer green. Fails on any console error, failed or outside request, small touch target or
// sideways scrolling.
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
import { PLAYER_SPAWN, arenaContentOf, createSave, defaultSettings, emptyProgress, encounterZoneAt, isWalkable, maxHpOf, newCreature, treatWindowPercent, wildLoadout } from '../packages/core/src/index.ts';
import { BROWSERS, DEVICES, animationsSettled, makeThumb, nextFrames, openTalk, presetLanguage, readState, reportCspViolations, screenshot, servedMap, talkThrough, until, watch } from './lib/game-page.mjs';
import { inTurn, poll, sleep } from './lib/in-turn.mjs';
import { ROOT, freePort } from './lib/server-process.mjs';
import { arenaName, runTag, trainerName } from './lib/test-players.mjs';

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
const SPECIES = JSON.parse(readFileSync(join(ROOT, 'content/creatures/species.json'), 'utf8')).species;
const TYPES = JSON.parse(readFileSync(join(ROOT, 'content/creatures/weather.json'), 'utf8')).types;
const MOVES = JSON.parse(readFileSync(join(ROOT, 'content/creatures/moves.json'), 'utf8')).moves;
const ITEMS = JSON.parse(readFileSync(join(ROOT, 'content/items.json'), 'utf8')).items;
const NARROW = { width: 360, height: 740 };
const MIN_TARGET_PX = 48;
const ARENA_BUTTON_PX = 64;
const FIGHT_MS = 40_000;
/** The storm's first warning comes 2 s before its first shrink, at 18 s, which takes half a second more. */
const STORM_WAIT_MS = 30_000;
const STORM_STEP_MS = 6_000;
const ROUNDS_MS = 120_000;
const STEER_MS = 350;
const WINS = new Set(['won', 'wonByRingOut']);
/** docs/protocol.md, "Prediction": over 5 s of walking, a mean error under 8 units and fewer than 2 snaps. */
const NET_WALK = ['d', 'a', 'd', 'a', 's', 'w', 's', 'w'];
const NET_WALK_MS = 5_000;
const NET_MEAN_ERROR = 8;
const NET_SNAPS = 2;
/** The wild creature's level, and a stronger one to befriend, which a few hits weaken without beating. */
const WILD_LEVEL = 3;
const BEFRIEND_LEVEL = 8;
/** Treats a befriend run carries: a throw can still miss a wild creature on the run, and each miss is tried again. */
const BEFRIEND_TREATS = 8;
/** The share of its health the 360px runs' lead starts with: hurt enough for the shrine's arrow. */
const HURT_SHARE = 0.5;
const TAG = runTag();

/**
 * The runs of each browser: a phone, a tablet and 360px, the languages crossed so each is seen in
 * both, and each way to steer: touches on the stick (a mouse in WebKit, which has no touch
 * drag), and the keys. Each browser waits for the storm on one of phone and tablet and befriends
 * on the other, so both are seen on both. The 360px player's creature is too young for button 3,
 * asks for reduced motion and holds Leave.
 * The best of 3 runs (`rounds`) take the other language of their place, so each player's name is new.
 * Chromium's 360px best of 3 has the player's sounds off: its taps, countdown, hits and results
 * record no sound and never call `navigator.vibrate`. Every other wild and best of 3 run checks the
 * sounds its fight played (`WANTED_SOUNDS`).
 */
const RUNS = {
  chromium: [
    { where: 'iphone-portrait', language: 'en', steer: 'touch', level: 20, plan: 'storm', lagMs: 0 },
    { where: 'ipad-landscape', language: 'sl', steer: 'keys', level: 20, plan: 'befriend', lagMs: 150 },
    { where: '360px', language: 'sl', steer: 'touch', level: ARENA.buttons[1], plan: 'leave', lagMs: 50 },
    { where: 'iphone-portrait', language: 'sl', steer: 'touch', level: 20, plan: 'rounds', lagMs: 0 },
    { where: '360px', language: 'en', steer: 'keys', level: 20, plan: 'rounds', lagMs: 0, sounds: false },
    { where: 'iphone-portrait', language: 'sl', steer: 'touch', level: 20, plan: 'trainer', lagMs: 0 },
  ],
  webkit: [
    { where: 'iphone-portrait', language: 'sl', steer: 'keys', level: 20, plan: 'befriend', lagMs: 50 },
    { where: 'ipad-landscape', language: 'en', steer: 'mouse', level: 20, plan: 'storm', lagMs: 150 },
    { where: '360px', language: 'en', steer: 'keys', level: ARENA.buttons[1], plan: 'leave', lagMs: 0 },
    { where: 'ipad-landscape', language: 'sl', steer: 'mouse', level: 20, plan: 'rounds', lagMs: 0 },
    { where: 'ipad-landscape', language: 'en', steer: 'mouse', level: 20, plan: 'trainer', lagMs: 0 },
  ],
}[chosen.name];

/** A best of 3's team: four creatures with the second fainted, so the defaults are places 0, 2 and 3. Its opponents are weak, so a round is won soon. */
const ROUNDS_TEAM = [STARTERS[0], STARTERS[1], STARTERS[2], STARTERS[0]];
const FAINTED_PLACE = 1;
const DEFAULT_PICKS = [0, 2, 3];
const PRACTICE = STARTERS.slice(0, 3).map((species) => ({ species, level: 2 }));
/** The trainer the trainer runs fight, the character they talk to, and the level the check makes her creatures, so a round is won soon. */
const TRAINER = 'vetrinka';
const EASY_TRAINER_LEVEL = 2;
const QUESTS = JSON.parse(readFileSync(join(ROOT, 'content/quests.json'), 'utf8')).quests.map((quest) => quest.id);
const DIALOGUE = JSON.parse(readFileSync(join(ROOT, `content/dialogue/${TRAINER}.json`), 'utf8'));
/** The nodes of the trainer's talk: the challenge, and the lines after a win. */
const CHALLENGE = DIALOGUE.entries.find((entry) => (entry.if ?? []).some((condition) => condition.canFight === TRAINER)).node;
const FIGHT = Object.entries(DIALOGUE.nodes).find(([, node]) => node.fight === TRAINER)[1];

const lines = [];
const dataDir = mkdtempSync(join(tmpdir(), 'nebotok-arena-check-'));
const config = readConfig({ NODE_ENV: 'production', DATA_DIR: dataDir, ARENA_BATTLES: 'on', LOG_LEVEL: 'info' });
const log = createLog('info', (line) => lines.push(JSON.parse(line)));
const services = easyTrainers(createServices(config, Date.now, log));
/** The fake lag of the run now, which the arena room gives each player as they join (runs go one at a time). */
let lagMs = 0;
const gameServer = createGameServer(config, log, services, { fakeLagMs: () => lagMs });
const port = await freePort();
await gameServer.listen(port, '127.0.0.1');
const base = `http://127.0.0.1:${port}`;
const allowedHost = new URL(base).host;
const world = services.world;
/** The first species, by id, of a type the first starter's type is strong against, so its hits show "!". */
const starterType = SPECIES.find((species) => species.id === STARTERS[0]).type;
const strongAgainst = TYPES.find((type) => type.id === starterType).strongAgainst;
const wildSpecies = SPECIES.filter((species) => strongAgainst.includes(species.type))
  .map((species) => species.id)
  .toSorted()[0];
if (!wildSpecies) throw new Error(`arena-check: no species is weak to ${starterType}`);
/** The wild creature's favourite treat, which befriend runs carry, opens the Treat button under this share of its health. */
const favourite = ITEMS.find((item) => item.id === SPECIES.find((species) => species.id === wildSpecies).favouriteTreat);
const TREAT_WINDOW_PERCENT = treatWindowPercent({ liking: 'favourite', strength: favourite.strength ?? 0 }, ARENA);
const results = [];

/** `services` with every trainer's creatures at EASY_TRAINER_LEVEL, each with a wild creature's buttons at that level. */
function easyTrainers(real) {
  const arena = arenaContentOf(real.world.battle);
  const { story } = real.world;
  const easy = (trainer) => ({ ...trainer, creatures: trainer.creatures.map(({ species }) => ({ species, level: EASY_TRAINER_LEVEL, loadout: wildLoadout(species, EASY_TRAINER_LEVEL, arena) })) });
  const trainers = new Map([...story.trainers].map(([id, trainer]) => [id, easy(trainer)]));
  return { ...real, world: { ...real.world, story: { ...story, trainers } } };
}

/** A walkable tile beside the trainer's character, out of the grass, for a trainer run to stand on. */
function besideTrainer() {
  const at = world.story.trainers.get(TRAINER) && world.map.npcs[world.story.trainers.get(TRAINER).npc];
  const beside = at && [{ x: at.x, y: at.y + 1 }, { x: at.x - 1, y: at.y }, { x: at.x + 1, y: at.y }, { x: at.x, y: at.y - 1 }].find((tile) => isWalkable(world.map, tile) && encounterZoneAt(world.map, tile) === null);
  if (!beside) throw new Error(`arena-check: nowhere to stand beside ${TRAINER}`);
  return beside;
}

/** The wild creature a run meets. */
const wildOf = (run) => ({ species: wildSpecies, level: run.plan === 'befriend' ? BEFRIEND_LEVEL : WILD_LEVEL });

/** A player standing at the spawn with `team` (two creatures of `level`) and treats (the wild creature's favourite, to befriend it), saved in this server's database. */
async function preparePlayer(run, team = [newCreature(STARTERS[0], run.level, world.battle), newCreature(STARTERS[1], run.level, world.battle)]) {
  const trainer = run.plan === 'trainer';
  const name = (trainer ? trainerName : arenaName)(chosen.name, run.where, run.language, TAG);
  const made = await services.profiles.create({ name, avatar: 'green' });
  if (!made.ok) throw new Error(`arena-check: making ${name}: ${made.error}`);
  const position = { map: world.map.id, ...(trainer ? besideTrainer() : world.map.spawns[PLAYER_SPAWN]), facing: 'down' };
  const treat = run.plan === 'befriend' ? SPECIES.find((species) => species.id === wildSpecies).favouriteTreat : 'plain-treat';
  // A trainer run's player is past the whole story, so the trainer's challenge is the talk that opens.
  const story = trainer ? { active: [], done: QUESTS, flags: ['grey-letter-read', 'storm-seen', 'chapter-1-done'] } : emptyProgress().story;
  const progress = { ...emptyProgress(), team, inventory: [{ item: treat, count: run.plan === 'befriend' ? BEFRIEND_TREATS : 3 }], story };
  services.progress.save(made.value.id, createSave({ settings: { ...defaultSettings(), sounds: run.sounds ?? true }, name, language: run.language, createdAt: new Date().toISOString(), position, ...progress }));
  return { id: made.value.id, name };
}

/** Starts the wild fight in the world room the player is in: only that room knows them. */
async function startFight(playerId, wild) {
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

/** Each arena button on screen: its action, size, the pictures it holds and the width of each, in CSS pixels. */
const arenaButtons = (page) =>
  page.locator('#arena .arena-button:visible, #arena .arena-leave:visible').evaluateAll((items) =>
    items.map((item) => {
      const box = item.getBoundingClientRect();
      const shown = [...item.querySelectorAll('[data-picture]')];
      const pictures = shown.map((picture) => picture.dataset.picture);
      const widths = shown.map((picture) => Math.round(picture.getBoundingClientRect().width));
      return { action: item.dataset.action ?? 'leave', width: Math.round(box.width), height: Math.round(box.height), pictures, widths, shape: item.querySelector('[data-shape]')?.dataset.shape ?? null, disabled: item.disabled };
    }),
  );

/** The big lock and the large digits of its level that a locked button shows (docs/arena.md, "Screens and controls"). */
const LOCK_PX = 48;
const LOCK_DIGIT_PX = 32;

/** What is wrong with a locked button's pictures: the lock under `LOCK_PX`, or its level not in digits of `LOCK_DIGIT_PX`. */
function lockProblems(button, level) {
  const sized = (id) => button.widths.filter((_, at) => button.pictures[at] === id);
  const lock = sized('pictures/lock');
  const digits = sized('pictures/digits');
  const readable = lock.length === 1 && lock[0] >= LOCK_PX && digits.length === String(level).length && digits.every((width) => width >= LOCK_DIGIT_PX);
  return readable ? [] : [`locked button ${Number(button.action) + 1} shows its lock and level ${level} as ${JSON.stringify({ pictures: button.pictures, widths: button.widths })}`];
}

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

const KEYS = { right: 'd', left: 'a', down: 's', up: 'w' };
function keysToward(push) {
  const held = [];
  if (push.x > 0.38) held.push(KEYS.right);
  if (push.x < -0.38) held.push(KEYS.left);
  if (push.y > 0.38) held.push(KEYS.down);
  if (push.y < -0.38) held.push(KEYS.up);
  return held;
}

/** The way back to the island's middle, once your creature has strayed from it. */
function towardMiddle(state) {
  const mine = state.arena?.mine;
  const length = mine ? Math.hypot(mine.x, mine.y) : 0;
  return length > 80 * 256 ? { x: -mine.x / length, y: -mine.y / length } : null;
}

/** Each button a step may press: its selector to tap and its key. */
const PRESSES = { one: { tap: '.arena-button.ability-1', key: '1' }, three: { tap: '.arena-button.ability-3', key: '3' }, treat: { tap: '.arena-button.treat', key: 'e' } };
const buttonOf = (state, action) => state.arena?.buttons.find((each) => String(each.action) === String(action));
const treatShown = (state) => buttonOf(state, 'treat')?.shown === true;
const ended = (state) => state.arena?.result != null;
const toneOf = (level, other) => (level > other ? 'higher' : level < other ? 'lower' : 'even');

/** Plans of a step: where to push and which button to press. */
const attack = (state) => ({ push: towardWild(state), press: towardWild(state) ? 'one' : null });
/** Keeps to the middle without hitting, and calls the weather with button 3. */
const holdOff = (state) => ({ push: towardMiddle(state), press: buttonOf(state, 2)?.locked === false ? 'three' : null });
/** Whether the wild creature is under the treat's window, so a treat can befriend it. */
const weakEnough = (state) => state.arena?.theirs != null && state.arena.theirs.health * 100 < TREAT_WINDOW_PERCENT * state.arena.theirs.max;
/** Befriend runs throw from no farther than this, in 1/256 units, so the wild creature has little time to step out of the treat's way. */
const THROW_WITHIN = 200 * 256;
/** They throw only when the keys point within this angle of the wild creature, well inside the aim help's 30 degrees. */
const THROW_COSINE = Math.cos((15 * Math.PI) / 180);
/** How long after a state its throw reaches the server, beyond the round trip: a send, a state patch and a frame. */
const THROW_LATE_MS = 100;
const TICK_MS = 1000 / 60;

/** The unit push the keys toward `push` steer. */
function keysPush(push) {
  const held = keysToward(push);
  const x = (held.includes(KEYS.right) ? 1 : 0) - (held.includes(KEYS.left) ? 1 : 0);
  const y = (held.includes(KEYS.down) ? 1 : 0) - (held.includes(KEYS.up) ? 1 : 0);
  const length = Math.hypot(x, y);
  return length === 0 ? null : { x: x / length, y: y / length };
}

/**
 * A befriend run's plan: weakens the wild creature until it is under the treat's window, then never
 * hits it there, since the Treat button hides while a thrown treat flies or a missed one lies on the
 * ground and a few hits then would knock it out. It follows the wild creature and throws when near,
 * aimed where the wild creature will be once the throw reaches the server: its states arrive a round
 * trip late at 150 ms of lag, by when it has run a good way past where the page shows it.
 */
function befriender() {
  let before = null;
  return (state) => {
    const { mine, theirs, tick, net } = state.arena ?? {};
    const was = before;
    before = mine && theirs ? { tick, x: theirs.x - mine.x, y: theirs.y - mine.y } : null;
    if (!weakEnough(state)) return attack(state);
    if (!before || !was || tick <= was.tick || !treatShown(state)) return { push: towardWild(state), press: null };
    const ahead = ((net?.rttMs ?? 0) + THROW_LATE_MS) / TICK_MS / (tick - was.tick);
    const lead = { x: before.x + (before.x - was.x) * ahead, y: before.y + (before.y - was.y) * ahead };
    const distance = Math.hypot(lead.x, lead.y);
    if (distance === 0) return { push: towardWild(state), press: null };
    const push = { x: lead.x / distance, y: lead.y / distance };
    const keyed = keysPush(push);
    const aimed = keyed !== null && keyed.x * push.x + keyed.y * push.y > THROW_COSINE;
    return { push, press: aimed && distance < THROW_WITHIN ? 'treat' : null };
  };
}
/** Whether your creature on screen stands anywhere but `at`. */
const movedFrom = (at) => (state) => state.arena?.mine != null && (state.arena.mine.x !== at.x || state.arena.mine.y !== at.y);

/** Steers and presses until `stopWhen`, the way `run.steer` says: `plan` picks each step's push and button, and `seen` looks at each state first. */
async function fightOn(page, run, { endsBy, stopWhen, plan = attack, seen = async () => {} }) {
  const { width, height } = page.viewportSize();
  const origin = { x: Math.round(width * 0.22), y: Math.round(height * 0.72) };
  const thumb = run.steer === 'keys' ? null : await makeThumb(page, chosen.name);
  const keys = { held: [] };

  /** One push and one press, by thumb or by keys. */
  async function step({ push, press }) {
    if (thumb) {
      if (push) {
        await thumb.down(origin);
        await thumb.move({ x: origin.x + push.x * 50, y: origin.y + push.y * 50 });
        await sleep(STEER_MS);
        await thumb.up();
      } else await sleep(STEER_MS);
      if (press && !stopWhen(await readState(page))) await page.locator(`#arena ${PRESSES[press].tap}`).tap({ timeout: 2_000 }).catch(() => {});
      return;
    }
    const next = push ? keysToward(push) : [];
    await inTurn(keys.held.filter((key) => !next.includes(key)), (key) => page.keyboard.up(key));
    await inTurn(next.filter((key) => !keys.held.includes(key)), (key) => page.keyboard.down(key));
    keys.held = next;
    if (press) await page.keyboard.press(PRESSES[press].key);
    await sleep(STEER_MS / 2);
  }

  async function onward(state) {
    if (stopWhen(state) || Date.now() >= endsBy) return state;
    await seen(state);
    await step(plan(state));
    return onward(await readState(page));
  }

  const state = await onward(await readState(page));
  await inTurn(keys.held, (key) => page.keyboard.up(key));
  return state;
}

/**
 * Five seconds of scripted walking, back and forth so it never nears the edge, at the run's fake
 * lag: what the net meters measured over them, the window's mean prediction error and snaps.
 */
async function measureNet(page) {
  const before = (await readState(page)).arena?.net;
  await inTurn(NET_WALK, async (key) => {
    await page.keyboard.down(key);
    await sleep(NET_WALK_MS / NET_WALK.length);
    await page.keyboard.up(key);
  });
  await sleep(500);
  const after = (await readState(page)).arena?.net;
  if (!before || !after) return null;
  const samples = after.samples - before.samples;
  return { rttMs: Math.round(after.rttMs), lead: after.lead, samples, meanError: samples > 0 ? (after.errorSum - before.errorSum) / samples : 0, snaps: after.snaps - before.snaps, knocked: after.knocked - before.knocked, worstError: after.worstError };
}

/**
 * Runs in the page: holds the first strong hit's number at its biggest until the check has taken
 * its picture, since a number fades out within a second, quicker than a step of the check.
 */
function holdStrongNumber() {
  const layer = document.querySelector('#arena .arena-popups');
  const watcher = new MutationObserver((changes) => {
    const pop = changes.flatMap((change) => [...change.addedNodes]).find((node) => node.dataset?.tone === 'strong');
    if (!pop) return;
    watcher.disconnect();
    for (const each of pop.getAnimations()) {
      each.pause();
      each.currentTime = 150;
    }
    window.strongNumberHeld = true;
  });
  watcher.observe(layer, { childList: true });
}

/** Holds Leave for longer than its second, by touch in Chromium and by mouse in WebKit. */
async function holdLeave(page) {
  const at = await centre(page, '#arena .arena-leave');
  if (!at) throw new Error('Leave is not on the screen');
  const thumb = await makeThumb(page, chosen.name);
  await thumb.down(at);
  await sleep(1_400);
  await thumb.up();
}

/** What is wrong with the fight on screen: its cards, its buttons' sizes and pictures, and what the scene drew. */
async function fightProblems(page, state, run) {
  const problems = [];
  const { arena } = state;
  const wild = wildOf(run);
  const badge = await page.locator('#arena .arena-card.mine .arena-level').textContent();
  const wantedBadge = STRINGS['battle.level'][run.language].replace('{level}', String(run.level));
  if (badge !== wantedBadge) problems.push(`your card's level badge says "${badge}", not "${wantedBadge}"`);
  const tones = await page.locator('#arena .arena-card .arena-level').evaluateAll((badges) => badges.map((each) => each.dataset.tone));
  const wantedTones = [toneOf(run.level, wild.level), toneOf(wild.level, run.level)];
  if (tones.join() !== wantedTones.join()) problems.push(`the level badges are ${tones.join(' and ')}, not ${wantedTones.join(' and ')}`);
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
  if (third && locked) problems.push(...lockProblems(third, ARENA.buttons[2]));
  // Only your creature that came in hurt (wildTeam) gets the arrow to the shrine, never the wild one.
  const hurt = run.plan === 'leave';
  if (arena.mine?.rest !== hurt || arena.theirs?.rest !== false) problems.push(`the cards point to the shrine as ${JSON.stringify([arena.mine?.rest, arena.theirs?.rest])}, with your creature ${hurt ? '' : 'not '}hurt`);
  const shrine = await page.locator('#arena .arena-card.mine .arena-rest:visible [data-picture="tiles/shrine"]').count();
  if (shrine !== (hurt ? 1 : 0)) problems.push(`your card shows ${shrine} shrine pictures, with your creature ${hurt ? '' : 'not '}hurt`);
  const first = buttons.find((button) => button.action === '0');
  if (first && first.shape === null) problems.push(`button 1 shows ${JSON.stringify(first.pictures)}, not its move's shape`);
  return problems;
}

/**
 * A run's player, prepared with `team`, and its page on the run's device and language: `tab`, with
 * what it found wrong, its notes and screenshots, and `signIn` to the world as that player.
 */
async function openRun(browser, run, team) {
  const label = `${chosen.name}-${run.where}-${run.language}${run.plan === 'rounds' || run.plan === 'trainer' ? `-${run.plan}` : ''}`;
  const problems = [];
  const notes = [];
  const screenshots = [];
  const expect = (ok, message) => {
    if (!ok) problems.push(message);
  };
  lagMs = run.lagMs;
  const player = await preparePlayer(run, team);
  const device = DEVICES.find((each) => each.name === run.where);
  const reducedMotion = run.plan === 'leave' ? 'reduce' : 'no-preference';
  const contextOptions = device ? { ...device.descriptor, reducedMotion } : { viewport: NARROW, hasTouch: true, isMobile: chosen.name === 'chromium', reducedMotion };
  const context = await browser.newContext(contextOptions);
  await context.addInitScript(presetLanguage, run.language);
  await context.addInitScript(reportCspViolations);
  if (run.sounds === false) await context.addInitScript(countVibrations);
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
    // The net meters are for the wild fights' walk; the pick screen is checked without them.
    await tab.goto(`${base}/?test=1${run.plan === 'rounds' || run.plan === 'trainer' ? '' : '&net=1'}`);
    await until(tab, (s) => s.screen === 'profiles', 'the profile list');
    await tab.locator(`.profile-card[data-profile-id="${player.id}"]`).tap();
    await until(tab, (s) => s.screen === 'world' && s.connection === 'connected' && s.progress?.team.length === (team?.length ?? 2), 'the world as the arena player');
  };
  return { label, player, tab, problems, notes, screenshots, expect, shot, fits, signIn, close: () => context.close() };
}

/**
 * In the page: `navigator.vibrate` only counts its calls, in `window.vibrations`. It stays
 * writable because Phaser's device check assigns `navigator.vibrate` to itself as it starts.
 */
function countVibrations() {
  window.vibrations = 0;
  Object.defineProperty(navigator, 'vibrate', {
    configurable: true,
    writable: true,
    value: () => {
      window.vibrations += 1;
      return true;
    },
  });
}

const HIT_SOUNDS = ['arena.hit', 'arena.hit.strong', 'arena.hit.weak'];
/**
 * The sounds a run's fight must play with the player's sounds on, one of each list: a hit (under
 * reduced motion too), the storm's warning and a step of it or a ring-out, the treat thrown, "Go!",
 * a round's end, and the result's stinger. A befriending's own sound is its stinger; a run has none.
 */
const WANTED_SOUNDS = {
  leave: [HIT_SOUNDS],
  storm: [HIT_SOUNDS, ['arena.storm.warn'], ['arena.storm.step', 'arena.ringout'], ['arena.fight.won']],
  befriend: [HIT_SOUNDS, ['arena.treat.throw'], ['arena.befriend']],
  rounds: [HIT_SOUNDS, ['arena.go'], ['arena.round.won', 'arena.round.lost'], ['arena.fight.won']],
};
/** No more than this many sounds start in any 100 ms (apps/game/src/sound-burst.ts). */
const BURST_MOST = 6;

/** The most of `played` (the page's last sounds, at whole ms) that started within 100 ms of each other. */
const busiest = (played) => Math.max(0, ...played.map(({ at: from }) => played.filter(({ at }) => at >= from && at - from < 100).length));

/**
 * What a fight's sounds and buzzes should have been, at its result: none with the player's sounds
 * off, and with them on one of each of `WANTED_SOUNDS`, never more than `BURST_MOST` started in
 * 100 ms. `heardBefore` counts the sounds played before the player's settings arrived, such as the
 * tap on their profile card, when no one's setting is known yet.
 */
async function soundProblems(page, run, heardBefore) {
  if (run.sounds !== false) {
    const wanted = WANTED_SOUNDS[run.plan];
    const heard = (s) => wanted.every((any) => any.some((id) => s.arena?.sounds.includes(id)));
    // The fight's last events come with its room's state, which can reach the page after the result.
    const state = (await until(page, heard, 'the fight\'s sounds', 3_000).catch(() => null)) ?? (await readState(page));
    const problems = [];
    if (!heard(state)) problems.push(`the fight played ${JSON.stringify(state.arena?.sounds)}, not one of each of ${JSON.stringify(wanted)}`);
    const most = busiest(state.sounds.played);
    if (most > BURST_MOST) problems.push(`${most} sounds started within 100 ms: ${JSON.stringify(state.sounds.played)}`);
    return problems;
  }
  const state = await readState(page);
  const played = state.sounds.played.slice(heardBefore).map((each) => each.id);
  const vibrations = await page.evaluate(() => window.vibrations);
  const problems = [];
  if (state.sounds.on !== false) problems.push(`sounds are ${JSON.stringify(state.sounds)} for a player who turned them off`);
  if (played.length > 0) problems.push(`with sounds off the page recorded ${JSON.stringify(played)}`);
  if (vibrations !== 0 || state.arena.buzzes !== 0) problems.push(`with sounds off the page buzzed ${state.arena.buzzes} times and called navigator.vibrate ${vibrations} times`);
  return problems;
}

/**
 * A wild run's team: the 360px runs' lead comes in at half health, as after an earlier fight, so
 * its card points to the shrine. Those runs only leave; a lead that lost health is knocked further,
 * so a hurt lead in a run that must win or befriend can be knocked off the island and swapped out.
 */
function wildTeam(run) {
  const lead = newCreature(STARTERS[0], run.level, world.battle);
  const hurt = run.plan === 'leave' ? { hp: Math.floor(maxHpOf(lead, world.battle) * HURT_SHARE) } : {};
  return [{ ...lead, ...hurt }, newCreature(STARTERS[1], run.level, world.battle)];
}

async function checkRun(browser, run) {
  const opened = await openRun(browser, run, wildTeam(run));
  const { label, player, tab: page, problems, notes, screenshots, expect, shot, fits } = opened;
  try {
    await opened.signIn();
    const heardBefore = run.sounds === false ? (await until(page, (s) => s.sounds?.on === false, 'the player\'s sounds turned off')).sounds.played.length : 0;
    const fightId = await startFight(player.id, wildOf(run));
    let state = await until(page, (s) => s.screen === 'arena' && s.arena?.joined && s.arena.phase === 'fighting' && s.arena.drawn !== null && s.arena.mine !== null, 'the arena fight on screen', 15_000);
    expect(state.arena.fightId === fightId && state.arena.mode === 'wild' && state.arena.side === 0, `the page shows fight ${JSON.stringify(state.arena)}, not ${fightId}`);
    expect(state.players.find((each) => each.self)?.inBattle === true, 'your courier is not shown fighting');
    if (run.sounds !== false) {
      const cry = `cry:${wildSpecies}`;
      const cried = await until(page, (s) => s.sounds.played.some((each) => each.id === cry), `the wild ${wildSpecies}'s cry`, 5_000).catch(() => readState(page));
      expect(cried.sounds.played.some((each) => each.id === cry), `the wild ${wildSpecies} came onto the island and recorded ${JSON.stringify(cried.sounds.played.map((each) => each.id))}, no ${cry}`);
    }
    await nextFrames(page);
    for (const problem of await fightProblems(page, state, run)) problems.push(problem);
    await fits('the arena fight');
    const net = await measureNet(page);
    if (net) {
      notes.push(`at ${run.lagMs} ms of lag: round trip ${net.rttMs} ms, lead ${net.lead}, mean error ${net.meanError.toFixed(2)} over ${net.samples} corrections (worst ${net.worstError.toFixed(1)}), ${net.snaps} snaps, ${net.knocked} while knocked`);
      // Headless browsers draw few frames on software WebGL, and the prediction hears a state once a frame.
      expect(net.samples > 20, `the prediction heard only ${net.samples} states in 5 s`);
      expect(net.meanError < NET_MEAN_ERROR, `the mean prediction error at ${run.lagMs} ms was ${net.meanError.toFixed(2)}, not under ${NET_MEAN_ERROR}`);
      expect(net.snaps < NET_SNAPS, `the prediction snapped ${net.snaps} times at ${run.lagMs} ms`);
      expect(net.rttMs >= run.lagMs, `the round trip shows ${net.rttMs} ms at ${run.lagMs} ms of lag`);
    } else problems.push('the test hook shows no net meters');
    const meters = (await page.locator('#arena .arena-net').textContent()) ?? '';
    expect(await page.locator('#arena .arena-net').isVisible(), 'the net meters are not on screen with net=1');
    expect(/\d+ ms/.test(meters), `the net meters say "${meters}"`);
    await shot('0-net');
    state = await readState(page);
    const startedAt = state.arena.mine;
    /** Takes one picture of the first strong hit's number, which `holdStrongNumber` holds still for it. */
    const strong = { shot: false };
    await page.evaluate(holdStrongNumber);
    const seen = async () => {
      if (strong.shot || !(await page.evaluate(() => window.strongNumberHeld === true))) return;
      strong.shot = true;
      await shot('2-strong-hit');
      await page.evaluate(() => document.querySelectorAll('#arena .arena-pop').forEach((pop) => pop.getAnimations().forEach((each) => each.play())));
    };
    if (run.plan === 'leave') {
      // Hits during the walk above count for the juice, but this waits for one of its own. A hit's
      // number comes with the room's events, before the state patch that moves your creature.
      const popups = state.arena?.drawn?.juice.popups ?? 0;
      const hit = (s) => ended(s) || ((s.arena?.drawn?.juice.popups ?? 0) > popups && movedFrom(startedAt)(s));
      const most = { shake: 0 };
      state = await fightOn(page, { ...run, steer: 'keys' }, { endsBy: Date.now() + 8_000, stopWhen: hit, seen: async (s) => void (most.shake = Math.max(most.shake, s.arena?.drawn?.juice.shake ?? 0)) });
      await shot('1-fight');
      const juice = state.arena?.drawn?.juice;
      notes.push(`reduced motion: ${JSON.stringify(juice)}`);
      expect(juice?.popups > 0, `no hit landed in 8 s to check reduced motion: ${JSON.stringify(juice)}`);
      expect(most.shake === 0 && juice?.shake === 0 && juice?.shaken === 0 && juice?.stops === 0 && juice?.sparks === 0, `under reduced motion a hit shook the island ${juice?.shaken}px, held ${juice?.stops} hit-stops and threw ${juice?.sparks} sparks`);
      await holdLeave(page);
    } else {
      state = await fightOn(page, run, { endsBy: Date.now() + 2_500, stopWhen: (s) => ended(s) || (run.plan === 'storm' && strong.shot), seen });
      await shot('1-fight');
      if (run.plan === 'storm') {
        state = await fightOn(page, run, { endsBy: Date.now() + STORM_WAIT_MS, stopWhen: (s) => ended(s) || s.arena?.drawn?.warning === true, plan: holdOff });
        expect(state.arena?.drawn?.warning === true, `the storm's warning never showed: ${JSON.stringify(state.arena?.drawn)}`);
        await nextFrames(page);
        await shot('3-storm-warning');
        state = await fightOn(page, run, { endsBy: Date.now() + STORM_STEP_MS, stopWhen: (s) => ended(s) || s.arena?.sounds.includes('arena.storm.step'), plan: holdOff });
        const called = MOVES.find((move) => move.id === buttonOf(state, 2)?.move)?.setsWeather ?? null;
        const weather = await page.locator('#arena .arena-weather:visible').getAttribute('data-weather', { timeout: 2_000 }).catch(() => null);
        expect(called !== null && weather === called, `the weather corner shows ${weather} after button 3 called ${called}`);
      }
      state = await fightOn(page, run, { endsBy: Date.now() + FIGHT_MS, stopWhen: ended, plan: run.plan === 'befriend' ? befriender() : attack, seen });
      if (run.plan === 'befriend' && ended(state)) {
        // The hearts rise one after another for half a second, while the result waits.
        await sleep(500);
        await shot('3-befriend');
      }
      expect(strong.shot, 'no strong hit showed its number');
      const juice = state.arena?.drawn?.juice;
      notes.push(`juice: ${JSON.stringify(juice)}`);
      expect(juice?.shaken > 0 && juice?.stops > 0 && juice?.sparks > 0, `the hits shook the island ${juice?.shaken}px, held ${juice?.stops} hit-stops and threw ${juice?.sparks} sparks`);
    }
    expect(state.arena?.result != null || movedFrom(startedAt)(state), `your creature never moved from ${JSON.stringify(startedAt)}`);
    expect((state.arena?.inputs ?? 0) > 20 && (run.plan === 'leave' || (state.arena?.presses ?? 0) > 0), `the page sent ${state.arena?.inputs} inputs with ${state.arena?.presses} presses`);
    state = await until(page, ended, 'the fight result', 10_000);
    const outcome = state.arena.result.outcome?.result ?? null;
    notes.push(`${outcome} after ${state.arena.inputs} inputs and ${state.arena.presses} presses, ${state.arena.buzzes} buzzes, sounds ${run.sounds === false ? 'off' : 'on'}`);
    for (const problem of await soundProblems(page, run, heardBefore)) problems.push(problem);
    notes.push(`sounds: ${JSON.stringify(state.arena.sounds)}`);
    const wantedOutcome = { leave: ['ran'], befriend: ['befriended'], storm: [...WINS] }[run.plan];
    expect(wantedOutcome.includes(outcome), `the fight ended with ${outcome}, not ${wantedOutcome.join(' or ')}`);
    if (WINS.has(outcome)) expect(state.arena.result.rewards.length > 0, 'a won fight gave no experience');
    await page.locator('#arena .arena-continue').waitFor({ state: 'visible', timeout: 5_000 });
    await nextFrames(page);
    const line = (await page.locator('#arena .arena-result-line').textContent())?.trim();
    const wildName = SPECIES.find((species) => species.id === wildSpecies).name[run.language];
    const wantedLine = { leave: STRINGS['battle.ranAway'][run.language], befriend: STRINGS['battle.befriended'][run.language].replace('{creature}', wildName), storm: STRINGS['battle.won'][run.language] }[run.plan];
    expect(line === wantedLine, `the result says "${line}", not "${wantedLine}"`);
    const picture = await page.locator('#arena .arena-result-picture').getAttribute('data-picture');
    const wantedPicture = { leave: 'leave', befriend: 'heart', storm: outcome === 'wonByRingOut' ? 'ring-out' : 'trophy' }[run.plan];
    expect(picture === `pictures/${wantedPicture}`, `the result shows the picture ${picture}`);
    await fits('the arena result');
    await shot('4-result');
    await page.locator('#arena .arena-continue').tap();
    state = await until(page, (s) => s.screen === 'world' && s.arena === null && s.players.find((each) => each.self)?.inBattle === false, 'the world after the fight', 10_000);
    await nextFrames(page);
    expect(!(await page.locator('#arena').isVisible()), 'the arena screen stays after Continue');
    const saved = services.progress.load(player.id)?.data;
    const reward = state.arena === null && WINS.has(outcome) ? (await readState(page)).progress?.team[0] : null;
    if (reward) expect(saved?.team[0]?.xp === reward.xp && saved?.team[0]?.level === reward.level, `the page shows ${JSON.stringify(reward)} after the fight, not the saved ${JSON.stringify(saved?.team[0])}`);
    // A fight keeps the health it left; once a bar is no longer green, the team button shows the shrine.
    const team = (await readState(page)).progress?.team ?? [];
    const hurt = team.some((creature) => Math.round((100 * creature.hp) / maxHpOf(creature, world.battle)) <= 50);
    const marked = await page.locator('.team-button').getAttribute('data-hurt');
    expect(marked === String(hurt), `the team button's shrine says hurt ${marked} for the team ${JSON.stringify(team.map(({ species, hp }) => [species, hp]))}`);
    await shot('5-world');
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
    items.map((item) => ({
      place: Number(item.dataset.place),
      disabled: item.disabled,
      portrait: Math.round(item.querySelector('canvas')?.getBoundingClientRect().width ?? 0),
      weather: item.querySelector('[data-picture^="weather"]') !== null,
      level: item.querySelector('.arena-level')?.textContent ?? '',
      shrine: item.querySelector('.rest-hint [data-picture="tiles/shrine"]') !== null,
    })),
  );
  if (choices.length !== ROUNDS_TEAM.length) problems.push(`the pick screen shows ${choices.length} creatures, not ${ROUNDS_TEAM.length}`);
  for (const choice of choices) {
    if (choice.portrait < 64) problems.push(`the creature at place ${choice.place} has a ${choice.portrait}px portrait, under 64px`);
    if (choice.disabled !== (choice.place === FAINTED_PLACE)) problems.push(`the creature at place ${choice.place} is ${choice.disabled ? '' : 'not '}greyed out`);
    if (choice.shrine !== (choice.place === FAINTED_PLACE)) problems.push(`the creature at place ${choice.place} ${choice.shrine ? 'points' : 'does not point'} to the shrine`);
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
 * Fights each round of the best of 3 on screen from `state` to the end, checking the score between
 * rounds (`2-score` the first time), then that it was won, its result (`3-result`), and continues.
 */
async function winRounds(opened, run, state) {
  const { tab, problems, notes, expect, shot, fits } = opened;
  const endsBy = Date.now() + ROUNDS_MS;
  let pauses = 0;
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
  await fightRounds(state);
  const last = await until(tab, ended, 'the best of 3 result', 10_000);
  const outcome = last.arena.result.outcome?.result ?? null;
  notes.push(`${outcome} ${last.arena.score.join(' to ')} in ${last.arena.result.rounds?.length ?? '?'} rounds after ${last.arena.inputs} inputs`);
  expect(outcome === 'won', `the best of 3 ended with ${outcome}, not a win`);
  expect(pauses >= 1, 'the score never showed between rounds');
  if (run.plan === 'rounds') {
    for (const problem of await soundProblems(tab, run, opened.heardBefore)) problems.push(problem);
    notes.push(`sounds ${run.sounds === false ? 'off' : 'on'}: ${JSON.stringify((await readState(tab)).arena?.sounds)}`);
  }
  await tab.locator('#arena .arena-continue').waitFor({ state: 'visible', timeout: 5_000 });
  const picture = await tab.locator('#arena .arena-result-picture').getAttribute('data-picture');
  expect(picture === 'pictures/trophy', `the result shows the picture ${picture}`);
  await fits('the best of 3 result');
  await shot('3-result');
  await tab.locator('#arena .arena-continue').tap();
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
    opened.heardBefore = run.sounds === false ? (await until(tab, (s) => s.sounds?.on === false, 'the player\'s sounds turned off')).sounds.played.length : 0;
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
    await winRounds(opened, run, state);
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

/**
 * A trainer's best of 3 from a talk: the trainer's challenge (`1-challenge`), the choice that
 * fights and the line before it, the pick screen with the defaults, each round, the result, and
 * then the talk again at the fight's won line (`4-won`), with the first win's treats, flag and
 * experience saved.
 */
async function checkTrainerRun(browser, run) {
  const team = STARTERS.map((species) => newCreature(species, run.level, world.battle));
  const opened = await openRun(browser, run, team);
  const { tab, problems, notes, expect, shot, fits } = opened;
  const trainer = world.story.trainers.get(TRAINER);
  try {
    await opened.signIn();
    const served = await servedMap(base, world.map.id);
    const talk = await openTalk(tab, served, trainer.npc, { notes });
    expect(talk.talk.node === CHALLENGE, `${trainer.npc}'s talk opens at ${talk.talk.node}, not her challenge ${CHALLENGE}`);
    const seen = async (state) => {
      if (state.talk.node !== CHALLENGE) return;
      expect(state.talk.choices.some((choice) => choice.kind === 'fights' && choice.picture === 'challenge'), `the challenge shows no choice with the challenge picture: ${JSON.stringify(state.talk.choices)}`);
      await fits('the challenge');
      await shot('1-challenge');
    };
    await talkThrough(tab, { toward: (node) => node.fight === TRAINER, stop: (s) => s.screen === 'arena', seen });
    let state = await until(tab, (s) => s.screen === 'arena' && s.arena?.joined && s.arena.phase === 'picking' && s.arena.picks?.length === 3, 'the pick screen', 15_000);
    expect(state.arena.mode === 'rounds' && state.talk === null, `the trainer's fight shows ${JSON.stringify({ mode: state.arena.mode, talk: state.talk })}`);
    await tab.locator('#arena .arena-pick').waitFor({ state: 'visible', timeout: 5_000 });
    await tab.locator('#arena .arena-go').tap();
    state = await until(tab, (s) => s.arena?.phase === 'fighting' && s.arena.mine !== null, 'round 1', 10_000);
    await winRounds(opened, run, state);
    state = await until(tab, (s) => s.screen === 'world' && s.arena === null && s.talk?.node === FIGHT.won, `the talk again at ${FIGHT.won}`, 10_000);
    if (!state.talk.typed) await tab.locator('#talk .talk-line').tap();
    await until(tab, (s) => s.talk?.typed === true, 'the won line shown whole', 10_000);
    await nextFrames(tab);
    await fits('the won line');
    await shot('4-won');
    const saved = services.progress.load(opened.player.id)?.data;
    const { item } = trainer.reward;
    expect(saved?.story.flags.includes(trainer.flag), `the save has no flag ${trainer.flag}: ${JSON.stringify(saved?.story.flags)}`);
    expect(!item || saved?.inventory.some((entry) => entry.item === item.item && entry.count >= item.count), `the save has no ${JSON.stringify(item)}: ${JSON.stringify(saved?.inventory)}`);
    expect(saved?.team.some((creature) => creature.xp > 0 || creature.level > run.level), 'no creature got experience from the trainer');
    await talkThrough(tab);
  } catch (error) {
    problems.push(error.message.split('\n')[0]);
  } finally {
    await opened.close();
  }
  results.push({ label: `${opened.label} (trainer)`, ok: problems.length === 0, problems, notes, screenshots: opened.screenshots });
}

const CHECKS = { rounds: checkRoundsRun, trainer: checkTrainerRun };

try {
  const browser = await chosen.type.launch(chosen.options);
  try {
    await inTurn(RUNS, async (run) => {
      const started = performance.now();
      await (CHECKS[run.plan] ?? checkRun)(browser, run);
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
