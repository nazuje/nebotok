// The starter choice and the battle, team and storage screens, played the way a player would against
// the real server. A battle's outcome is the server's dice, so each part plays until it gets what it
// checks, within a bounded number of turns or battles: a team worn down to one point of health that
// only calls the weather loses, and treats a creature loves, offered once it is tired, befriend it.
// The player starts from a save the check prepares (scripts/lib/prepared-saves.mjs), so the team,
// the creature waiting at the shrine and the last shrine are known before the first step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TURN_BUDGET_MS } from '../../apps/game/src/battle-playback.ts';
import { MAX_TEAM, emptyStory, loadBattleContent, newCreature, spriteFor } from '../../packages/core/src/index.ts';
import { battleIdle, meetWildCreature, nextFrames, readState, until, walkByTaps } from './game-page.mjs';
import { ROOT } from './server-process.mjs';

const readContent = (path) => JSON.parse(readFileSync(join(ROOT, 'content', path), 'utf8'));
const CONTENT = loadBattleContent({
  weather: readContent('creatures/weather.json'),
  moves: readContent('creatures/moves.json'),
  species: readContent('creatures/species.json'),
  rules: readContent('creatures/battle-rules.json'),
  befriending: readContent('creatures/befriending.json'),
  items: readContent('items.json'),
});
const STARTERS = readContent('starters.json');
const TREATS = [...CONTENT.items.values()].filter((item) => item.kind === 'treat');
const MAX_TURNS = 40;
const MAX_BEFRIEND_BATTLES = 4;
/** Room for the page's clock, the server's reply and the check's polling on top of a turn's playback. */
const TURN_SLACK_MS = 700;
const TREATS_EACH = 10;

const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();
const nameOf = (species, language) => CONTENT.species.get(species)?.name[language] ?? species;
const apartBy = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
const worn = (creature, hp) => Object.assign(creature, { hp });

/**
 * The save the battles start from: the first starter worn down to one point of health and four
 * fainted creatures behind it (five, so a creature befriended fills the team), one creature waiting
 * in storage, ten of every treat, and the island's shrine as the last one rested at.
 */
export function battleSave(world, { name, language }) {
  const [fighter, ...others] = STARTERS.species;
  const resting = [...others, ...[...CONTENT.species.keys()].filter((id) => !STARTERS.species.includes(id))].slice(0, MAX_TEAM - 2);
  const stored = [...CONTENT.species.keys()].find((id) => id !== fighter && !resting.includes(id));
  const team = [worn(newCreature(fighter, STARTERS.level, CONTENT), 1), ...resting.map((id) => worn(newCreature(id, 3, CONTENT), 0))];
  const storage = [newCreature(stored, 4, CONTENT)];
  const owned = [...team, ...storage].map((creature) => creature.species);
  const shrine = Object.keys(world.map.shrines).toSorted()[0];
  if (!shrine) throw new Error(`${world.map.id} has no shrine to wake at`);
  return {
    shrine,
    data: {
      name,
      language,
      createdAt: new Date().toISOString(),
      position: null,
      team,
      storage,
      inventory: TREATS.map((item) => ({ item: item.id, count: TREATS_EACH })),
      lastShrine: { map: world.map.id, shrine },
      seen: owned,
      befriended: owned,
      story: emptyStory(),
    },
  };
}

/** The starter choice a new player sees on the way into the world: checks it and takes the first. */
export async function chooseStarter(page, { say, expect, check }) {
  await until(page, (s) => s.screen === 'starter', 'the starter choice');
  await nextFrames(page);
  expect((await textOf(page, '#starter .screen-title')) === say('starter.title'), 'the starter choice has the wrong title');
  expect((await page.locator('.starter-choice').count()) === STARTERS.species.length, `the starter choice does not offer the ${STARTERS.species.length} starters`);
  await check('the starter choice', 'b1-starter');
  await page.locator('.starter-choice').first().tap();
  const state = await until(page, (s) => s.screen === 'world' && s.progress?.needsStarter === false && s.progress.team.length === 1, 'the world with the starter on the team');
  expect(await page.locator('.team-button').isVisible(), 'the world shows no team button once there is a team');
  return state;
}

