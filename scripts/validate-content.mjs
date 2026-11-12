// Checks every file in content/ against its schema in @nebotok/core. Fails on the first bad file
// with every problem in it, and on any file that has no schema. AGENTS.md files are agent notes,
// not content. Tileset images (maps/*.png) are not JSON: each must be a PNG that a map uses, and
// every image a map names must exist. world.json's start map must exist too. The battle files must
// all exist and name only types, weather, moves, species and treats that the others define; so must
// encounters.json, starters.json and creatures/renamed.json, and each map's tall grass and shrines must name a zone in
// encounters.json and a shrine in shrines.json. The story files (npcs.json, dialogue/, quests.json,
// story.json, inventory.json) and the skill files (skills.json, spots.json, recipes.json,
// stations.json, jobs.json) must link up (core storyProblems, skillProblems) and to the maps
// (storyMapProblems). Art (content/art/) must hold every sprite that avatars, creatures, weather,
// items, npcs, story cues, spots, stations, skills, their games and maps need; each tileset image must be what `npm run tiles`
// draws from its art, and each real-art PNG must be used and the right size.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ART_PNG,
  DIALOGUE_FILE,
  EncountersFile,
  STORY_CUES,
  MAP_FILE,
  RenamedFile,
  ShrinesFile,
  StartersFile,
  battleContentProblems,
  checkContentFile,
  encounterProblems,
  isPngSprite,
  loadArt,
  loadBattleContent,
  loadStoryContent,
  mapLinkProblems,
  missingArt,
  readTiledMap,
  renamedProblems,
  starterProblems,
  storyContentProblems,
  storyMapProblems,
} from '../packages/core/src/index.ts';
import { artPixels, pngProblems, renderTileset } from './lib/art.mjs';

const CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TILESET_IMAGE = /^maps\/[a-z0-9-]+\.png$/;

const all = readdirSync(CONTENT_DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'AGENTS.md')
  .map((entry) => join(entry.parentPath, entry.name).slice(CONTENT_DIR.length))
  .toSorted();
const images = all.filter((file) => TILESET_IMAGE.test(file));
const artImages = all.filter((file) => ART_PNG.test(file));
const files = all.filter((file) => !TILESET_IMAGE.test(file) && !ART_PNG.test(file));

let failures = 0;
const fail = (file, problems) => {
  failures += 1;
  console.error(`FAIL content/${file}`);
  for (const problem of problems) console.error(`     - ${problem}`);
};

const parsed = new Map();
for (const file of files) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));
  } catch (error) {
    console.error(`FAIL content/${file}: not valid JSON (${error.message})`);
    failures += 1;
    continue;
  }
  const result = checkContentFile(file, raw);
  if (result.ok) {
    parsed.set(file, raw);
    console.log(`ok   content/${file}`);
  } else {
    fail(file, result.problems);
  }
}

const usedImages = new Set();
for (const [file, raw] of parsed) {
  if (!MAP_FILE.test(file)) continue;
  for (const tileset of raw.tilesets) {
    const image = `maps/${tileset.image}`;
    usedImages.add(image);
    if (!images.includes(image)) fail(file, [`tileset "${tileset.name}" uses ${image}, which does not exist`]);
  }
}
for (const image of images) {
  const head = readFileSync(join(CONTENT_DIR, image)).subarray(0, PNG_SIGNATURE.length);
  if (!head.equals(PNG_SIGNATURE)) fail(image, ['not a PNG file']);
  else if (!usedImages.has(image)) fail(image, ['no map uses this tileset image']);
  else console.log(`ok   content/${image}`);
}

const world = parsed.get('world.json');
if (world && !parsed.has(`maps/${world.startMap}.tmj`)) fail('world.json', [`startMap "${world.startMap}" has no valid maps/${world.startMap}.tmj`]);

const BATTLE_FILES = {
  weather: 'creatures/weather.json',
  moves: 'creatures/moves.json',
  species: 'creatures/species.json',
  rules: 'creatures/battle-rules.json',
  befriending: 'creatures/befriending.json',
  items: 'items.json',
};
const WORLD_FILES = ['encounters.json', 'shrines.json', 'starters.json', 'creatures/renamed.json'];
const STORY_FILES = ['npcs.json', 'quests.json', 'story.json', 'inventory.json'];
const SKILL_FILES = { skills: 'skills.json', spots: 'spots.json', recipes: 'recipes.json', stations: 'stations.json', jobs: 'jobs.json' };
const missing = [...Object.values(BATTLE_FILES), ...WORLD_FILES].filter((file) => !all.includes(file));
if (missing.length) fail('creatures/', missing.map((file) => `content/${file} is missing; the game needs it`));
else if ([...Object.values(BATTLE_FILES), ...WORLD_FILES].every((file) => parsed.has(file))) {
  const battleFiles = Object.fromEntries(Object.entries(BATTLE_FILES).map(([key, file]) => [key, parsed.get(file)]));
  const problems = battleContentProblems(battleFiles);
  if (problems.length) fail('creatures/', problems);
  else {
    const content = loadBattleContent(battleFiles);
    const encounters = EncountersFile.parse(parsed.get('encounters.json'));
    const shrines = ShrinesFile.parse(parsed.get('shrines.json'));
    const encounterLinks = encounterProblems(encounters, content);
    if (encounterLinks.length) fail('encounters.json', encounterLinks);
    const starterLinks = starterProblems(StartersFile.parse(parsed.get('starters.json')), content);
    if (starterLinks.length) fail('starters.json', starterLinks);
    const renamedLinks = renamedProblems(RenamedFile.parse(parsed.get('creatures/renamed.json')), content);
    if (renamedLinks.length) fail('creatures/renamed.json', renamedLinks);
    const maps = [];
    for (const [file, raw] of parsed) {
      const name = MAP_FILE.exec(file)?.[1];
      const read = name ? readTiledMap(name, raw) : null;
      if (read?.ok) maps.push(read.map);
      const links = read?.ok ? mapLinkProblems(read.map, encounters, shrines) : [];
      if (links.length) fail(file, links);
    }
    checkStory(content, maps, encounters, shrines);
  }
}

