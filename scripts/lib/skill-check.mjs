// Gathering, cooking and the Skills tab, played the way a player would against the real server.
// The player starts from a save the check prepares (scripts/lib/skill-saves.mjs) beside a fishing
// spot, with the fish one short of a stack. They tap the spot and pull when the float dips, read
// from the test hook, and see the catch toasted with the fish that had no room; press Space at the
// resting spot and are told how long it rests; walk to a bush beside a cooking pot, let the
// sparkles go by once (a miss), try again and tap each sparkle; open the recipe book at the pot,
// cook and stop the marker in the zone (in Chromium, focus moves into the book and Escape closes
// it); and find the three skills in the journal's Skills tab.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOOK, nextFrames, readState, selfIn, tilesToScreen, until, walkByTaps } from './game-page.mjs';
import { ROOT } from './server-process.mjs';

const ITEMS = new Map(JSON.parse(readFileSync(join(ROOT, 'content/items.json'), 'utf8')).items.map((item) => [item.id, item]));

const MARKER_TRACK = 1_000;
/** A tap lands this long after Playwright is asked for it, roughly, so taps are asked this much early. */
const TAP_LEAD_MS = 40;
/** How long after the float dips the check pulls: well inside the perfect window and its grace. */
const PULL_AFTER_MS = 120;
const SPARKLE_DEADLINE_MS = 10_000;

const fill = (line, values) => line.replaceAll(/\{([a-zA-Z]+)\}/g, (blank, name) => (name in values ? String(values[name]) : blank));
const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Taps a tile of the map, the way a player taps a spot or a pot. */
async function tapTile(page, tile) {
  const [spot] = await tilesToScreen(page, [tile]);
  if (!spot) throw new Error(`the tile ${tile.x},${tile.y} is not on screen to tap`);
  await page.touchscreen.tap(spot.x, spot.y);
}

/** Waits until the game on the card has run `atMs`, by the page's own clock, then taps `locator`. */
async function tapAt(page, locator, atMs) {
  const asked = Date.now();
  const { attempt } = await page.evaluate((key) => JSON.parse(window[key].stateAsText()), HOOK);
  const elapsed = attempt.elapsedMs + (Date.now() - asked) / 2;
  await sleep(Math.max(0, atMs - elapsed - TAP_LEAD_MS));
  await locator.tap();
}

/** A new game on the card, after `before` (the attempt number of the last one, or null). */
const newGame = (page, game, before, what) => until(page, (s) => s.screen === 'skillGame' && s.attempt?.game === game && s.attempt.phase === 'playing' && s.attempt.attempt !== before, what, 10_000);
const judged = (page, what) => until(page, (s) => s.attempt?.phase === 'result' && s.attempt.outcome !== null, what, 10_000);

/** Fishing: taps the spot, pulls just after the float dips, and sees the catch and the fish with no room toasted. */
async function fish(page, plan, { say, name, expect, check }) {
  await tapTile(page, plan.fish.tile);
  const started = await newGame(page, 'dip', null, 'the fishing game');
  expect(started.attempt.spot === plan.fish.spot, `the fishing game is at ${started.attempt.spot}, not ${plan.fish.spot}`);
  // The attempt is a message, sent at once; the courier's skill comes with the next state patch.
  const marked = await until(page, (s) => selfIn(s)?.skill === 'fishing', 'the courier to be marked fishing', 2_000).catch(() => readState(page));
  expect(selfIn(marked)?.skill === 'fishing', `the courier is doing "${selfIn(marked)?.skill}" while fishing, not fishing`);
  await check('the fishing game', 'k1-fishing');
  const { dipAtMs } = started.attempt.params;
  const now = (await readState(page)).attempt;
  expect(now.elapsedMs < dipAtMs, `the screenshot took past the dip (${now.elapsedMs} ms of ${dipAtMs})`);
  await tapAt(page, page.locator('#skill-game .skill-area.dip'), dipAtMs + PULL_AFTER_MS);
  const result = await judged(page, 'the fishing result');
  expect(result.attempt.outcome === 'perfect', `pulling ${result.attempt.taps[0]?.at - dipAtMs} ms after the dip was ${result.attempt.outcome}, not perfect`);
  const toasted = await until(page, (s) => s.questToast?.change === 'good', 'the toast of the catch', 5_000);
  const noRoom = fill(say('skill.bagFull'), { item: name(plan.fish.item) });
  expect(toasted.questToast.lines.includes(noRoom), `the catch toast says ${JSON.stringify(toasted.questToast.lines)}, without "${noRoom}"`);
  await nextFrames(page);
  await check('the fishing result', 'k2-fish-result');
  const rested = await until(page, (s) => s.screen === 'world', 'the card to close after a catch', 5_000);
  expect((rested.resting[plan.fish.spot] ?? 0) > 0, `${plan.fish.spot} does not rest after a catch: ${JSON.stringify(rested.resting)}`);
  expect(rested.spots.some((spot) => spot.id === plan.fish.spot && spot.resting), `${plan.fish.spot} is not drawn resting`);
}