/** The battle on screen as the server says it is: the creatures out, the background, the buttons and the line. */
async function firstLook(page, { expect }) {
  await nextFrames(page);
  const { battle } = await readState(page);
  expect(battle.drawn?.creatures[0] === battle.team[battle.active]?.species && battle.drawn?.creatures[1] === battle.opponent?.species, `the field drew ${JSON.stringify(battle.drawn)}, not the creatures out`);
  const sky = battle.drawn?.sky ?? '';
  expect(battle.weather === null ? sky.startsWith('backgrounds/') : sky === spriteFor.weather(battle.weather), `the field drew the background ${sky} for the weather ${battle.weather}`);
  expect((await page.locator('#battle .move').count()) === battle.menu.moves.length, 'the move buttons are not the active creature’s moves');
  expect((await page.locator('#battle .battle-run').isEnabled()) === battle.menu.run, 'the run button does not follow canRun');
  expect((await page.locator('#battle .battle-treat').isEnabled()) === battle.menu.treat, 'the treat button does not follow canTreat');
  expect((await page.locator('#battle .battle-team').isEnabled()) === battle.menu.team, 'the team button does not follow the team');
  expect((await textOf(page, '#battle .battle-line')) === battle.lineText, `the line says "${await textOf(page, '#battle .battle-line')}", not "${battle.lineText}"`);
}

/** Taps the field while the turn plays, which must jump to its end. */
async function skipTurn(page, before, { expect, seen }) {
  const playing = await until(page, (s) => s.battle?.playing === true || (s.battle !== null && battleIdle(s) && s.battle.turn > before.battle.turn), 'the turn to play', 5_000);
  if (!playing.battle.playing) return;
  await page.locator('#battle .battle-field').tap();
  seen.skipped = true;
  const after = await readState(page);
  expect(!after.battle?.playing, 'a tap during a turn did not skip to its end');
}

/** One turn after another until the result, `choose` making each choice; written as recursion so each waits for the one before. */
async function nextTurn(page, state, turn, choose, options) {
  if (state.battle.panel === 'result') return state;
  if (turn >= MAX_TURNS) throw new Error(`battle ${state.battle.id} still going after ${MAX_TURNS} choices`);
  const { seen } = options;
  await choose(state);
  const sentAt = Date.now();
  if (seen.skipped) {
    await until(page, battleIdle, 'the turn to finish', 10_000);
    seen.longestMs = Math.max(seen.longestMs, Date.now() - sentAt);
  } else await skipTurn(page, state, options);
  return nextTurn(page, await until(page, battleIdle, 'the turn to finish', 10_000), turn + 1, choose, options);
}

/** The forced team picker after a creature faints: the first creature that can go out. */
const sendNext = (page) => page.locator('#battle .battle-choice:enabled').first().tap();

/** Taps the move in `slot`, or the first move when there is none there. */
const tapMove = (page, slot) => page.locator('#battle .move').nth(Math.max(0, slot)).tap();

/** The slot of the creature's weather call, the one move that does no damage. */
const harmlessSlot = (moves) => moves.findIndex((id) => CONTENT.moves.get(id)?.power === 0);

/** The slot of the weakest move that does damage, so the wild creature tires before it faints. */
function gentlestSlot(moves) {
  const [gentlest] = moves
    .map((id, slot) => ({ slot, power: CONTENT.moves.get(id)?.power ?? 0 }))
    .filter(({ power }) => power > 0)
    .toSorted((a, b) => a.power - b.power);
  return gentlest?.slot ?? 0;
}

/** The treat a wild creature likes best: its favourite, then one its weather type likes, then any. */
function bestTreat(species) {
  const wild = CONTENT.species.get(species);
  return TREATS.find((item) => item.id === wild?.favouriteTreat || item.likedBy.species.includes(species)) ?? TREATS.find((item) => item.likedBy.types.includes(wild?.type)) ?? TREATS[0];
}

/** Offers the treat the wild creature likes best from the treat picker. */
async function offerTreat(page, species, { language, check, seen }) {
  await page.locator('#battle .battle-treat').tap();
  await until(page, (s) => s.battle?.panel === 'treats', 'the treat picker');
  if (!seen.treats) {
    seen.treats = true;
    await nextFrames(page);
    await check('the treat picker', 'b3-treats');
  }
  const wanted = page.locator('#battle .treat-choice').filter({ has: page.locator('.treat-name', { hasText: bestTreat(species).name[language] }) });
  await ((await wanted.count()) > 0 ? wanted : page.locator('#battle .treat-choice')).first().tap();
}

