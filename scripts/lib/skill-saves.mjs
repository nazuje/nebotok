// A save beside the gathering spots, for the browser check's skill part, its 360px runs and the
// scenes (scripts/lib/prepared-saves.mjs writes it). The player has the first starter, every skill
// at level 1, and one stack nearly full: the fish a level 1 fishing spot gives, one short of a
// stack, so a perfect catch (two fish) fits one and toasts that the other had no room. A board save
// (boardSave) stands beside the job board instead, with a delivery ready to hand over.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { encounterZoneAt, isWalkable, loadBattleContent, loadStoryContent, newCreature, openConversation } from '../../packages/core/src/index.ts';
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
const SKILLS = readContent('skills.json').skills;
const SPOTS = readContent('spots.json').spots;
const RECIPES = readContent('recipes.json').recipes;
const STATIONS = readContent('stations.json').stations;
const STACK = readContent('inventory.json').kinds.ingredient.stack;
const STARTERS = readContent('starters.json');

const AROUND = [
  ['up', 0, -1],
  ['down', 0, 1],
  ['left', -1, 0],
  ['right', 1, 0],
];
/** The way a courier on `from` faces to look at the next tile `to`. */
const facingTo = (from, to) => AROUND.find(([, dx, dy]) => from.x + dx === to.x && from.y + dy === to.y)?.[0] ?? 'down';
/** The walkable tiles next to `at`, out of the tall grass. */
const besideOf = (map, at) => AROUND.map(([, dx, dy]) => ({ x: at.x + dx, y: at.y + dy })).filter((tile) => isWalkable(map, tile) && encounterZoneAt(map, tile) === null);
const skillUses = (game) => SKILLS.find((skill) => skill.game === game);
const level1Spots = (map, skill) => SPOTS.filter((spot) => spot.skill === skill.id && spot.level === 1 && map.spots[spot.id]);

/**
 * What the skill part plays on `map`: a level 1 fishing spot and where to stand beside it; a level
 * 1 foraging spot and a cooking pot with one tile beside both; and a level 1 recipe made from what
 * that spot gives. Throws when the map has no such place, since the part cannot be played there.
 */
export function skillPlan(map) {
  const fishing = skillUses('dip');
  const foraging = skillUses('sparkle');
  const fish = level1Spots(map, fishing)[0];
  const fishAt = fish && besideOf(map, map.spots[fish.id])[0];
  if (!fishAt) throw new Error(`${map.id} has no level 1 fishing spot with open ground beside it`);
  const pots = STATIONS.filter((station) => station.kind === 'cookingPot' && map.stations[station.id]);
  for (const bush of level1Spots(map, foraging)) {
    const recipe = RECIPES.find((each) => each.level === 1 && each.ingredients.every((ingredient) => ingredient.item === bush.item));
    for (const pot of recipe ? pots : []) {
      const shared = besideOf(map, map.spots[bush.id]).find((tile) => besideOf(map, map.stations[pot.id]).some((other) => other.x === tile.x && other.y === tile.y));
      if (shared) {
        return {
          fish: { spot: fish.id, item: fish.item, tile: map.spots[fish.id], stand: fishAt, facing: facingTo(fishAt, map.spots[fish.id]) },
          bush: { spot: bush.id, item: bush.item, tile: map.spots[bush.id] },
          pot: { station: pot.id, tile: map.stations[pot.id] },
          stand: shared,
          facing: facingTo(shared, map.spots[bush.id]),
          recipe: { id: recipe.id, makes: recipe.makes, ingredients: recipe.ingredients },
        };
      }
    }
  }
  throw new Error(`${map.id} has no tile beside both a level 1 foraging spot and a cooking pot, with a level 1 recipe from that spot`);
}

/** The bag the skill part starts with: the fish one short of a stack, and enough of the bush's item to cook twice. */
export const skillInventory = (plan) => [
  { item: plan.fish.item, count: STACK - 1 },
  { item: plan.bush.item, count: plan.recipe.ingredients.reduce((sum, ingredient) => sum + ingredient.count, 0) * 2 },
];

/**
 * The whole save data of a player named `name` for the skill part, standing at `where`: `fish`
 * beside the fishing spot facing it, or `bush` beside the foraging spot and the pot, facing the spot.
 */
