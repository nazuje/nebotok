// The bag, the journal and a quest toast, played the way a player would against the real server.
// The player starts from a save the check prepares (scripts/lib/prepared-saves.mjs): the first quest
// in story order with a step done by resting at a shrine on the map is active at that step, with
// every quest it needs done, and the bag holds a few treats. The player opens the bag and reads
// about a treat, opens the journal and finds the quest, asks "Where next?" and sees the camera go
// to the shrine, walks there and sees the quest toast, and finds the quest moved on in the journal.
// While no quest has such a step, the first quest is active at its first step instead, with its
// delivery (if any) in the bag, and the toast is left out with a note: without a talk on the page,
// nothing else changes a quest.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { loadBattleContent, loadStoryContent, newCreature } from '../../packages/core/src/index.ts';
import { inTurn } from './in-turn.mjs';
import { nextFrames, readState, tilesToScreen, until, walkByTaps } from './game-page.mjs';
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
const dialogue = Object.fromEntries(
  readdirSync(join(ROOT, 'content/dialogue'))
    .filter((file) => file.endsWith('.json'))
    .map((file) => [file.slice(0, -'.json'.length), readContent(`dialogue/${file}`)]),
);
const STORY = loadStoryContent(
  {
    npcs: readContent('npcs.json'), dialogue, quests: readContent('quests.json'), story: readContent('story.json'), inventory: readContent('inventory.json'),
    skills: { skills: readContent('skills.json'), spots: readContent('spots.json'), recipes: readContent('recipes.json'), stations: readContent('stations.json'), jobs: readContent('jobs.json') },
  },
  CONTENT,
);
const STARTERS = readContent('starters.json');
const TREATS = [...CONTENT.items.values()].filter((item) => item.kind === 'treat').slice(0, 3);
const TREATS_EACH = 2;
const BAG_ORDER = readContent('inventory.json').order;
/** The camera's pan in apps/game/src/world-scene.ts, and a little more for the frame after. */
const PAN_MS = 900;

const textOf = async (page, selector) => (await page.locator(selector).first().textContent())?.trim();
const fill = (line, values) => line.replaceAll(/\{([a-zA-Z]+)\}/g, (blank, name) => (name in values ? String(values[name]) : blank));

/** Every quest `id` needs done first, and the ones those need, in story order. */
function needed(id) {
  const found = new Set();
  const visit = (quest) => {
    for (const before of STORY.quests.get(quest)?.requires ?? []) {
      if (found.has(before)) continue;
      found.add(before);
      visit(before);
    }
  };
  visit(id);
  return STORY.chapters.flatMap((chapter) => chapter.quests).filter((quest) => found.has(quest));
}

/**
 * The first quest in story order with a step done by resting at a shrine of `map`, at that step,
 * or else the first quest at its first step, with no toast to play.
 */
function storyPlan(map) {
  const order = STORY.chapters.flatMap((chapter) => chapter.quests);
  for (const id of order) {
    const quest = STORY.quests.get(id);
    const at = quest.steps.findIndex((step) => step.kind === 'visitShrine' && map.shrines[step.shrine]);
    if (at >= 0) return { quest, at, chapter: quest.chapter, tile: map.shrines[quest.steps[at].shrine], toast: true, carried: [] };
  }
  const quest = STORY.quests.get(order[0]);
  const [step] = quest.steps;
  const carried = step.kind === 'deliver' ? [{ item: step.item, count: step.count }] : [];
  return { quest, at: 0, chapter: quest.chapter, tile: null, toast: false, carried };
}

/** The save the story check starts from, and what it plays: see the top of this file. */
export function storySave(world, { name, language }) {
  const plan = storyPlan(world.map);
  const starter = STARTERS.species[0];
  const inventory = [...plan.carried, ...TREATS.map((item) => ({ item: item.id, count: TREATS_EACH }))];
  return {
    plan: { ...plan, done: needed(plan.quest.id), inventory },
    data: {
      name,
      language,
      createdAt: new Date().toISOString(),
      position: null,
      team: [newCreature(starter, STARTERS.level, CONTENT)],
      storage: [],
      inventory,
      lastShrine: null,
      seen: [starter],
      befriended: [starter],
      story: { active: [{ quest: plan.quest.id, step: plan.at, count: 0 }], done: needed(plan.quest.id), flags: [] },
      skills: [],
      jobs: null,
    },
  };
}

