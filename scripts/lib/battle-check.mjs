// The battle, team and starter screens, played the way a player would against the page's own fake
// server (?test=1&fake=<scenario>, apps/game/src/fake-server.ts), which runs the same core rules as
// the real one. Walking still goes to the real server; the first step starts the scenario's battle.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TURN_BUDGET_MS } from '../../apps/game/src/battle-playback.ts';
import { readState, until } from './game-page.mjs';
import { ROOT } from './server-process.mjs';

const SPECIES = new Map(JSON.parse(readFileSync(join(ROOT, 'content/creatures/species.json'), 'utf8')).species.map((species) => [species.id, species]));
const MAX_TURNS = 40;
/** Room for the page's clock, the fake's reply and the check's polling on top of a turn's playback. */
const TURN_SLACK_MS = 700;

const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();
/** The hook answers from the model at once; the page redraws its screens on the next frame. */
const drawn = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const idle = (state) => state.battle !== null && !state.battle.playing && !state.battle.waiting && state.battle.panel !== null;

/** The page's URL with the fake server playing `scenario`. */
export const fakeUrl = (base, scenario) => `${base}/?test=1&fake=${scenario}`;

async function chooseStarter(page, { say, expect, check }) {
  await until(page, (s) => s.screen === 'starter', 'the starter choice');
  await drawn(page);
  expect((await textOf(page, '#starter .screen-title')) === say('starter.title'), 'the starter choice has the wrong title');
  expect((await page.locator('.starter-choice').count()) === 3, 'the starter choice does not offer three creatures');
  await check('the starter choice', 'b1-starter');
  await page.locator('.starter-choice').first().tap();
  const state = await until(page, (s) => s.screen === 'world' && s.progress?.needsStarter === false && s.progress.team.length === 1, 'the world with the starter on the team');
  expect(await page.locator('.team-button').isVisible(), 'the world shows no team button once there is a team');
  return state;
}

async function firstLook(page, state, { expect, check, prefix }) {
  await drawn(page);
  const { battle } = (await readState(page)) ?? state;
  expect(battle.drawn?.creatures[0] === battle.team[battle.active]?.species && battle.drawn?.creatures[1] === battle.opponent?.species, `the field drew ${JSON.stringify(battle.drawn)}, not the creatures out`);
  expect((await page.locator('#battle .move').count()) === battle.menu.moves.length, 'the move buttons are not the active creature’s moves');
  expect((await page.locator('#battle .battle-run').isEnabled()) === battle.menu.run, 'the run button does not follow canRun');
  expect((await page.locator('#battle .battle-treat').isEnabled()) === battle.menu.treat, 'the treat button does not follow canTreat');
  expect((await page.locator('#battle .battle-team').isEnabled()) === battle.menu.team, 'the team button does not follow the team');
  expect((await textOf(page, '#battle .battle-line')) === battle.lineText, `the line says "${await textOf(page, '#battle .battle-line')}", not "${battle.lineText}"`);
  await check('the battle menu', `${prefix}2-battle`);
}

/** One choice by the browser check's simple play: attack with the first move until a treat is allowed, then offer one. */
async function chooseOnce(page, state, { check, prefix, seen }) {
  if (state.battle.panel === 'team') {
    await page.locator('#battle .battle-choice:enabled').first().tap();
    return;
  }
  if (!state.battle.menu.treat) {
    await page.locator('#battle .move').first().tap();
    return;
  }
  await page.locator('#battle .battle-treat').tap();
  await until(page, (s) => s.battle?.panel === 'treats', 'the treat picker');
  if (!seen.treats) {
    seen.treats = true;
    await drawn(page);
    await check('the treat picker', `${prefix}3-treats`);
  }
  await page.locator('#battle .treat-choice').first().tap();
}

/** Taps the field while the turn plays, which must jump to its end. */
async function skipTurn(page, before, { expect, seen }) {
  const playing = await until(page, (s) => s.battle?.playing === true || (s.battle !== null && idle(s) && s.battle.turn > before.battle.turn), 'the turn to play', 5_000);
  if (!playing.battle.playing) return;
  await page.locator('#battle .battle-field').tap();
  seen.skipped = true;
  const after = await readState(page);
  expect(!after.battle?.playing, 'a tap during a turn did not skip to its end');
}

