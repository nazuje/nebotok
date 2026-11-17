// Learning a move at a level up, against the real server. Nothing in the game reaches a learnset
// level quickly, so the browser check prepares the player's save in its own server's database
// (scripts/lib/prepared-saves.mjs) before the player first signs in: one glowbun a point of
// experience short of the level where it learns a fifth move, with a second creature behind it so
// the team screen shows how to swap, carrying one of every treat so the treat picker, opened once
// the wild creature has fainted, shows its favourite at 360px.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyProgress, loadBattleContent, newCreature, xpToNextLevel } from '../../packages/core/src/index.ts';
import { animationsSettled, battleIdle, nextFrames, readState, until, untilTappingThrough } from './game-page.mjs';
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

const SPECIES = 'glowbun';
const glowbun = CONTENT.species.get(SPECIES);
/** A learnset level well above the wild creatures near the spawn, so the battle is won, and the move learned there. */
const NEXT = glowbun.learnset.find((entry) => entry.level >= 12);
const LEVEL = NEXT.level - 1;
const power = (move) => CONTENT.moves.get(move)?.power ?? 0;
const MAX_TURNS = 40;
const TREATS = [...CONTENT.items.values()].filter((item) => item.kind === 'treat');
/** A second creature, never sent out, so the team screen has two to swap. */
const FRIEND = [...CONTENT.species.keys()].find((id) => id !== SPECIES);

const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();

/** The save data of a learner who has not been in the world yet, standing at `position`, for prepareSave. */
export function learnerSave({ name, language, position }) {
  const grown = newCreature(SPECIES, LEVEL, CONTENT);
  // The strongest move first, since the check attacks with the first one.
  const learner = { ...grown, xp: xpToNextLevel(LEVEL) - 1, moves: grown.moves.toSorted((a, b) => power(b) - power(a)) };
  return {
    name,
    language,
    createdAt: new Date().toISOString(),
    position,
    ...emptyProgress(),
    team: [learner, newCreature(FRIEND, 3, CONTENT)],
    befriended: [SPECIES, FRIEND],
    seen: [SPECIES, FRIEND],
    inventory: TREATS.map((item) => ({ item: item.id, count: 1 })),
  };
}

/**
 * The team of two shows the swap hint, two little cards trading places, before any swap on this
 * device. Closes the team screen again.
 */
export async function seeSwapHint(page, { expect, check }) {
  await page.locator('.team-button').tap();
  const opened = await until(page, (s) => s.screen === 'team' && s.teamScreen !== null, 'the team screen');
  await nextFrames(page);
  expect(opened.teamScreen.swapHint && (await page.locator('#team .swap-hint').isVisible()), 'the team of two shows no swap hint before the first swap');
  await check('the team screen with the swap hint', 'l0-team');
  await page.locator('#team .team-close').tap();
  return until(page, (s) => s.screen === 'world', 'the world after closing the team');
}

/**
 * Opens the treat picker on a fainted wild creature and sees its favourite marked: the heart and
 * "Favourite!" on the favourite's own button, on one line inside it, scrolled into view for the
 * screenshot. Goes back to the menu without offering anything.
 */
async function seeFavourite(page, state, { language, strings, expect, check }) {
  const species = state.battle.opponent.species;
  const favourite = CONTENT.items.get(CONTENT.species.get(species)?.favouriteTreat);
  await page.locator('#battle .battle-treat').tap();
  await until(page, (s) => s.battle?.panel === 'treats', 'the treat picker on the fainted wild creature');
  await nextFrames(page);
  const marked = page.locator('#battle .treat-choice[data-favourite="true"]');
  expect((await marked.count()) === 1, `the treat picker marks ${await marked.count()} treats as the wild ${species}'s favourite, not 1`);
  if ((await marked.count()) === 1 && favourite) {
    await marked.scrollIntoViewIfNeeded();
    const shown = await marked.evaluate((choice) => {
      const tag = choice.querySelector('.treat-favourite');
      const box = choice.getBoundingClientRect();
      const tagBox = tag?.getBoundingClientRect();
      // Line height is often "normal", so a wrapped tag is told by being two font sizes tall.
      const fontSize = tag ? Number.parseFloat(getComputedStyle(tag).fontSize) : 0;
      return {
        name: choice.querySelector('.treat-name')?.textContent,
        tag: tag?.textContent,
        inside: Boolean(tagBox) && tagBox.left >= box.left && tagBox.right <= box.right && choice.scrollWidth <= choice.clientWidth,
        oneLine: Boolean(tagBox) && tagBox.height < fontSize * 2,
      };
    });
    expect(shown.name === favourite.name[language], `the favourite marked is "${shown.name}", not "${favourite.name[language]}"`);
    expect(shown.tag === strings['battle.favouriteTag'][language], `the favourite tag says "${shown.tag}"`);
    expect(shown.inside && shown.oneLine, `the favourite tag does not fit its button on one line: ${JSON.stringify(shown)}`);
    expect((await marked.locator('canvas.picture[data-picture="pictures/heart"]').count()) === 1, 'the favourite treat shows no heart');
  }
  await check('the treat picker with the favourite', 'b3-favourite');
  await page.locator('#battle .battle-back').tap();
  return until(page, (s) => s.battle?.panel === 'menu', 'the battle menu after the treat picker');
}

