// The way to the starter choice, and the starter choice and the battle, team and storage screens, played the way a player would against
// the real server. One turn is left to play at its own pace and then tapped through; every other
// turn is tapped through at once, as a player in a hurry would. A battle's outcome is the server's
// dice, so each part plays until it gets what it checks, within a bounded number of turns or battles: a team worn down to one point of health that
// only calls the weather loses, and treats a creature loves, offered once it is tired, befriend it.
// The player starts from a save the check prepares (scripts/lib/prepared-saves.mjs), so the team,
// the creature waiting at the shrine and the last shrine are known before the first step.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LINE_MIN_MS } from '../../apps/game/src/battle-playback.ts';
import { MAX_TEAM, emptyStory, loadBattleContent, newCreature, spriteFor } from '../../packages/core/src/index.ts';
import { battleIdle, inWorld, meetWildCreature, nextFrames, offersStarter, openTalk, readState, settledOn, talkThrough, until, untilTappingThrough, walkByTaps } from './game-page.mjs';
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
/** How much sooner than it did a line can seem to go, as the check sees each line up to a poll late. */
const POLL_SLACK_MS = 250;
const TREATS_EACH = 10;
const WEATHER_NAMES = new Map(readContent('creatures/weather.json').types.map((type) => [type.id, type.name]));

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
      skills: [],
      jobs: null,
    },
  };
}

/**
 * A new player's way to the starter choice: the hint points at the character who gives it, who
 * stands marked; tapping them walks up and opens the talk, where a tap shows the whole line at
 * once; talking on brings up the starter choice, which is checked, and the first starter taken.
 */
export async function chooseStarter(page, world, { say, expect, check, notes }) {
  const hinted = await until(page, (s) => inWorld(s) && s.progress?.needsStarter === true && s.talkHint !== null && settledOn(s), 'the hint to the character who gives the first creature');
  const giver = hinted.talkHint;
  expect(hinted.npcs.find((npc) => npc.id === giver)?.mark === 'newQuest', `${giver}, who gives the first creature, carries the mark ${JSON.stringify(hinted.npcs.find((npc) => npc.id === giver)?.mark)}`);
  await nextFrames(page);
  expect(await page.locator('.talk-hint').isVisible(), `no hint points a new player at ${giver}`);
  await check('the hint to the character with the first creature', 'b0-hint');
  const opened = await openTalk(page, world, giver, { notes });
  if (opened.talk.typed) notes.push(`the first line of ${giver} was typed out before a tap could show it whole`);
  else {
    await page.locator('#talk .talk-line').tap();
    const tapped = await readState(page);
    expect(tapped.talk?.node === opened.talk.node && tapped.talk.typed, `a tap on a line still typing did not show it whole: ${JSON.stringify(tapped.talk)}`);
  }
  await nextFrames(page);
  await check('the talk box', 'b0-talk');
  await talkThrough(page, { toward: offersStarter, stop: (s) => s.screen === 'starter' });
  await until(page, (s) => s.screen === 'starter', 'the starter choice');
  await nextFrames(page);
  expect((await textOf(page, '#starter .screen-title')) === say('starter.title'), 'the starter choice has the wrong title');
  expect((await page.locator('.starter-choice').count()) === STARTERS.species.length, `the starter choice does not offer the ${STARTERS.species.length} starters`);
  await check('the starter choice', 'b1-starter');
  await page.locator('.starter-choice').first().tap();
  const state = await until(page, (s) => s.screen === 'world' && s.progress?.needsStarter === false && s.progress.team.length === 1 && s.talk === null, 'the world with the starter on the team and the talk over');
  expect(state.talkHint === null, `the hint still points at ${state.talkHint} once there is a starter`);
  expect(await page.locator('.team-button').isVisible(), 'the world shows no team button once there is a team');
  return state;
}
/** The weather badge on the field: shown with the weather's name while there is weather, hidden without. */
async function weatherShown(page, battle, { language, expect }) {
  const badge = page.locator('#battle .battle-weather');
  if (battle.weather === null) {
    expect(!(await badge.isVisible()), 'the field shows a weather badge without weather');
    return;
  }
  const name = WEATHER_NAMES.get(battle.weather)?.[language];
  expect((await badge.isVisible()) && (await textOf(page, '#battle .battle-weather')) === name, `the weather badge says "${await textOf(page, '#battle .battle-weather')}", not "${name}"`);
}

/** The line under a disabled treat button, saying why, as the menu gives it. */
async function treatReasonShown(page, battle, { say, expect }) {
  const reason = page.locator('#battle-treat-reason');
  if (battle.menu.treatReason === null) {
    expect((await reason.count()) === 0, 'a treat reason shows while a treat can be offered');
    return;
  }
  expect((await textOf(page, '#battle-treat-reason')) === say(battle.menu.treatReason), `the treat reason says "${await textOf(page, '#battle-treat-reason')}", not "${say(battle.menu.treatReason)}"`);
  expect((await page.locator('#battle .battle-treat').getAttribute('aria-describedby')) === 'battle-treat-reason', 'the disabled treat button does not point at its reason');
}

