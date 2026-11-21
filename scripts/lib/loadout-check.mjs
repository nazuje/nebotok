// The loadout picker and the new-move toast (#154), against the real server. A player prepared one
// point of experience short of the level where their glowbun learns a second special move, knowing
// only three moves so the move is learned at once, opens the picker on a young creature whose
// buttons 2 and 3 are still locked and sees a tap on them do nothing, wins a wild battle, taps the
// new-move toast, holds the new move to try it, puts it on button 2, and finds it still there after
// a reload. The learn check (learn-check.mjs) sees the toast that follows the turn battle's
// question. Every picker control must be at least 64px: they are the fight's buttons.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyProgress, loadBattleContent, newCreature, xpToNextLevel } from '../../packages/core/src/index.ts';
import { animationsSettled, battleIdle, meetWildCreature, nextFrames, pictureProblems, readState, until, untilTappingThrough } from './game-page.mjs';
import { inTurn } from './in-turn.mjs';
import { winBattle } from './learn-check.mjs';
import { ROOT } from './server-process.mjs';

const readContent = (path) => JSON.parse(readFileSync(join(ROOT, 'content', path), 'utf8'));
const CONTENT = loadBattleContent({
  weather: readContent('creatures/weather.json'),
  moves: readContent('creatures/moves.json'),
  species: readContent('creatures/species.json'),
  rules: readContent('creatures/battle-rules.json'),
  befriending: readContent('creatures/befriending.json'),
  items: readContent('items.json'),
  arena: readContent('creatures/arena.json'),
});

const SPECIES = 'glowbun';
/** The first level from 12, where all three buttons are unlocked, at which it learns a move: a second special. */
const NEXT = CONTENT.species.get(SPECIES).learnset.find((entry) => entry.level >= 12);
const LEVEL = NEXT.level - 1;
/** Button 2, the special move's. */
const SPECIAL = 1;
const BIG_PX = 64;
const power = (move) => CONTENT.moves.get(move)?.power ?? 0;
/** A young second creature, whose buttons 2 and 3 are locked. */
const YOUNG = { species: [...CONTENT.species.keys()].find((id) => id !== SPECIES), level: 3 };
/** The pips docs/arena.md gives each power. */
const PIPS = { 0: 0, 40: 1, 50: 1, 65: 2, 80: 2, 100: 3 };

/** The move the prepared glowbun learns in the battle, which the toast and the picker show. */
export const LEARNED_MOVE = NEXT.move;

/** The save data of a player who has not been in the world yet, standing at `position`, for prepareSave. */
export function loadoutSave({ name, language, position }) {
  const grown = newCreature(SPECIES, LEVEL, CONTENT);
  // The strongest three, strongest first since the battle attacks with the first: a free place, so the move is learned at once.
  const fighter = { ...grown, xp: xpToNextLevel(LEVEL) - 1, moves: grown.moves.toSorted((a, b) => power(b) - power(a)).slice(0, 3) };
  return {
    name,
    language,
    createdAt: new Date().toISOString(),
    position,
    ...emptyProgress(),
    team: [fighter, newCreature(YOUNG.species, YOUNG.level, CONTENT)],
    befriended: [SPECIES, YOUNG.species],
    seen: [SPECIES, YOUNG.species],
  };
}

/** Every button tile, move tile and the toast under BIG_PX either way. */
const smallFightButtons = (page) =>
  page.locator('.loadout-slot, .loadout-move, .new-move-toast:not([hidden])').evaluateAll(
    (items, least) =>
      items
        .map((item) => ({ item, box: item.getBoundingClientRect() }))
        .filter(({ box }) => box.width > 0 && (box.width < least || box.height < least))
        .map(({ item, box }) => `${item.className} ${Math.round(box.width)}x${Math.round(box.height)}`),
    BIG_PX,
  );

/** The picker shows each move offered for the button with its picture, its type's colour and its pips, the one on the button pressed. */
async function seeOffered(page, state, { language, expect }) {
  const tiles = await page.locator('#loadout .loadout-move').evaluateAll((buttons) =>
    buttons.map((tile) => ({ move: tile.dataset.move, pressed: tile.getAttribute('aria-pressed'), className: tile.className, icon: tile.querySelector('.ability-icon')?.dataset.move, pips: tile.querySelector('.loadout-pips')?.dataset.pips, name: tile.querySelector('.loadout-move-name')?.textContent })),
  );
  const { index, button, offered } = state.loadout;
  const creature = state.progress.team[index];
  const wanted = creature.learned.filter((move) => CONTENT.moves.get(move)?.arena?.kind === ['quick', 'special', 'ultimate'][button]);
  expect(JSON.stringify(offered) === JSON.stringify(wanted) && JSON.stringify(tiles.map((tile) => tile.move)) === JSON.stringify(wanted), `button ${button + 1} offers ${JSON.stringify(tiles.map((tile) => tile.move))}, not the learned moves of its kind ${JSON.stringify(wanted)}`);
  for (const tile of tiles) {
    const move = CONTENT.moves.get(tile.move);
    expect(tile.icon === tile.move && tile.className.includes(`type-${move?.type}`), `the tile of ${tile.move} has no picture or colour: ${JSON.stringify(tile)}`);
    expect(tile.pips === String(PIPS[move?.power]), `${tile.move} of power ${move?.power} shows ${tile.pips} pips, not ${PIPS[move?.power]}`);
    expect(tile.name === move?.name[language], `${tile.move} is named "${tile.name}"`);
    expect(tile.pressed === String(creature.loadout[button] === tile.move), `${tile.move} is pressed ${tile.pressed} with the loadout ${JSON.stringify(creature.loadout)}`);
  }
}

