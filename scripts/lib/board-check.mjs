// The job board, played the way a player would against the real server. The player starts from a
// save the check prepares (boardSave in scripts/lib/skill-saves.mjs) beside the board, with three
// jobs on it, the first a delivery whose items the bag holds. They tap the board and read the three
// cards, see the turn-in mark over the character the delivery is for, walk up and hand it over in
// a talk, see the job toast, then tap the board again and find the new job turned over in the
// delivered card's place. At 360px a player who never opened the board opens it for the first time.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTROL_PICTURES, nextFrames, openTalk, pictureProblems, readState, settledOn, tilesToScreen, talkThrough, until, walkByTaps } from './game-page.mjs';
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

/**
 * What a child who cannot read sees on the board: each card's verb as a picture (the skill at work,
 * or the envelope for a delivery), its pips, and its XP rewards as a bar. The prepared delivery
 * also shows its character's face and the check of a job ready to hand over.
 */
async function boardPictures(page, plan, { expect }) {
  const cards = await page.locator('#job-board .job-card').evaluateAll((list) =>
    list.map((card) => ({
      job: Number(card.dataset.job),
      kind: card.dataset.kind,
      verb: card.querySelector('.job-verb-art')?.dataset.picture ?? null,
      pips: card.querySelectorAll('.job-pip').length,
      of: Number(card.querySelector('.job-pips')?.dataset.of ?? 0),
      xpBars: card.querySelectorAll('.job-xp .job-xp-bar').length,
      xp: card.querySelectorAll('.job-xp').length,
      portrait: card.querySelector('.job-to canvas.job-portrait') !== null,
      check: card.querySelector('.job-ready-check') !== null,
      filled: Number(card.querySelector('.job-pips')?.dataset.filled ?? -1),
    })),
  );
  for (const card of cards) {
    const verb = card.kind === 'deliver' ? card.verb === 'pictures/envelope' : card.verb?.startsWith('actions/');
    expect(verb, `the ${card.kind} card ${card.job} shows the verb picture ${card.verb}`);
    expect(card.pips > 0 && card.pips === card.of, `the card ${card.job} shows ${card.pips} pips for ${card.of} items`);
    expect(card.xp > 0 && card.xpBars === card.xp, `the card ${card.job} shows ${card.xpBars} XP bars for ${card.xp} XP rewards`);
  }
  const delivery = cards.find((card) => card.job === plan.deliver?.job);
  if (delivery) {
    expect(delivery.portrait, 'the delivery card shows no face of the character it goes to');
    expect(delivery.check && delivery.filled === plan.deliver.count, `the ready delivery shows ${delivery.filled} pips filled and ${delivery.check ? 'a' : 'no'} check`);
  }
}

/**
 * Every card is in view on the board, or the arrow at its bottom says more are below and a tap on
 * it scrolls them up. A card is in view when its bottom is.
 */
async function cardsReachable(page, where, { expect, notes }) {
  const fold = () =>
    page.evaluate(() => {
      const scroll = document.querySelector('#job-board .job-board-scroll');
      const bottom = scroll.getBoundingClientRect().bottom;
      const below = [...scroll.querySelectorAll('.job-card')].filter((card) => card.getBoundingClientRect().bottom > bottom + 8).map((card) => card.dataset.job);
      const more = document.querySelector('#job-board .job-more');
      return { below, more: more !== null && !more.hidden, top: scroll.scrollTop };
    });
  const before = await fold();
  if (before.below.length === 0) {
    expect(!before.more, `${where}: the arrow for more cards shows with every card in view`);
    return;
  }
  notes.push(`${where}: card ${before.below.join(', ')} starts below the board's bottom, with the arrow`);
  expect(before.more, `${where}: card ${before.below.join(', ')} is below the board's bottom with no arrow to say so`);
  if (!before.more) return;
  await page.locator('#job-board .job-more').tap();
  const scrolled = await page
    .waitForFunction((top) => (document.querySelector('#job-board .job-board-scroll')?.scrollTop ?? 0) > top, before.top, { timeout: 3_000 })
    .then(() => true)
    .catch(() => false);
  expect(scrolled, `${where}: a tap on the arrow does not scroll the board`);
  await page.locator('#job-board .job-board-scroll').evaluate((scroll) => scroll.scrollTo({ top: 0 }));
  await nextFrames(page);
}

/** The board as prepared: three cards in the save's order, the delivery ready, its character named, and no first-visit hint. */
async function readBoard(page, plan, { language, say, expect, check, notes }) {
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
  await boardPictures(page, plan, { expect });
  await cardsReachable(page, 'the job board', { expect, notes });
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
  const news = await page.locator('.quest-toast .job-news[data-change="done"]').evaluateAll((list) => list.map((each) => ({ stamp: each.querySelector('.job-stamp') !== null, rewards: each.querySelectorAll('.job-news-reward').length })));
  expect(news.length === 1 && news[0].stamp && news[0].rewards > 0, `the job toast shows no stamp and reward pictures: ${JSON.stringify(news)}`);
  // The stamp comes down in 0.45 s; the screenshot shows it landed.
  await page.waitForTimeout(500);
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
  await readBoard(page, plan, { language, say, expect, check, notes });
  await deliver(page, world, plan, { say, expect, check, notes });
  await newCard(page, world, plan, { expect, check, notes });
  const { jobs } = await readState(page);
  expect(jobs.screen === null, 'the board screen is still open');
}

/**
 * At 360px, a player who never opened the board opens it: three new cards with their pictures and
 * the first-visit hint, each card in view or the arrow saying more are below, and nothing
 * scrolling sideways.
 */
export async function boardScreenFits(page, plan, { language, strings, expect, noSideways, check, notes }) {
  await until(page, (s) => s.screen === 'world' && s.progress !== null && s.jobs.board === null, 'the world with the board never opened');
  const opened = await openBoard(page, plan, 'the first job board at 360px');
  expect(opened.jobs.board?.length === plan.slots && opened.jobs.screen.cards.length === plan.slots, `the first board shows ${opened.jobs.screen.cards.length} cards, not ${plan.slots}`);
  expect(opened.jobs.screen.hint && (await textOf(page, '#job-board .job-hint')) === strings['jobs.hint'][language], 'the first visit shows no hint');
  expect(opened.jobs.screen.flipped.length === 0, 'a first board turns cards over');
  await boardPictures(page, { deliver: null }, { expect });
  await cardsReachable(page, 'the first job board at 360px', { expect, notes });
  await noSideways('the job board');
  for (const problem of await pictureProblems(page, { '#job-board .job-board-close': CONTROL_PICTURES.close })) expect(false, `the job board at 360px: ${problem}`);
  await check('the job board at 360px', 'board');
  await closeBoard(page);
}