// The story: npcs.json, dialogue/, quests.json, story.json, inventory.json and the skill files,
// linked to each other, to the battle content and to the maps.
function checkStory(battle, maps, encounters, shrines) {
  const needed = [...STORY_FILES, ...Object.values(SKILL_FILES)];
  const missingStory = needed.filter((file) => !all.includes(file));
  if (missingStory.length) return fail('story', missingStory.map((file) => `content/${file} is missing; the game needs it`));
  const dialogueFiles = [...parsed.keys()].filter((file) => DIALOGUE_FILE.test(file));
  if (!needed.every((file) => parsed.has(file)) || dialogueFiles.length !== all.filter((file) => DIALOGUE_FILE.test(file)).length) return;
  const storyFiles = {
    npcs: parsed.get('npcs.json'),
    quests: parsed.get('quests.json'),
    story: parsed.get('story.json'),
    inventory: parsed.get('inventory.json'),
    dialogue: Object.fromEntries(dialogueFiles.map((file) => [DIALOGUE_FILE.exec(file)[1], parsed.get(file)])),
    skills: Object.fromEntries(Object.entries(SKILL_FILES).map(([key, file]) => [key, parsed.get(file)])),
  };
  const problems = storyContentProblems(storyFiles, battle);
  if (problems.length) return fail('story', problems);
  const storyWorld = { maps, zones: encounters.zones.map((zone) => zone.id), shrines: shrines.shrines.map((shrine) => shrine.id) };
  const mapProblems = storyMapProblems(loadStoryContent(storyFiles, battle), storyWorld);
  if (mapProblems.length) fail('story', mapProblems);
}

// Art: only once every file reads on its own, so each problem below is about how the files fit.
const artFiles = files.filter((file) => file.startsWith('art/'));
if (artFiles.every((file) => parsed.has(file))) {
  const art = loadArt(Object.fromEntries(artFiles.map((file) => [file, parsed.get(file)])));
  const ids = (file, key) => parsed.get(file)?.[key]?.map((entry) => entry.id) ?? [];
  const maps = [...parsed].filter(([file]) => MAP_FILE.test(file));
  const mapTilesets = maps.flatMap(([file, raw]) => raw.tilesets.map((tileset) => ({ file, tileset, name: tileset.image.replace(/\.png$/, '') })));
  const users = {
    avatars: ids('avatars.json', 'avatars'),
    species: ids('creatures/species.json', 'species'),
    weather: ids('creatures/weather.json', 'types'),
    items: ids('items.json', 'items'),
    npcs: ids('npcs.json', 'npcs'),
    cues: [...STORY_CUES],
    tilesets: [...new Set(mapTilesets.map(({ name }) => name))],
    spots: [...new Set((parsed.get('spots.json')?.spots ?? []).map((spot) => spot.look))],
    stations: [...new Set((parsed.get('stations.json')?.stations ?? []).map((station) => station.look))],
    skills: (parsed.get('skills.json')?.skills ?? []).map((skill) => ({ id: skill.id, game: skill.game })),
  };
  const problems = [...art.problems, ...missingArt(art, users), ...(art.problems.length ? [] : pngProblems(art, CONTENT_DIR))];
  if (problems.length) fail('art/', problems);
  const usedPngs = new Set([...art.sprites.values()].flatMap((sprite) => (isPngSprite(sprite) ? [`art/png/${sprite.png}`] : [])));
  for (const image of artImages) {
    if (!usedPngs.has(image)) fail(image, ['no sprite uses this PNG']);
    else console.log(`ok   content/${image}`);
  }
  if (!problems.length) {
    const pixel = artPixels(art, CONTENT_DIR);
    for (const { file, tileset, name } of mapTilesets) {
      const tiles = art.tilesets.get(name);
      const drawn = renderTileset(art, pixel, name);
      const mismatched = [
        ['tilecount', tileset.tilecount, tiles.tiles.length],
        ['columns', tileset.columns, tiles.columns],
        ['imagewidth', tileset.imagewidth, drawn.width],
        ['imageheight', tileset.imageheight, drawn.height],
      ].filter(([, inMap, inArt]) => inMap !== inArt);
      if (mismatched.length) fail(file, mismatched.map(([key, inMap, inArt]) => `tileset "${tileset.name}" has ${key} ${inMap}, but content/art/tilesets/${name}.json makes it ${inArt}; open the map in Tiled and refresh the tileset`));
      if (images.includes(`maps/${tileset.image}`) && !readFileSync(join(CONTENT_DIR, 'maps', tileset.image)).equals(drawn.png)) {
        fail(`maps/${tileset.image}`, [`out of date with content/art/tilesets/${name}.json; run npm run tiles`]);
      }
    }
  }
}

if (all.length === 0) {
  console.error('FAIL content/ is empty');
  process.exit(1);
}
if (failures) {
  console.error(`\ncontent:validate: ${failures} problem file(s) in ${all.length}`);
  process.exit(1);
}
console.log(`\ncontent:validate: all ${all.length} file(s) valid`);