async function checkFightButtons(page, where, expect) {
  for (const target of await smallFightButtons(page)) expect(false, `${where}: fight button under ${BIG_PX}px: ${target}`);
}

/**
 * On the team screen, opens the picker on the young creature: its buttons 2 and 3 show the lock and
 * their level, and a tap on them changes nothing. Done goes back to the team screen.
 */
async function seeLockedButtons(page, { strings, language, expect, check }) {
  await page.locator('.team-button').tap();
  await until(page, (s) => s.screen === 'team', 'the team screen');
  await page.locator('#team .team-loadout').nth(1).tap();
  const opened = await until(page, (s) => s.screen === 'loadout' && s.loadout?.index === 1, 'the picker on the young creature');
  await nextFrames(page);
  const locks = await page.locator('#loadout .loadout-slot.locked').evaluateAll((slots) =>
    slots.map((slot) => ({ button: slot.dataset.button, lock: slot.querySelector('[data-picture="pictures/lock"]') !== null, digits: slot.querySelectorAll('[data-picture="pictures/digits"]').length, label: slot.getAttribute('aria-label') })),
  );
  const levels = CONTENT.arena.buttons;
  expect(locks.length === 2 && locks.every((slot) => slot.lock && slot.digits === String(levels[Number(slot.button)]).length), `the young creature's locked buttons show ${JSON.stringify(locks)}`);
  expect(locks.every((slot) => slot.label?.endsWith(strings['arena.locked'][language].replace('{level}', String(levels[Number(slot.button)])))), `the locked buttons are labelled ${JSON.stringify(locks.map((slot) => slot.label))}`);
  await seeOffered(page, opened, { language, expect });
  await checkFightButtons(page, 'the picker with locked buttons', expect);
  await check('the picker with locked buttons', 'loadout-locked');
  // A real tap even though the button says it is disabled, which Playwright would otherwise wait out.
  await inTurn([1, 2], (button) => page.locator(`#loadout .loadout-slot[data-button="${button}"]`).tap({ force: true }));
  await nextFrames(page);
  const after = await readState(page);
  expect(after.loadout?.button === 0 && after.loadout.pending === null, `a tap on a locked button changed the picker: ${JSON.stringify(after.loadout)}`);
  for (const problem of await pictureProblems(page, { '#loadout .loadout-done': 'pictures/check' })) expect(false, `the picker: ${problem}`);
  await page.locator('#loadout .loadout-done').tap();
  await until(page, (s) => s.screen === 'team' && s.loadout === null, 'the team screen after the picker');
  await page.locator('#team .team-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the team screen');
}

/**
 * From the world, with the toast for `move` up: taps it, sees the picker open on the creature and
 * the button of its kind, holds the move to try it on the mini island without choosing it, then
 * taps it onto the button and waits for the server's "Saved". `prefix` names the screenshots.
 */