/** The bag: a section per kind it holds, in inventory.json order, each treat named and counted, and a tap saying what one is. */
async function lookInBag(page, plan, { language, say, expect, check }) {
  await page.locator('.bag-button').tap();
  await until(page, (s) => s.screen === 'bag' && s.bag !== null, 'the bag');
  await nextFrames(page);
  const kinds = await page.locator('#bag .bag-section').evaluateAll((sections) => sections.map((section) => section.dataset.kind));
  const held = new Set(plan.inventory.map(({ item }) => CONTENT.items.get(item).kind));
  const sections = BAG_ORDER.filter((kind) => held.has(kind));
  expect(JSON.stringify(kinds) === JSON.stringify(sections), `the bag shows the sections ${JSON.stringify(kinds)}, not ${JSON.stringify(sections)}`);
  const treats = page.locator('#bag .bag-section[data-kind="treat"]');
  const names = await treats.locator('.bag-name').allTextContents();
  const wanted = TREATS.map((item) => item.name[language]);
  expect(JSON.stringify(names) === JSON.stringify(wanted), `the bag lists ${JSON.stringify(names)}, not ${JSON.stringify(wanted)}`);
  const counts = await treats.locator('.bag-count').allTextContents();
  expect(counts.every((count) => count === fill(say('bag.count'), { count: TREATS_EACH })), `the bag counts ${JSON.stringify(counts)}`);
  await treats.locator('.bag-item').first().tap();
  await until(page, (s) => s.bag?.selected === TREATS[0].id, 'the bag to say what the first treat is');
  await nextFrames(page);
  const about = TREATS[0].description?.[language] ?? say('bag.treatAbout');
  expect((await textOf(page, '#bag .bag-about p')) === about, `the bag says "${await textOf(page, '#bag .bag-about p')}" about ${TREATS[0].id}`);
  await check('the bag', 's1-bag');
  await page.locator('#bag .bag-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the bag');
}

/** The journal: the quest's chapter, the quest with its step's hint, and the quests done before it folded away. */
async function readJournal(page, plan, { language, say, expect, check }) {
  await page.locator('.journal-button').tap();
  const state = await until(page, (s) => s.screen === 'journal' && s.journal !== null, 'the journal');
  await nextFrames(page);
  const chapter = page.locator(`#journal .journal-chapter[data-chapter="${plan.chapter}"]`);
  const chapterName = STORY.chapters.find((each) => each.id === plan.chapter).name[language];
  expect((await chapter.locator('.journal-chapter-title').textContent()) === chapterName, `the journal's chapter is "${await chapter.locator('.journal-chapter-title').textContent()}", not "${chapterName}"`);
  const quest = chapter.locator(`.journal-quest[data-quest="${plan.quest.id}"]`);
  expect((await quest.locator('.journal-name').textContent()) === plan.quest.name[language], `the journal does not show the quest ${plan.quest.id}`);
  expect((await quest.locator('.journal-hint').textContent()) === plan.quest.steps[plan.at].hint[language], 'the journal does not show the step’s hint');
  const doneHere = plan.done.filter((id) => STORY.quests.get(id).chapter === plan.chapter).length;
  if (doneHere > 0) expect((await chapter.locator('.journal-fold').textContent()) === fill(say('journal.done'), { count: doneHere }), 'the journal’s done quests are not folded under their count');
  expect((await chapter.locator('.journal-done-list').isVisible()) === false, 'the journal’s done quests are not folded');
  if (plan.tile) expect(state.journal.goal?.x === plan.tile.x && state.journal.goal?.y === plan.tile.y, `"Where next?" goes to ${JSON.stringify(state.journal.goal)}, not the shrine at ${plan.tile.x},${plan.tile.y}`);
  else expect(state.journal.goal !== null, '"Where next?" has nowhere to go');
  await check('the journal', 's2-journal');
}

