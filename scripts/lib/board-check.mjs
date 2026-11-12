// The job board, played the way a player would against the real server. The player starts from a
// save the check prepares (boardSave in scripts/lib/skill-saves.mjs) beside the board, with three
// jobs on it, the first a delivery whose items the bag holds. They tap the board and read the three
// cards, see the turn-in mark over the character the delivery is for, walk up and hand it over in
// a talk, see the job toast, then tap the board again and find the new job turned over in the
// delivered card's place. At 360px a player who never opened the board opens it for the first time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { nextFrames, openTalk, readState, settledOn, tilesToScreen, talkThrough, until, walkByTaps } from './game-page.mjs';
import { ROOT } from './server-process.mjs';

const NPCS = new Map(JSON.parse(readFileSync(join(ROOT, 'content/npcs.json'), 'utf8')).npcs.map((npc) => [npc.id, npc]));

const fill = (line, values) => line.replaceAll(/\{([a-zA-Z]+)\}/g, (blank, name) => (name in values ? String(values[name]) : blank));
const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();

/** Taps the board in the world and waits for its screen with `cards` cards. */
async function openBoard(page, plan, what) {
  await until(page, (s) => settledOn(s) && s.screen === 'world', `the courier to stand still before ${what}`);
  const [spot] = await tilesToScreen(page, [plan.board.tile]);
  if (!spot) throw new Error(`the board at ${plan.board.tile.x},${plan.board.tile.y} is not on screen to tap`);
  await page.touchscreen.tap(spot.x, spot.y);
  const state = await until(page, (s) => s.screen === 'jobBoard' && (s.jobs.screen?.cards.length ?? 0) > 0, what, 10_000);
  await nextFrames(page);
  return state;
}

async function closeBoard(page) {
  await page.locator('#job-board .job-board-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the board');
}

/** The board as prepared: three cards in the save's order, the delivery ready, its character named, and no first-visit hint. */
async function readBoard(page, plan, { language, say, expect, check }) {
  const opened = await openBoard(page, plan, 'the job board');
  const { cards, hint } = opened.jobs.screen;
  const wanted = plan.jobs.map((job) => job.job);
  expect(JSON.stringify(cards) === JSON.stringify(wanted), `the board shows the jobs ${JSON.stringify(cards)}, not ${JSON.stringify(wanted)}`);
  expect((await page.locator('#job-board .job-card').count()) === wanted.length, `the board draws ${await page.locator('#job-board .job-card').count()} cards, not ${wanted.length}`);
  expect(!hint && (await page.locator('#job-board .job-hint').count()) === 0, 'a board opened before still shows the first-visit hint');
  const card = page.locator(`#job-board .job-card[data-job="${plan.deliver.job}"]`);
  expect((await textOf(card, '.job-verb')) === say('jobs.verb.deliver'), `the delivery card is headed "${await textOf(card, '.job-verb')}"`);
  const to = fill(say('jobs.to'), { npc: NPCS.get(plan.deliver.to).name[language] });
  expect((await textOf(card, '.job-to-name')) === to, `the delivery card says "${await textOf(card, '.job-to-name')}", not "${to}"`);
  const inBag = fill(say('jobs.inBag'), { count: plan.deliver.count, of: plan.deliver.count });
  expect((await textOf(card, '.job-progress')) === inBag, `the delivery card says "${await textOf(card, '.job-progress')}", not "${inBag}"`);
  expect((await card.getAttribute('data-ready')) !== null, 'the delivery card is not marked ready with its items in the bag');
  await check('the job board', 'j1-board');
  await closeBoard(page);
}

/** Hands the delivery over: the character is marked, the talk delivers, a toast says the job is done, and the board has a new job. */
async function deliver(page, world, plan, { say, expect, check, notes }) {
  const marked = await until(page, (s) => s.npcs.some((npc) => npc.id === plan.deliver.to && npc.mark === 'turnIn'), `the turn-in mark over ${plan.deliver.to}`, 5_000);
  expect(marked.jobs.board?.length === plan.jobs.length, 'the test hook does not show the board');
  await openTalk(page, world, plan.deliver.to, { notes });
  await talkThrough(page);
  const toasted = await until(page, (s) => s.screen === 'world' && s.questToast?.lines[0] === say('jobs.toastDone'), 'the toast that the job is done', 10_000);
  const board = toasted.jobs.board ?? [];
  expect(!board.some((job) => job.job === plan.deliver.job), `the delivered job ${plan.deliver.job} is still on the board`);
  expect(board.length === plan.jobs.length && board.some((job) => job.job > plan.drawn), `the board after the delivery is ${JSON.stringify(board.map((job) => job.job))}, with no new job`);
  expect(toasted.questToast.lines.length > 1, `the job toast lists no rewards: ${JSON.stringify(toasted.questToast.lines)}`);
  await nextFrames(page);
  await check('the job toast', 'j2-job-toast');
}

/** Back at the board: the new job stands where the delivered one was, turned over, and the others kept their places. */
async function newCard(page, world, plan, { expect, check, notes }) {
  await walkByTaps(page, world, plan.stand, { notes });
  const opened = await openBoard(page, plan, 'the job board after the delivery');
  const { cards, flipped } = opened.jobs.screen;
  const at = plan.jobs.findIndex((job) => job.job === plan.deliver.job);
  const fresh = cards[at];
  expect(fresh > plan.drawn, `the delivered card's place shows job ${fresh}, not a new one (${JSON.stringify(cards)})`);
  expect(JSON.stringify(cards.filter((_, index) => index !== at)) === JSON.stringify(plan.jobs.filter((_, index) => index !== at).map((job) => job.job)), `the other cards moved: ${JSON.stringify(cards)}`);
  expect(JSON.stringify(flipped) === JSON.stringify([fresh]), `the cards turned over are ${JSON.stringify(flipped)}, not only the new job ${fresh}`);
  // The turn takes 0.6 s; the screenshot shows the card once it has turned.
  await page.waitForTimeout(700);
  await check('the new job on the board', 'j3-new-card');
  await closeBoard(page);
}

/** Plays the board part from the world, signed in as the prepared player beside the board. */
export async function playBoard(page, world, plan, { language, strings, expect, check, notes }) {
  const say = (id) => strings[id][language];
  await until(page, (s) => s.screen === 'world' && s.progress !== null && s.jobs.board?.length === plan.jobs.length, 'the world with the job board');
  await readBoard(page, plan, { language, say, expect, check });
  await deliver(page, world, plan, { say, expect, check, notes });
  await newCard(page, world, plan, { expect, check, notes });
  const { jobs } = await readState(page);
  expect(jobs.screen === null, 'the board screen is still open');
}

/** At 360px, a player who never opened the board opens it: three new cards and the first-visit hint, with nothing scrolling sideways. */
export async function boardScreenFits(page, plan, { language, strings, expect, noSideways, check }) {
  await until(page, (s) => s.screen === 'world' && s.progress !== null && s.jobs.board === null, 'the world with the board never opened');
  const opened = await openBoard(page, plan, 'the first job board at 360px');
  expect(opened.jobs.board?.length === plan.slots && opened.jobs.screen.cards.length === plan.slots, `the first board shows ${opened.jobs.screen.cards.length} cards, not ${plan.slots}`);
  expect(opened.jobs.screen.hint && (await textOf(page, '#job-board .job-hint')) === strings['jobs.hint'][language], 'the first visit shows no hint');
  expect(opened.jobs.screen.flipped.length === 0, 'a first board turns cards over');
  await noSideways('the job board');
  await check('the job board at 360px', 'board');
  await closeBoard(page);
}