export async function pickFromToast(page, { move, prefix, strings, language, expect, check }) {
  const toasted = await until(page, (s) => s.screen === 'world' && s.newMove?.move === move, `the toast for ${move}`);
  const { index } = toasted.newMove;
  await animationsSettled(page);
  const sharing = await page.locator('.toast:not([hidden]), .welcome:not([hidden])').count();
  expect(sharing === 0, 'the new-move toast shows over another message at the bottom');
  const toast = await page.locator('.new-move-toast').evaluate((shown) => ({
    star: shown.querySelector('[data-picture="pictures/star-burst"]') !== null,
    icon: shown.querySelector('.ability-icon')?.dataset.move,
    portrait: shown.querySelector('canvas.creature') !== null,
    label: shown.getAttribute('aria-label'),
  }));
  expect(toast.star && toast.icon === move && toast.portrait, `the new-move toast shows ${JSON.stringify(toast)}`);
  expect(toast.label?.includes(CONTENT.moves.get(move)?.name[language]), `the new-move toast is labelled "${toast.label}"`);
  await checkFightButtons(page, 'the new-move toast', expect);
  await check('the new-move toast', `${prefix}-toast`);
  await page.locator('.new-move-toast').tap();
  const button = ['quick', 'special', 'ultimate'].indexOf(CONTENT.moves.get(move)?.arena?.kind);
  const opened = await until(page, (s) => s.screen === 'loadout' && s.loadout?.index === index && s.newMove === null, 'the picker from the toast');
  expect(opened.loadout.button === button && opened.loadout.offered.includes(move), `the toast opened the picker on button ${opened.loadout.button + 1} offering ${JSON.stringify(opened.loadout.offered)}`);
  await nextFrames(page);
  await seeOffered(page, opened, { language, expect });
  await checkFightButtons(page, 'the picker', expect);
  await check('the loadout picker', `${prefix}-picker`);

  const tile = page.locator(`#loadout .loadout-move[data-move="${move}"]`);
  const box = await tile.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await until(page, (s) => s.loadout?.trying === move, `${move} playing on the mini island while held`);
  await nextFrames(page);
  await check('trying a move on the mini island', `${prefix}-try`);
  await page.mouse.up();
  const tried = await until(page, (s) => s.loadout?.trying === null, 'the mini island put away');
  expect(tried.loadout.pending === null && tried.progress.team[index].loadout[button] !== move, `holding ${move} to try it chose it: ${JSON.stringify(tried.loadout)}`);

  await tile.tap();
  const saved = await until(page, (s) => s.progress.team[index].loadout[button] === move && s.loadout?.saved === true, `${move} saved on button ${button + 1}`);
  await nextFrames(page);
  expect((await page.locator('#loadout .loadout-answer').textContent())?.trim() === strings['loadout.saved'][language], 'the picker does not say the change is saved');
  expect((await page.locator(`#loadout .loadout-slot[data-button="${button}"] .ability-icon`).getAttribute('data-move')) === move, `button ${button + 1} does not show ${move}`);
  await seeOffered(page, saved, { language, expect });
  await check('the move saved on its button', `${prefix}-saved`);
  await page.locator('#loadout .loadout-done').tap();
  await until(page, (s) => s.screen === 'world' && s.loadout === null, 'the world after the picker');
  return { index, button };
}

/** After a reload, the team screen's picker still shows `move` on `button` of the creature at `index`. */
export async function keptAfterReload(page, { index, button, move, expect, check, prefix }) {
  await page.reload();
  await until(page, (s) => s.screen === 'world' && s.progress?.team[index]?.loadout[button] === move, `${move} still on button ${button + 1} after a reload`);
  await page.locator('.team-button').tap();
  await until(page, (s) => s.screen === 'team', 'the team screen after the reload');
  await page.locator('#team .team-loadout').nth(index).tap();
  await until(page, (s) => s.screen === 'loadout' && s.loadout?.index === index, 'the picker after the reload');
  await page.locator(`#loadout .loadout-slot[data-button="${button}"]`).tap();
  await until(page, (s) => s.loadout?.button === button, `button ${button + 1} after the reload`);
  await nextFrames(page);
  expect((await page.locator('#loadout .loadout-move[aria-pressed="true"]').getAttribute('data-move')) === move, `${move} is not chosen for button ${button + 1} after a reload`);
  await check('the picker after a reload', `${prefix}-reloaded`);
  await page.locator('#loadout .loadout-done').tap();
  await until(page, (s) => s.screen === 'team', 'the team screen after the picker');
  await page.locator('#team .team-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the team screen');
}

/** Turns the turtle setting on from the settings and sees it saved. */
async function turnTurtleOn(page, { expect, check }) {
  await page.locator('.settings-button').tap();
  expect((await page.locator('.turtle [data-picture="pictures/turtle"]').count()) === 1, 'the turtle setting shows no turtle');
  await page.locator('.turtle').tap();
  await until(page, (s) => s.turtle === true, 'the turtle setting on');
  await check('the settings with the turtle on', 'loadout-turtle');
  await page.locator('.settings-button').tap();
}

/**
 * The whole loadout run, from the world on a page signed in as a loadoutSave player: the locked
 * buttons, a battle won with a level up, the toast, the picker, the reload and the turtle setting.
 */
export async function playLoadout(page, world, { strings, language, expect, check, notes }) {
  await seeLockedButtons(page, { strings, language, expect, check });
  await meetWildCreature(page, world, { notes });
  const won = await winBattle(page, await untilTappingThrough(page, battleIdle, 'the loadout player’s battle', 15_000), async () => {});
  expect(won.battle.learned.some((learned) => learned.index === 0 && learned.move === LEARNED_MOVE), `the battle taught ${JSON.stringify(won.battle.learned)}, not ${LEARNED_MOVE} at once`);
  await page.locator('#battle .battle-continue').tap();
  const { index, button } = await pickFromToast(page, { move: LEARNED_MOVE, prefix: 'loadout', strings, language, expect, check });
  await keptAfterReload(page, { index, button, move: LEARNED_MOVE, expect, check, prefix: 'loadout' });
  expect(button === SPECIAL, `the new move went on button ${button + 1}, not button ${SPECIAL + 1}`);
  await turnTurtleOn(page, { expect, check });
}