/** Space at the resting spot: the courier faces it, and the start is turned down with how long it rests. */
async function restingRefused(page, { say, expect }) {
  await page.keyboard.press('Space');
  const refused = await until(page, (s) => s.questToast?.change === 'refused', 'the toast that the spot rests', 15_000);
  const [line] = refused.questToast.lines;
  const seconds = Number(/\d+/.exec(line ?? '')?.[0]);
  expect(line === fill(say('skill.resting'), { seconds }) && seconds > 0, `the resting toast says "${line}"`);
}

/** Taps each sparkle as it shows, until the game is over or `deadline` passes. */
async function tapSparkles(page, deadline) {
  const { attempt } = await readState(page);
  if (attempt?.phase !== 'playing' || Date.now() > deadline) return;
  const on = page.locator('#skill-game .sparkle-place[data-on="true"]');
  // A sparkle can go out between finding and tapping it; the next round looks again.
  if ((await on.count()) > 0) await on.first().tap({ timeout: 2_000 }).catch(() => {});
  else await sleep(40);
  await tapSparkles(page, deadline);
}

/** Foraging: lets the sparkles go by once (a miss), tries again and taps each sparkle as it shows. */
async function forage(page, plan, { say, expect, check }) {
  await tapTile(page, plan.bush.tile);
  const first = await newGame(page, 'sparkle', null, 'the foraging game');
  const missed = await judged(page, 'the foraging game to end with no taps');
  expect(missed.attempt.outcome === 'miss', `a foraging game with no taps was ${missed.attempt.outcome}`);
  expect((await textOf(page, '#skill-game .skill-result')) === say('skill.miss'), `the miss says "${await textOf(page, '#skill-game .skill-result')}"`);
  expect(await page.locator('#skill-game .skill-again').isVisible(), 'a miss offers no "Try again"');
  await check('a missed foraging game', 'k3-miss');
  await page.locator('#skill-game .skill-again').tap();
  await newGame(page, 'sparkle', first.attempt.attempt, 'another foraging game');
  const won = await playGame(page);
  expect(won.attempt.outcome === 'perfect' || won.attempt.outcome === 'success', `tapping each sparkle was ${won.attempt.outcome} (taps ${JSON.stringify(won.attempt.taps)})`);
  await check('a foraging result', 'k4-forage');
  await until(page, (s) => s.screen === 'world', 'the card to close after foraging', 5_000);
}

/** When to stop the marker: in the middle of the perfect band, on a sweep at least `after` ms into the game. */
function markerStopMs({ sweepMs, perfectFrom, perfectTo, timeoutMs }, after) {
  const middle = (perfectFrom + perfectTo) / 2;
  const there = Math.round((middle * sweepMs) / MARKER_TRACK);
  const times = Array.from({ length: 6 }, (_, sweep) => [2 * sweep * sweepMs + there, 2 * (sweep + 1) * sweepMs - there]).flat();
  return times.toSorted((a, b) => a - b).find((at) => at >= after && at < timeoutMs - 100) ?? there;
}

/**
 * Plays the tiny game open on the card: to win, as a quick player would (pulls just after the float
 * dips, taps each sparkle, stops the marker in the perfect band), or not at all, to miss. Returns
 * the state once the server has judged it.
 */
export async function playGame(page, { win = true } = {}) {
  const { attempt } = await until(page, (s) => s.attempt?.phase === 'playing', 'a tiny game to play', 10_000);
  if (win && attempt.game === 'dip') await tapAt(page, page.locator('#skill-game .skill-area.dip'), attempt.params.dipAtMs + PULL_AFTER_MS);
  else if (win && attempt.game === 'sparkle') await tapSparkles(page, Date.now() + SPARKLE_DEADLINE_MS);
  else if (win) await tapAt(page, page.locator('#skill-game .marker-stop'), markerStopMs(attempt.params, attempt.elapsedMs + 400));
  return judged(page, `the ${attempt.game} game's result`);
}

/** The element that has focus, as `tag#id.class` (the body when nothing does). */
const focusedElement = (page) =>
  page.evaluate(() => {
    const at = document.activeElement;
    return at ? `${at.tagName.toLowerCase()}${at.id ? `#${at.id}` : ''}${typeof at.className === 'string' && at.className ? `.${at.className.split(' ').join('.')}` : ''}` : 'nothing';
  });

/**
 * The recipe book at the pot: the recipe listed with what the bag has, Cook, and the marker stopped
 * in the zone. With `keys` (where a keyboard is checked), opening the book focuses the first Cook,
 * coming back from the game puts focus in the book again, and Escape closes the book and gives
 * focus back.
 */
