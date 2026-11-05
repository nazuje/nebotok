// Checks every file in content/ against its schema in @nebotok/core. Fails on the first bad file
// with every problem in it, and on any file that has no schema. AGENTS.md files are agent notes,
// not content. Tileset images (maps/*.png) are not JSON: each must be a PNG that a map uses, and
// every image a map names must exist. world.json's start map must exist too. The battle files must
// all exist and name only types, weather, moves, species and treats that the others define; so must
// encounters.json and starters.json, and each map's tall grass and shrines must name a zone in
// encounters.json and a shrine in shrines.json.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EncountersFile,
  MAP_FILE,
  ShrinesFile,
  StartersFile,
  battleContentProblems,
  checkContentFile,
  encounterProblems,
  loadBattleContent,
  mapLinkProblems,
  readTiledMap,
  starterProblems,
} from '../packages/core/src/index.ts';

const CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TILESET_IMAGE = /^maps\/[a-z0-9-]+\.png$/;

const all = readdirSync(CONTENT_DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && entry.name !== 'AGENTS.md')
  .map((entry) => join(entry.parentPath, entry.name).slice(CONTENT_DIR.length))
  .toSorted();
const images = all.filter((file) => TILESET_IMAGE.test(file));
const files = all.filter((file) => !TILESET_IMAGE.test(file));

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
const WORLD_FILES = ['encounters.json', 'shrines.json', 'starters.json'];
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
    for (const [file, raw] of parsed) {
      const name = MAP_FILE.exec(file)?.[1];
      const read = name ? readTiledMap(name, raw) : null;
      const links = read?.ok ? mapLinkProblems(read.map, encounters, shrines) : [];
      if (links.length) fail(file, links);
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