/** The battle on screen as the server says it is: the creatures out, the background, the buttons and the line. */
async function firstLook(page, { language, say, expect }) {
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
  await weatherShown(page, battle, { language, expect });
  await treatReasonShown(page, battle, { say, expect });
}

const tapField = (page) => page.locator('#battle .battle-field').tap();
const lineMoved = (line) => (s) => !s.battle?.playing || s.battle.lineText !== line;

/**
 * A turn's pace, untouched and then tapped: its second line stays up at least `LINE_MIN_MS`
 * (screenshotted the first time), a tap moves on to the next line, and a second quick tap jumps to
 * the end of the turn. A turn too short for all of it is tried again on the next one.
 */
async function paceTurn(page, before, { expect, check, notes, seen }) {
  const done = (s) => s.battle === null || s.battle.panel === 'result' || (battleIdle(s) && s.battle.turn > before.battle.turn);
  const first = await until(page, (s) => s.battle?.playing === true || done(s), 'the turn to play', 5_000);
  if (!first.battle?.playing) return;
  const second = await until(page, lineMoved(first.battle.lineText), 'the turn’s second line', 10_000);
  if (!second.battle?.playing) return;
  const shownAt = Date.now();
  if (!seen.midLine) {
    seen.midLine = true;
    await nextFrames(page);
    await check('a line while the turn plays', 'b2-line');
  }
  const third = await until(page, lineMoved(second.battle.lineText), 'the turn’s next line', 10_000);
  const held = Date.now() - shownAt;
  if (!seen.paced) notes.push(`a ${second.battle.lineText.length}-character battle line stayed up ${held}ms untouched (seen up to a poll late)`);
  seen.paced = true;
  expect(held >= LINE_MIN_MS - POLL_SLACK_MS, `the line "${second.battle.lineText}" stayed up only ${held}ms, not the ${LINE_MIN_MS}ms every line gets`);
  if (!third.battle?.playing) return;
  await tapField(page);
  const tapped = await readState(page);
  expect(!tapped.battle?.playing || tapped.battle.lineText !== third.battle.lineText, `a tap left the line "${third.battle.lineText}" up`);
  if (!tapped.battle?.playing) return;
  await tapField(page);
  const skipped = await readState(page);
  expect(!skipped.battle?.playing, 'a second quick tap did not jump to the end of the turn');
  seen.skipped = true;
}

/** The first time the field has weather, waiting for a choice or on the result: the badge, screenshotted. */
async function weatherOnce(page, state, { language, expect, check, seen }) {
  if (state.battle.weather === null || seen.weather) return;
  seen.weather = true;
  await nextFrames(page);
  await weatherShown(page, state.battle, { language, expect });
  await check('the weather on the field', 'f2-weather');
}