/**
 * Attacks with the first move until the battle is won, leaving with Done once the wild creature has
 * fainted and waits for a treat, after `befriend` has looked at the treat picker.
 */
async function winBattle(page, state, befriend, turn = 0) {
  if (state.battle.panel === 'result' || turn >= MAX_TURNS) return state;
  await nextFrames(page);
  if (state.battle.phase === 'befriend') await befriend(state);
  await page.locator(state.battle.phase === 'befriend' ? '#battle .battle-run' : '#battle .move').first().tap();
  const next = await untilTappingThrough(page, (s) => battleIdle(s) && (s.battle.turn > state.battle.turn || s.battle.panel === 'result'), 'the next turn of the learner’s battle', 15_000);
  return winBattle(page, next, befriend, turn + 1);
}

/**
 * After a tap on the move in `slot`, sees it picked and nothing answered yet: only it pressed, its
 * name struck out, the new move sparkling in its place, the question asking to swap them, and a
 * check and a loop to confirm or go back.
 */
async function seePicked(page, slot, { swap, newName, expect }) {
  await animationsSettled(page);
  const seen = await page.locator('#learn').evaluate((screen) => {
    const picked = [...screen.querySelectorAll('.learn-forget[aria-pressed="true"]')];
    const coming = picked[0]?.querySelector('.learn-coming');
    const name = picked[0]?.querySelector('.learn-going .learn-name');
    return {
      picked: picked.map((button) => button.dataset.slot),
      coming: coming?.textContent,
      sparkle: Boolean(coming?.querySelector('canvas.picture[data-picture="pictures/star-burst"]')),
      struck: name ? getComputedStyle(name).textDecorationLine : null,
      question: screen.querySelector('.learn-question')?.textContent,
      check: Boolean(screen.querySelector('.learn-confirm .learn-yes canvas.picture[data-picture="pictures/check"]')),
      again: Boolean(screen.querySelector('.learn-confirm .learn-back canvas.picture[data-picture="pictures/again"]')),
    };
  });
  const shown = seen.picked.length === 1 && seen.picked[0] === String(slot) && seen.coming === newName && seen.sparkle && seen.struck === 'line-through';
  expect(shown && seen.question === swap(slot) && seen.check && seen.again, `picking move ${slot} shows ${JSON.stringify(seen)}`);
  const state = await readState(page);
  expect(state.screen === 'learn' && state.learning?.sent === false, `picking a move answered the offer: ${JSON.stringify(state.learning)}`);
}

/** After going back from a picked move, sees the moves to choose from again, with focus back on the move it left. */
async function seeChoosing(page, slot, { say, expect }) {
  await nextFrames(page);
  const seen = await page.locator('#learn').evaluate((screen) => ({
    picked: screen.querySelectorAll('.learn-forget[aria-pressed="true"]').length,
    confirm: screen.querySelectorAll('.learn-confirm').length,
    question: screen.querySelector('.learn-question')?.textContent,
    focused: document.activeElement?.closest('.learn-forget')?.getAttribute('data-slot') ?? null,
  }));
  expect(seen.picked === 0 && seen.confirm === 0 && seen.question === say('learn.forget') && seen.focused === String(slot), `going back from move ${slot} shows ${JSON.stringify(seen)}`);
  const state = await readState(page);
  expect(state.screen === 'learn' && state.learning?.sent === false, `going back answered the offer: ${JSON.stringify(state.learning)}`);
}

/**
 * From a wild battle on the page of a seeded learner: wins it, sees the level up, continues, sees
 * "{creature} wants to learn {move}" with the four moves it knows, and answers it, forgetting the
 * move in slot `forget` or, for null, keeping them all. Forgetting picks another move and goes back
 * first, then picks `forget` by keyboard and taps the check; keeping them picks a move, switches to
 * another and goes back before keeping them all. `check(where, step)` looks for small targets and
 * sideways scrolling, and takes the screenshot.
 */