export function skillSave(world, { name, language, where = 'fish' }) {
  const plan = skillPlan(world.map);
  const stand = where === 'fish' ? plan.fish.stand : plan.stand;
  const facing = where === 'fish' ? plan.fish.facing : plan.facing;
  const starter = STARTERS.species[0];
  return {
    plan,
    data: {
      name,
      language,
      createdAt: new Date().toISOString(),
      position: { map: world.map.id, x: stand.x, y: stand.y, facing },
      team: [newCreature(starter, STARTERS.level, CONTENT)],
      storage: [],
      inventory: skillInventory(plan),
      lastShrine: null,
      seen: [starter],
      befriended: [starter],
      story: { active: [], done: [], flags: [] },
      skills: [],
      jobs: null,
    },
  };
}

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
const TEMPLATES = readContent('jobs.json').templates.filter((template) => template.needs.level === 1);
const SLOTS = readContent('jobs.json').slots;
/** Any fixed seed: the board part only needs the job drawn after a delivery to be new. */
const BOARD_SEED = 86;

/** A board job straight from a template, at its smallest count. */
const boardJob = (template, job, to = null) => ({ job, template: template.id, item: template.item, count: template.count[0], to, progress: 0 });

/** The Progress of a board player: the first starter, `inventory`, no quests or skills, and `jobs`. */
function boardProgress(inventory, jobs) {
  const starter = STARTERS.species[0];
  return {
    team: [newCreature(starter, STARTERS.level, CONTENT)],
    storage: [],
    inventory,
    lastShrine: null,
    seen: [starter],
    befriended: [starter],
    story: { active: [], done: [], flags: [] },
    skills: [],
    jobs,
  };
}

/**
 * What the board part plays on `map`: the job board and a tile beside it, and a board of `slots`
 * level 1 jobs whose first is a delivery to a character on the map who, with no quest under way,
 * takes it the moment the talk opens (core openConversation), its items in the bag. Throws when
 * the map has no such board, since the part cannot be played there.
 */
export function boardPlan(map) {
  const station = STATIONS.find((each) => each.kind === 'jobBoard' && map.stations[each.id]);
  const tile = station && map.stations[station.id];
  const stand = tile && besideOf(map, tile)[0];
  if (!stand) throw new Error(`${map.id} has no job board with open ground beside it`);
  const others = ['gather', 'cook'].map((kind) => TEMPLATES.find((template) => template.kind === kind)).filter(Boolean);
  for (const template of TEMPLATES.filter((each) => each.kind === 'deliver')) {
    for (const to of template.to.filter((npc) => map.npcs[npc])) {
      const jobs = [boardJob(template, 1, to), ...others.map((other, at) => boardJob(other, at + 2))].slice(0, SLOTS);
      const inventory = [{ item: template.item, count: template.count[0] }];
      const opened = openConversation(to, boardProgress(inventory, { seed: BOARD_SEED, drawn: jobs.length, done: 0, board: jobs }), STORY);
      if (jobs.length === SLOTS && opened?.jobs.some((change) => change.job === 1 && change.change === 'done')) {
        return {
          board: { station: station.id, tile },
          stand,
          facing: facingTo(stand, tile),
          jobs,
          drawn: jobs.length,
          slots: SLOTS,
          inventory,
          deliver: { job: 1, to, item: template.item, count: template.count[0] },
        };
      }
    }
  }
  throw new Error(`${map.id} has no character a level 1 delivery job goes to who takes it as a talk opens`);
}

/**
 * The whole save data of a player named `name` for the board part, standing beside the board and
 * facing it: with the planned board and the delivery's items when `opened`, or never having opened
 * the board, for the first visit at 360px.
 */
export function boardSave(world, { name, language, opened = true }) {
  const plan = boardPlan(world.map);
  const jobs = opened ? { seed: BOARD_SEED, drawn: plan.drawn, done: 0, board: plan.jobs } : null;
  return {
    plan,
    data: {
      name,
      language,
      createdAt: new Date().toISOString(),
      position: { map: world.map.id, x: plan.stand.x, y: plan.stand.y, facing: plan.facing },
      ...boardProgress(opened ? plan.inventory : [], jobs),
    },
  };
}
