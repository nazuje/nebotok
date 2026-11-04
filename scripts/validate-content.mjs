// Checks every file in content/ against its schema in @nebotok/core. Fails on the first bad file
// with every problem in it, and on any file that has no schema. AGENTS.md files are agent notes,
// not content. Tileset images (maps/*.png) are not JSON: each must be a PNG that a map uses, and
// every image a map names must exist. world.json's start map must exist too. The creature files must
// all exist and name only types, weather and moves that the others define.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_FILE, battleContentProblems, checkContentFile } from '../packages/core/src/index.ts';

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

const CREATURE_FILES = { weather: 'creatures/weather.json', moves: 'creatures/moves.json', species: 'creatures/species.json', rules: 'creatures/battle-rules.json' };
const missingCreatureFiles = Object.values(CREATURE_FILES).filter((file) => !all.includes(file));
if (missingCreatureFiles.length) fail('creatures/', missingCreatureFiles.map((file) => `content/${file} is missing; battles need it`));
else if (Object.values(CREATURE_FILES).every((file) => parsed.has(file))) {
  const problems = battleContentProblems(Object.fromEntries(Object.entries(CREATURE_FILES).map(([key, file]) => [key, parsed.get(file)])));
  if (problems.length) fail('creatures/', problems);
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