/** "Where next?": the journal closes and the camera goes to the goal and rings it, then comes back. */
async function whereNext(page, { expect, check }) {
  const { journal } = await readState(page);
  const goal = journal.goal;
  await page.locator('#journal .journal-where').tap();
  await until(page, (s) => s.screen === 'world' && s.looking?.x === goal.x && s.looking.y === goal.y, 'the camera to look at the goal', 5_000);
  await page.waitForTimeout(PAN_MS);
  const [spot] = await tilesToScreen(page, [goal]);
  const { width, height } = page.viewportSize();
  expect(spot && Math.abs(spot.x - width / 2) < width / 4 && Math.abs(spot.y - height / 2) < height / 4, `after "Where next?" the goal is at ${JSON.stringify(spot)}, not near the middle of the screen`);
  await check('where next', 's3-where-next');
  await until(page, (s) => s.looking === null, 'the camera to come back from the goal', 5_000);
}

/**
 * Plays the story part from the world, signed in as the prepared player: the bag, the journal,
 * "Where next?", the quest toast on resting at the shrine, and the journal after it.
 */
export async function playStory(page, world, plan, { language, strings, expect, check, notes }) {
  const say = (id) => strings[id][language];
  await until(page, (s) => s.screen === 'world' && s.progress !== null && s.story?.active.some((entry) => entry.quest === plan.quest.id), 'the world with the prepared quest');
  await lookInBag(page, plan, { language, say, expect, check });
  await readJournal(page, plan, { language, say, expect, check });
  await whereNext(page, { expect, check });
  if (!plan.toast) {
    notes.push('no quest has a step done by resting at a shrine on this map, so the quest toast was not played');
    return;
  }

  const last = plan.at === plan.quest.steps.length - 1;
  await walkByTaps(page, world, plan.tile, { notes });
  const toasted = await until(page, (s) => s.questToast?.quest === plan.quest.id, 'the quest toast after resting at the shrine', 10_000);
  expect(toasted.questToast.change === (last ? 'done' : 'step'), `the quest toast is about a ${toasted.questToast.change}, not the quest ${last ? 'done' : 'moving on'}`);
  const head = fill(say(last ? 'quest.done' : 'quest.stepDone'), { quest: plan.quest.name[language] });
  expect((await textOf(page, '.quest-toast .quest-toast-head')) === head, `the quest toast says "${await textOf(page, '.quest-toast .quest-toast-head')}", not "${head}"`);
  expect(toasted.journalNews && (await page.locator('.journal-dot').isVisible()), 'the journal button shows no news after the quest changed');
  await nextFrames(page);
  await check('a quest toast', 's4-toast');

  await page.locator('.journal-button').tap();
  await until(page, (s) => s.screen === 'journal' && !s.journalNews, 'the journal with the news read');
  if (last) {
    await page.locator(`#journal .journal-chapter[data-chapter="${plan.chapter}"] .journal-fold`).tap();
    await until(page, (s) => s.journal?.unfolded.includes(plan.chapter), 'the done quests unfolded');
    await nextFrames(page);
    expect(await page.locator(`#journal .journal-done[data-quest="${plan.quest.id}"]`).isVisible(), 'the journal does not list the quest as done');
  } else {
    const { story } = await readState(page);
    expect(story.active.some((entry) => entry.quest === plan.quest.id && entry.step === plan.at + 1), 'the quest did not move on to its next step');
  }
  await check('the journal after the quest', 's5-journal-after');
  await page.locator('#journal .journal-close').tap();
  await until(page, (s) => s.screen === 'world', 'the world after the journal');
}

/** At 360px wide, both screens open from the world and fit without scrolling sideways. */
export async function storyScreensFit(page, { noSideways, check }) {
  await inTurn(['bag', 'journal'], async (screen) => {
    await page.locator(`.${screen}-button`).tap();
    await until(page, (s) => s.screen === screen, `the ${screen} at 360px`);
    await nextFrames(page);
    await noSideways(`the ${screen}`);
    await check(`the ${screen} at 360px`, screen);
    await page.locator(`#${screen} .team-foot .primary`).tap();
    await until(page, (s) => s.screen === 'world', `the world after the ${screen}`);
  });
}