async function resultSays(page, wanted, { expect, check }, step) {
  await nextFrames(page);
  const said = await textOf(page, '#battle .battle-result li');
  expect(said === wanted, `the result says "${said}", not "${wanted}"`);
  await check('the battle result', step);
}

async function continueToWorld(page) {
  await page.locator('#battle .battle-continue').tap();
  return until(page, (s) => s.screen === 'world' && s.battle === null, 'the world after the battle');
}

/** With one point of health and only the weather call, the team faints; the player wakes rested at the last shrine. */
async function loseAll(page, world, { shrine, say, expect, check, notes }) {
  await meetWildCreature(page, world, { notes });
  let state = await until(page, battleIdle, 'the battle menu', 15_000);
  await firstLook(page, { expect });
  const choose = (current) => (current.battle.panel === 'team' ? sendNext(page) : tapMove(page, harmlessSlot(current.battle.menu.moves)));
  state = await nextTurn(page, state, 0, choose, { expect, seen: { skipped: false, longestMs: 0 } });
  expect(state.battle.outcome?.winner === 1 && state.battle.woke?.shrine === shrine, `the battle ended ${JSON.stringify(state.battle.outcome)}, waking ${JSON.stringify(state.battle.woke)}, not the team fainting and waking at ${shrine}`);
  await resultSays(page, say('battle.teamFainted'), { expect, check }, 'f4-result');
  const back = await continueToWorld(page);
  const self = back.players.find((player) => player.self);
  const at = world.map.shrines[shrine];
  expect(self && apartBy(self, at) <= 3, `the player woke at ${self?.x},${self?.y}, not by the shrine at ${at.x},${at.y}`);
  expect(back.progress?.team.every((creature) => creature.hp > 1), `the team did not wake rested: ${JSON.stringify(back.progress?.team.map((creature) => creature.hp))}`);
}

/** Tires the wild creature with the gentlest move, then offers the treat it likes best until it joins; another battle when one ends first. */
async function befriend(page, world, options, tries = 1) {
  const { language, say, expect, check, notes, seen } = options;
  await meetWildCreature(page, world, { notes });
  const start = await until(page, battleIdle, 'the battle menu', 15_000);
  if (tries === 1) {
    await firstLook(page, { expect });
    await check('the battle menu', 'b2-battle');
  }
  const wild = start.battle.opponent.species;
  const choose = (current) => {
    if (current.battle.panel === 'team') return sendNext(page);
    if (current.battle.menu.treat) return offerTreat(page, wild, { language, check, seen });
    return tapMove(page, gentlestSlot(current.battle.menu.moves));
  };
  const state = await nextTurn(page, start, 0, choose, { expect, seen });
  const { outcome, befriended } = state.battle;
  if (outcome?.reason === 'befriended') {
    const wanted = say(befriended?.placedIn === 'storage' ? 'battle.befriendedStored' : 'battle.befriended').replace('{creature}', nameOf(befriended?.species, language));
    await resultSays(page, wanted, { expect, check }, 'b4-result');
    await continueToWorld(page);
    return befriended;
  }
  if (tries >= MAX_BEFRIEND_BATTLES) throw new Error(`no wild creature joined in ${MAX_BEFRIEND_BATTLES} battles; the last ended ${JSON.stringify(outcome)}`);
  notes.push(`battle ${tries} ended ${JSON.stringify(outcome)} before the wild creature joined, so another battle was played`);
  await continueToWorld(page);
  return befriend(page, world, options, tries + 1);
}

async function openTeam(page, say, expect) {
  await page.locator('.team-button').tap();
  const opened = await until(page, (s) => s.screen === 'team' && s.teamScreen !== null, 'the team screen');
  await nextFrames(page);
  expect((await textOf(page, '#team .screen-title')) === say('team.title'), 'the team screen has the wrong title');
  return opened;
}

async function closeTeam(page) {
  await page.locator('#team .team-close').tap();
  return until(page, (s) => s.screen === 'world', 'the world after closing the team');
}