/** One turn after another until the result, `choose` making each choice; written as recursion so each waits for the one before. */
async function nextTurn(page, state, turn, choose, options) {
  await weatherOnce(page, state, options);
  if (state.battle.panel === 'result') return state;
  if (turn >= MAX_TURNS) throw new Error(`battle ${state.battle.id} still going after ${MAX_TURNS} choices`);
  await choose(state);
  if (!options.seen.skipped) await paceTurn(page, state, options);
  return nextTurn(page, await untilTappingThrough(page, battleIdle, 'the turn to finish', 10_000), turn + 1, choose, options);
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
async function loseAll(page, world, { shrine, language, say, expect, check, notes, seen }) {
  await meetWildCreature(page, world, { notes });
  let state = await untilTappingThrough(page, battleIdle, 'the battle menu', 15_000);
  await firstLook(page, { language, say, expect });
  const choose = (current) => (current.battle.panel === 'team' ? sendNext(page) : tapMove(page, harmlessSlot(current.battle.menu.moves)));
  state = await nextTurn(page, state, 0, choose, { language, expect, check, notes, seen });
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
  const start = await untilTappingThrough(page, battleIdle, 'the battle menu', 15_000);
  if (tries === 1) {
    await firstLook(page, { language, say, expect });
    await check('the battle menu', 'b2-battle');
  }
  const wild = start.battle.opponent.species;
  const choose = async (current) => {
    if (current.battle.panel === 'team') return sendNext(page);
    if (current.battle.phase === 'befriend' && !seen.done) {
      seen.done = true;
      const label = await textOf(page, '#battle .battle-run');
      expect(label === say('battle.done'), `after the wild creature fainted the leave button says "${label}", not "${say('battle.done')}"`);
      await check('the end of the battle after the wild creature fainted', 'b3-done');
    }
    if (current.battle.menu.treat) return offerTreat(page, wild, { language, check, seen });
    return tapMove(page, gentlestSlot(current.battle.menu.moves));
  };
  const state = await nextTurn(page, start, 0, choose, { language, expect, check, notes, seen });
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

/** Close is on screen without scrolling, wherever the cards above it are scrolled to. */
export async function closeInView(page, expect) {
  const inView = await page
    .waitForFunction(
      () => {
        const box = document.querySelector('#team .team-close')?.getBoundingClientRect();
        return box !== undefined && box.bottom > box.top && box.top >= 0 && box.bottom <= window.innerHeight;
      },
      null,
      { timeout: 3_000 },
    )
    .then(
      () => true,
      () => false,
    );
  if (inView) return;
  const at = await page.evaluate(() => {
    const box = document.querySelector('#team .team-close')?.getBoundingClientRect();
    return { top: box?.top ?? null, bottom: box?.bottom ?? null, height: window.innerHeight, screen: document.body.dataset.screen };
  });
  expect(false, `the team screen's Close is at ${JSON.stringify(at)}, not on the screen`);
}

async function closeTeam(page, expect) {
  await closeInView(page, expect);
  await page.locator('#team .team-close').tap();
  return until(page, (s) => s.screen === 'world', 'the world after closing the team');
}

/** Shows the shrine's Team or Storage tab. */
async function showTab(page, tab) {
  await page.locator(`#team .team-tab[data-tab="${tab}"]`).tap();
  await until(page, (s) => s.teamScreen?.tab === tab, `the ${tab} tab`);
  await nextFrames(page);
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
  await closeTeam(page, expect);
}

/** Waits for the toast about resting at the shrine to go, so the screenshot shows the screen under it. */
const toastGone = (page) => until(page, (s) => s.toast === null, 'the toast about resting to go', 6_000);

/**
 * At the shrine the team screen has a Storage tab. With the team full and no creature picked, Take
 * along waits with a line saying to pick one first; the last creature is picked and swapped for the
 * one waiting there (Take along), then another is left there (Leave here). Close stays on screen
 * with the cards scrolled to the bottom.
 */
async function shrineStorage(page, world, { shrine, say, expect, check, notes }) {
  await walkByTaps(page, world, world.map.shrines[shrine], { notes });
  let state = await until(page, (s) => s.storage?.shrine === shrine, `the storage of ${shrine} after resting there`);
  state = await openTeam(page, say, expect);
  const team = state.progress.team.map((creature) => creature.species);
  const stored = state.storage.storage.map((creature) => creature.species);
  expect(team.length === MAX_TEAM, `the team has ${team.length} creatures at the shrine, not a full ${MAX_TEAM}`);
  expect((await page.locator('#team .team-tab').count()) === 2, 'the team screen at the shrine has no Team and Storage tabs');
  expect((await page.locator('#team .team-store').count()) === team.length, 'the team screen does not offer to leave each creature here');
  await page.locator('#team .team-card').last().scrollIntoViewIfNeeded();
  await toastGone(page);
  await nextFrames(page);
  await closeInView(page, expect);
  await check('the team tab at the shrine', 'b6-team-tab');
  await showTab(page, 'storage');
  expect((await page.locator('#team .storage-take').count()) === stored.length, 'the storage tab does not offer to take along each stored creature');
  expect(!(await page.locator('#team .storage-take').first().isEnabled()), 'Take along is offered with the team full and no creature picked');
  expect((await textOf(page, '#team .storage-reason')) === say('storage.pickFirst'), `the storage tab says "${await textOf(page, '#team .storage-reason')}", not to pick a creature first`);
  await check('storage at the shrine', 'b6-storage');
  await showTab(page, 'team');
  const last = team.length - 1;
  await page.locator('#team .team-pick').nth(last).tap();
  await until(page, (s) => s.teamScreen?.selected === last, 'the last creature picked');
  await showTab(page, 'storage');
  await page.locator('#team .storage-take').first().tap();
  state = await until(page, (s) => s.progress?.team[last]?.species === stored[0] && s.storage?.storage[0]?.species === team[last], 'the picked creature and the stored one to swap');
  await showTab(page, 'team');
  await page.locator('#team .team-store').nth(1).tap();
  state = await until(page, (s) => s.progress?.team.length === MAX_TEAM - 1 && s.storage?.storage.length === stored.length + 1, 'a creature to be left at the shrine');
  expect(state.storage.storage.at(-1)?.species === team[1], `the shrine keeps ${state.storage.storage.at(-1)?.species}, not ${team[1]}, who was left there`);
  expect((await readState(page)).toast === null, 'a swap at the shrine showed the toast about resting again, over Close');
  await showTab(page, 'storage');
  await check('storage after taking one along and leaving one', 'b7-stored');
  await closeTeam(page, expect);
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
  const seen = { treats: false, paced: false, skipped: false, midLine: false, weather: false, done: false };
  await loseAll(page, world, { shrine, language, say, expect, check, notes, seen });
  const joined = await befriend(page, world, { language, say, expect, check, notes, seen });
  expect(seen.paced, 'no turn played long enough to time a line');
  expect(seen.skipped, 'no turn played long enough to tap through');
  if (!seen.weather) notes.push('no battle had weather, so the weather badge was not seen');
  if (!seen.done) notes.push('no wild creature fainted, so the Done button after it faints was not seen');
  expect(joined?.placedIn === 'team', `the befriended creature went to ${joined?.placedIn}, not the team`);
  await teamScreen(page, joined, { language, say, expect, check });
  await shrineStorage(page, world, { shrine, say, expect, check, notes });
}