/** One turn after another, written as recursion so each waits for the one before. */
async function nextTurn(page, state, turn, options) {
  if (turn >= MAX_TURNS || state.battle.panel === 'result') return state;
  const { seen } = options;
  await chooseOnce(page, state, options);
  const sentAt = Date.now();
  if (seen.skipped) {
    await until(page, idle, 'the turn to finish', 10_000);
    seen.longestMs = Math.max(seen.longestMs, Date.now() - sentAt);
  } else await skipTurn(page, state, options);
  return nextTurn(page, await until(page, idle, 'the turn to finish', 10_000), turn + 1, options);
}

/** Plays turns until the result, skipping the first by a tap and timing the others. */
async function playTurns(page, start, { expect, check, prefix }) {
  const seen = { treats: false, skipped: false, longestMs: 0 };
  const state = await nextTurn(page, start, 0, { expect, check, prefix, seen });
  expect(seen.skipped, 'no turn played long enough to skip');
  expect(seen.longestMs < TURN_BUDGET_MS + TURN_SLACK_MS, `a turn took ${seen.longestMs}ms to play`);
  return state;
}

function resultWanted(state, scenario, say, language) {
  if (scenario === 'faint') return say('battle.teamFainted');
  const species = SPECIES.get(state.battle.befriended?.species)?.name[language] ?? '?';
  return say(state.battle.befriended?.placedIn === 'storage' ? 'battle.befriendedStored' : 'battle.befriended').replace('{creature}', species);
}

async function teamScreen(page, { say, expect, check }) {
  await page.locator('.team-button').tap();
  await until(page, (s) => s.screen === 'team' && s.teamScreen !== null, 'the team screen');
  await drawn(page);
  expect((await textOf(page, '#team .screen-title')) === say('team.title'), 'the team screen has the wrong title');
  expect((await page.locator('#team .team-pick').count()) === 2, 'the team screen does not list both creatures');
  await check('the team screen', 'b5-team');
  await page.locator('#team .team-pick').nth(0).tap();
  await until(page, (s) => s.teamScreen?.selected === 0, 'the first creature picked');
  await page.locator('#team .team-pick').nth(1).tap();
  const state = await until(page, (s) => s.teamScreen?.selected === null && s.progress?.team[0]?.species === 'gale-blob', 'the two creatures to swap places');
  await page.locator('#team .team-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after closing the team');
  return state;
}

/**
 * From a signed-in page already on fakeUrl(scenario): `new` chooses a starter, battles the wild
 * creature to befriend it, then swaps the two on the team screen; `faint` loses with a worn-out
 * team and wakes rested. `walk` takes one step; `check(where, step)` looks for small targets and
 * sideways scrolling, and takes the screenshot.
 */
export async function playBattle(page, { scenario, language, strings, expect, check, walk }) {
  const say = (id) => strings[id][language];
  const prefix = scenario === 'new' ? 'b' : 'f';
  if (scenario === 'new') await chooseStarter(page, { say, expect, check });
  else await until(page, (s) => s.screen === 'world' && (s.progress?.team.length ?? 0) > 0, 'the world with a team');
  await walk();
  await until(page, (s) => s.screen === 'battle' && s.battle !== null, 'a wild battle after a step', 10_000);
  let state = await until(page, idle, 'the battle menu', 10_000);
  await firstLook(page, state, { expect, check, prefix });
  state = await playTurns(page, state, { expect, check, prefix });
  if (scenario === 'new') expect(state.battle.outcome?.reason === 'befriended', `the battle ended ${JSON.stringify(state.battle.outcome)}, not befriended`);
  else expect(state.battle.outcome?.winner === 1 && state.battle.woke !== null, `the battle ended ${JSON.stringify(state.battle.outcome)}, woke ${JSON.stringify(state.battle.woke)}`);
  await drawn(page);
  const said = await textOf(page, '#battle .battle-result li');
  expect(said === resultWanted(state, scenario, say, language), `the result says "${said}"`);
  await check('the battle result', `${prefix}4-result`);
  await page.locator('#battle .battle-continue').tap();
  state = await until(page, (s) => s.screen === 'world' && s.battle === null, 'the world after the battle');
  if (scenario === 'faint') {
    expect(state.progress?.team[0]?.hp > 1, 'the team did not wake rested');
    return;
  }
  expect(state.progress?.team.length === 2, `the team has ${state.progress?.team.length} creatures after befriending`);
  await teamScreen(page, { say, expect, check });
}
