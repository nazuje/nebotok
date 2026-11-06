// Learning a move at a level up, against the real server. Nothing in the game reaches a learnset
// level quickly, so the browser check prepares the player's save in its own server's database
// (scripts/lib/prepared-saves.mjs) before the player first signs in: one glowbun a point of
// experience short of the level where it learns a fifth move.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyProgress, loadBattleContent, newCreature, xpToNextLevel } from '../../packages/core/src/index.ts';
import { battleIdle, nextFrames, readState, until } from './game-page.mjs';
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

const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();

/** The save data of a learner who has not been in the world yet, standing at `position`, for prepareSave. */
export function learnerSave({ name, language, position }) {
  const grown = newCreature(SPECIES, LEVEL, CONTENT);
  // The strongest move first, since the check attacks with the first one.
  const learner = { ...grown, xp: xpToNextLevel(LEVEL) - 1, moves: grown.moves.toSorted((a, b) => power(b) - power(a)) };
  return { name, language, createdAt: new Date().toISOString(), position, ...emptyProgress(), team: [learner], befriended: [SPECIES], seen: [SPECIES] };
}

/** Attacks with the first move until the battle is won, running once the wild creature has fainted and waits for a treat. */
async function winBattle(page, state, turn = 0) {
  if (state.battle.panel === 'result' || turn >= MAX_TURNS) return state;
  await nextFrames(page);
  await page.locator(state.battle.phase === 'befriend' ? '#battle .battle-run' : '#battle .move').first().tap();
  const next = await until(page, (s) => battleIdle(s) && (s.battle.turn > state.battle.turn || s.battle.panel === 'result'), 'the next turn of the learner’s battle', 15_000);
  return winBattle(page, next, turn + 1);
}

/**
 * From a wild battle on the page of a seeded learner: wins it, sees the level up, continues, sees
 * "{creature} wants to learn {move}" with the four moves it knows, and answers it, forgetting the
 * move in slot `forget` or, for null, keeping them all. `check(where, step)` looks for small targets
 * and sideways scrolling, and takes the screenshot.
 */
export async function playLearning(page, { language, strings, forget, expect, check }) {
  const say = (id) => strings[id][language];
  const name = (kind, id) => CONTENT[kind].get(id)?.name[language] ?? id;
  const won = await winBattle(page, await until(page, battleIdle, 'the learner’s battle to offer a choice', 15_000));
  expect(won.battle.outcome?.winner === 0, `the learner’s battle ended ${JSON.stringify(won.battle.outcome)}, not in a win`);
  expect(won.battle.rewards[0]?.level === NEXT.level, `the learner reached level ${won.battle.rewards[0]?.level}, not ${NEXT.level}`);
  await nextFrames(page);
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
  await check('the move to learn', 'l2-learn');

  await page.locator(forget === null ? '#learn .learn-skip' : `#learn .learn-forget[data-slot="${forget}"]`).tap();
  const knows = forget === null ? offer.moves : offer.moves.with(forget, NEXT.move);
  const back = await until(page, (s) => s.screen === 'world' && s.learning === null && JSON.stringify(s.progress?.team[0]?.moves) === JSON.stringify(knows), 'the world after answering');
  expect(back.progress.team[0].level === NEXT.level, `the learner is level ${back.progress.team[0].level} after answering`);
  return readState(page);
}