export async function playLearning(page, { language, strings, forget, expect, check }) {
  const say = (id) => strings[id][language];
  const name = (kind, id) => CONTENT[kind].get(id)?.name[language] ?? id;
  let looked = false;
  const befriend = async (state) => {
    if (looked) return;
    looked = true;
    await seeFavourite(page, state, { language, strings, expect, check });
  };
  const won = await winBattle(page, await untilTappingThrough(page, battleIdle, 'the learner’s battle to offer a choice', 15_000), befriend);
  expect(looked, 'the wild creature never waited for a treat, so the treat picker was not seen');
  expect(won.battle.outcome?.winner === 0, `the learner’s battle ended ${JSON.stringify(won.battle.outcome)}, not in a win`);
  expect(won.battle.rewards[0]?.level === NEXT.level, `the learner reached level ${won.battle.rewards[0]?.level}, not ${NEXT.level}`);
  await nextFrames(page);
  const pictured = await page.locator('#battle .battle-result').evaluate((box) => ({
    kind: box.querySelector('.result-hero')?.getAttribute('data-kind'),
    trophy: box.querySelector('.result-hero canvas.picture[data-picture="pictures/trophy"]') !== null,
    levelUps: box.querySelectorAll('.result-reward .result-level-up').length,
  }));
  expect(pictured.kind === 'won' && pictured.trophy && pictured.levelUps === 1, `the won result shows ${JSON.stringify(pictured)}, not the trophy and one level up`);
  await animationsSettled(page);
  await check('the result before learning', 'l1-result');
  await page.locator('#battle .battle-continue').tap();

  const asked = await until(page, (s) => s.screen === 'learn' && s.learning !== null, 'the move to learn after the battle');
  const { offer } = asked.learning;
  expect(offer.index === 0 && offer.species === SPECIES && offer.move === NEXT.move, `the offer is ${JSON.stringify(offer)}`);
  await nextFrames(page);
  const wanted = say('learn.wants').replace('{creature}', name('species', SPECIES)).replace('{move}', name('moves', NEXT.move));
  expect((await textOf(page, '#learn .learn-title')) === wanted, `the prompt says "${await textOf(page, '#learn .learn-title')}", not "${wanted}"`);
  const shown = await page.locator('#learn .learn-forget').evaluateAll((buttons) => buttons.map((button) => ({ text: button.textContent, className: button.className })));
  const moves = offer.moves.map((move) => ({ text: name('moves', move), type: CONTENT.moves.get(move)?.type }));
  expect(shown.length === moves.length && shown.every((button, at) => button.text === moves[at].text && button.className.includes(`type-${moves[at].type}`)), `the moves to forget show ${JSON.stringify(shown)}`);
  expect((await textOf(page, '#learn .learn-skip')) === say('learn.skip'), 'the button to keep the moves has the wrong text');
  expect((await page.locator('#learn .learn-skip canvas.picture[data-picture="pictures/cross"]').count()) === 1, 'the button to keep the moves shows no cross');
  expect(await page.locator('#learn .learn-toward').isVisible(), 'no arrow points from the new move to the moves it can replace');
  expect((await page.locator('#learn .learn-forget canvas.picture[data-picture="pictures/puff"]').count()) === offer.moves.length, 'not every move to forget shows a puff of smoke');
  expect((await page.locator('#learn .learn-new canvas.picture[data-picture="pictures/star-burst"]').count()) === 1, 'the new move shows no sparkle');
  expect((await page.locator('#learn .learn-confirm').count()) === 0, 'the check to swap shows before a move is picked');
  await check('the move to learn', 'l2-learn');

  const newName = name('moves', NEXT.move);
  const swap = (slot) => say('learn.swap').replace('{old}', name('moves', offer.moves[slot])).replace('{move}', newName);
  const slotButton = (slot) => page.locator(`#learn .learn-forget[data-slot="${slot}"]`);
  const pickedWith = { swap, newName, expect };
  if (forget === null) {
    await slotButton(0).tap();
    await seePicked(page, 0, pickedWith);
    await slotButton(2).tap();
    await seePicked(page, 2, pickedWith);
    await check('a move picked to forget', 'l3-picked');
    await page.locator('#learn .learn-back').tap();
    await seeChoosing(page, 2, { say, expect });
    await page.locator('#learn .learn-skip').tap();
  } else {
    const other = forget === 0 ? 1 : 0;
    await slotButton(other).tap();
    await seePicked(page, other, pickedWith);
    await page.locator('#learn .learn-back').tap();
    await seeChoosing(page, other, { say, expect });
    await slotButton(forget).focus();
    await page.keyboard.press('Enter');
    await seePicked(page, forget, pickedWith);
    expect(await page.evaluate(() => document.activeElement?.classList.contains('learn-yes') ?? false), 'picking a move by keyboard does not move on to the check');
    await check('a move picked to forget', 'l3-picked');
    await page.locator('#learn .learn-yes').tap();
  }
  const knows = forget === null ? offer.moves : offer.moves.with(forget, NEXT.move);
  const back = await until(page, (s) => s.screen === 'world' && s.learning === null && JSON.stringify(s.progress?.team[0]?.moves) === JSON.stringify(knows), 'the world after answering');
  expect(back.progress.team[0].level === NEXT.level, `the learner is level ${back.progress.team[0].level} after answering`);
  return readState(page);
}