/** The team screen lists the creature that just joined, and two creatures tapped one after the other swap places. */
async function teamScreen(page, joined, { language, say, expect, check }) {
  const opened = await openTeam(page, say, expect);
  const team = opened.progress?.team ?? [];
  expect(team.at(-1)?.species === joined.species, `the team ends with ${team.at(-1)?.species}, not ${joined.species}, who just joined`);
  expect((await page.locator('#team .team-pick').count()) === team.length, `the team screen does not list all ${team.length} creatures`);
  const lastCard = (await page.locator('#team .team-card').nth(team.length - 1).textContent()) ?? '';
  expect(lastCard.includes(nameOf(joined.species, language)), `the team screen's last card does not name ${nameOf(joined.species, language)}`);
  await check('the team screen', 'b5-team');
  const second = team[1]?.species;
  await page.locator('#team .team-pick').nth(0).tap();
  await until(page, (s) => s.teamScreen?.selected === 0, 'the first creature picked');
  await page.locator('#team .team-pick').nth(1).tap();
  await until(page, (s) => s.teamScreen?.selected === null && s.progress?.team[0]?.species === second, 'the two creatures to swap places');
  await closeTeam(page);
}

/** Scrolls the shrine's storage into view once the toast about resting there has gone, so the screenshot shows it. */
async function storageInView(page) {
  await until(page, (s) => s.toast === null, 'the toast about resting to go', 6_000);
  await page.locator('#team .team-card.stored').last().scrollIntoViewIfNeeded();
  await nextFrames(page);
}

/**
 * At the shrine the team screen also lists storage. With the team full, the last creature is picked
 * and swapped for the one waiting there (Take along), then another is left there (Leave here).
 */
async function shrineStorage(page, world, { shrine, say, expect, check, notes }) {
  await walkByTaps(page, world, world.map.shrines[shrine], { notes });
  let state = await until(page, (s) => s.storage?.shrine === shrine, `the storage of ${shrine} after resting there`);
  state = await openTeam(page, say, expect);
  const team = state.progress.team.map((creature) => creature.species);
  const stored = state.storage.storage.map((creature) => creature.species);
  expect(team.length === MAX_TEAM, `the team has ${team.length} creatures at the shrine, not a full ${MAX_TEAM}`);
  expect((await page.locator('#team .storage-take').count()) === stored.length, 'the team screen does not offer to take along each stored creature');
  expect((await page.locator('#team .team-store').count()) === team.length, 'the team screen does not offer to leave each creature here');
  await storageInView(page);
  await check('storage at the shrine', 'b6-storage');
  const last = team.length - 1;
  await page.locator('#team .team-pick').nth(last).tap();
  await until(page, (s) => s.teamScreen?.selected === last, 'the last creature picked');
  await page.locator('#team .storage-take').first().tap();
  state = await until(page, (s) => s.progress?.team[last]?.species === stored[0] && s.storage?.storage[0]?.species === team[last], 'the picked creature and the stored one to swap');
  await page.locator('#team .team-store').nth(1).tap();
  state = await until(page, (s) => s.progress?.team.length === MAX_TEAM - 1 && s.storage?.storage.length === stored.length + 1, 'a creature to be left at the shrine');
  expect(state.storage.storage.at(-1)?.species === team[1], `the shrine keeps ${state.storage.storage.at(-1)?.species}, not ${team[1]}, who was left there`);
  await storageInView(page);
  await check('storage after taking one along and leaving one', 'b7-stored');
  await closeTeam(page);
}

/**
 * For a page in the world as the player of `battleSave`: the team faints and wakes at the shrine,
 * a wild creature is befriended onto the team, the team screen shows it, and storage at the shrine
 * takes one along and leaves one there. `check(where, step)` looks for small targets and sideways
 * scrolling, and takes the screenshot.
 */
export async function playBattles(page, world, { shrine, language, strings, expect, check, notes }) {
  const say = (id) => strings[id][language];
  await until(page, (s) => s.screen === 'world' && (s.progress?.team.length ?? 0) > 0, 'the world with the prepared team');
  await loseAll(page, world, { shrine, say, expect, check, notes });
  const seen = { treats: false, skipped: false, longestMs: 0 };
  const joined = await befriend(page, world, { language, say, expect, check, notes, seen });
  expect(seen.skipped, 'no turn played long enough to skip');
  expect(seen.longestMs < TURN_BUDGET_MS + TURN_SLACK_MS, `a turn took ${seen.longestMs}ms to play`);
  expect(joined?.placedIn === 'team', `the befriended creature went to ${joined?.placedIn}, not the team`);
  await teamScreen(page, joined, { language, say, expect, check });
  await shrineStorage(page, world, { shrine, say, expect, check, notes });
}