async function cook(page, plan, { name, expect, check, keys }) {
  const focusBefore = await focusedElement(page);
  await tapTile(page, plan.pot.tile);
  const book = await until(page, (s) => s.screen === 'recipeBook' && s.recipeBook !== null, 'the recipe book', 10_000);
  const row = book.recipeBook.rows.find((each) => each.recipe === plan.recipe.id);
  expect(row?.blocked === null, `the recipe book shows ${plan.recipe.id} as ${JSON.stringify(row)}`);
  const shown = await page.locator('#recipe-book .recipe .recipe-name span').first().textContent();
  expect(shown === name(plan.recipe.makes), `the recipe book's first dish is "${shown}"`);
  const cookButton = page.locator(`#recipe-book .recipe[data-recipe="${plan.recipe.id}"] .recipe-cook`);
  const onCook = () => cookButton.evaluate((button) => document.activeElement === button);
  if (keys) expect(await onCook(), `opening the recipe book focused ${await focusedElement(page)}, not the first Cook`);
  await nextFrames(page);
  await check('the recipe book', 'k5-book');
  await cookButton.tap();
  await newGame(page, 'marker', null, 'the cooking game');
  const result = await playGame(page);
  expect(result.attempt.outcome === 'perfect' || result.attempt.outcome === 'success', `stopping the marker in the perfect band was ${result.attempt.outcome}`);
  await check('the cooking result', 'k6-cooked');
  const back = await until(page, (s) => s.screen === 'recipeBook', 'the recipe book after cooking', 5_000);
  expect(back.progress.inventory.some((entry) => entry.item === plan.recipe.makes), `the bag has no ${plan.recipe.makes} after cooking`);
  if (keys) {
    await nextFrames(page);
    const inBook = await page.evaluate(() => document.querySelector('#recipe-book')?.contains(document.activeElement) === true);
    expect(inBook, `back in the recipe book after cooking, focus is on ${await focusedElement(page)}, outside the book`);
    await page.keyboard.press('Escape');
    await until(page, (s) => s.screen === 'world', 'Escape to close the recipe book');
    const focusAfter = await focusedElement(page);
    expect(focusAfter === focusBefore, `closing the recipe book left focus on ${focusAfter}, not ${focusBefore} where it was`);
    return;
  }
  await page.locator('#recipe-book .book-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the recipe book');
}
/** The journal's Skills tab: a row for each skill, fishing with the XP of the catch. */
async function skillsTab(page, { expect, check }) {
  await page.locator('.journal-button').tap();
  await until(page, (s) => s.screen === 'journal', 'the journal');
  await page.locator('#journal .journal-tab[data-tab="skills"]').tap();
  const state = await until(page, (s) => s.journal?.tab === 'skills', 'the Skills tab');
  await nextFrames(page);
  const rows = await page.locator('#journal .skill-row').evaluateAll((list) => list.map((row) => row.dataset.skill));
  const skills = state.skills?.skills.map((entry) => entry.skill) ?? [];
  expect(rows.length === 3 && JSON.stringify(rows) === JSON.stringify(skills), `the Skills tab shows ${JSON.stringify(rows)}, the server ${JSON.stringify(skills)}`);
  expect((state.skills?.skills.find((entry) => entry.skill === 'fishing')?.xp ?? 0) > 0, 'fishing has no XP after a catch');
  await check('the Skills tab', 'k7-skills');
  await page.locator('#journal .journal-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the journal');
}

/** Plays the skill part from the world, signed in as the prepared player beside the fishing spot. */
export async function playSkills(page, world, plan, { language, strings, expect, check, notes, keys = false }) {
  const say = (id) => strings[id][language];
  const name = (item) => ITEMS.get(item)?.name[language] ?? item;
  await until(page, (s) => s.screen === 'world' && s.skills !== null && s.progress !== null, 'the world with the skills');
  await fish(page, plan, { say, name, expect, check });
  await restingRefused(page, { say, expect });
  await walkByTaps(page, world, plan.stand, { notes });
  await forage(page, plan, { say, expect, check });
  await cook(page, plan, { name, expect, check, keys });
  await skillsTab(page, { expect, check });
}

/** At 360px wide, from beside the bush and the pot: the recipe book, a game's card and the Skills tab fit. */
export async function skillScreensFit(page, plan, { noSideways, check }) {
  await until(page, (s) => s.screen === 'world' && s.skills !== null && s.progress !== null, 'the world with the skills at 360px');
  await tapTile(page, plan.pot.tile);
  await until(page, (s) => s.screen === 'recipeBook' && s.recipeBook !== null, 'the recipe book at 360px', 10_000);
  await nextFrames(page);
  await noSideways('the recipe book');
  await check('the recipe book at 360px', 'book');
  await page.locator('#recipe-book .book-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the recipe book');
  await tapTile(page, plan.bush.tile);
  await newGame(page, 'sparkle', null, 'the foraging game at 360px');
  await nextFrames(page);
  await noSideways('the foraging game');
  await check('the foraging game at 360px', 'sparkle');
  await page.locator('#skill-game .skill-close').tap();
  await until(page, (s) => s.screen === 'world' && s.attempt === null, 'the world after closing the game');
  await page.locator('.journal-button').tap();
  await until(page, (s) => s.screen === 'journal', 'the journal at 360px');
  await page.locator('#journal .journal-tab[data-tab="skills"]').tap();
  await until(page, (s) => s.journal?.tab === 'skills', 'the Skills tab at 360px');
  await nextFrames(page);
  await noSideways('the Skills tab');
  await check('the Skills tab at 360px', 'skills');
  await page.locator('#journal .journal-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the journal');
}
