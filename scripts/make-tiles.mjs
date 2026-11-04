// Draws the placeholder tileset for the island maps into content/maps/sky-tiles.png: 16 by 16 pixel
// tiles, four to a row. The PNG is committed; run `npm run tiles` again only after changing the art
// here. A tile's id is its position in TILES, and the maps' embedded tilesets refer to those ids, so
// add new tiles at the end and never reorder them. Real art replaces this in Phase 4.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const OUT = fileURLToPath(new URL('../content/maps/', import.meta.url));
export const TILESET_FILE = 'sky-tiles.png';
export const TILE_PIXELS = 16;
export const COLUMNS = 4;

const rgb = (hex) => [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff];
const SKY = rgb(0x8fd3ff);
const CLOUD = rgb(0xe9f6ff);
const GRASS = rgb(0x5bbf5b);
const GRASS_DARK = rgb(0x47a44c);
const GRASS_LIGHT = rgb(0x7ad66f);
const PETAL = rgb(0xff7eb6);
const PETAL_YELLOW = rgb(0xffd94a);
const PATH = rgb(0xd9b77e);
const PEBBLE = rgb(0xb8945c);
const WATER = rgb(0x3a8fd8);
const WAVE = rgb(0x9fd4ff);
const ROCK = rgb(0x8a5a3b);
const ROCK_DARK = rgb(0x6b4329);
const LEAF = rgb(0x2f7d3a);
const LEAF_LIGHT = rgb(0x3e9a4a);
const BUSH = rgb(0x358a42);
const WOOD = rgb(0x9a6a3f);
const WOOD_DARK = rgb(0x6b4329);
const WALL = rgb(0xf3e6c8);
const ROOF = rgb(0xd0574a);
const ROOF_DARK = rgb(0xa8443a);
const DOOR = rgb(0x7a4a2a);
const KNOB = rgb(0xffd94a);

/** A fixed per-pixel noise in [0, 1): the same picture on every run. */
function noise(x, y, salt) {
  let h = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263) ^ Math.imul(salt + 1, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;

function grass(x, y) {
  const n = noise(x, y, 1);
  if (n < 0.12) return GRASS_DARK;
  return n > 0.92 ? GRASS_LIGHT : GRASS;
}

function sky(x, y) {
  const cloud = inCircle(x, y, 5, 6, 3) || inCircle(x, y, 9, 6, 3.5) || inCircle(x, y, 12, 8, 2);
  return cloud && noise(x, y, 2) < 0.3 ? CLOUD : SKY;
}

function flowers(x, y) {
  const petal = [[3, 4], [11, 3], [7, 10], [13, 12]].some(([cx, cy]) => Math.abs(x - cx) + Math.abs(y - cy) === 1);
  if (!petal) return grass(x, y);
  return (x + y) % 2 ? PETAL : PETAL_YELLOW;
}

function tree(x, y) {
  if (inCircle(x, y, 7.5, 6, 6)) return noise(x, y, 5) < 0.3 ? LEAF_LIGHT : LEAF;
  return x >= 6 && x <= 9 && y > 10 ? WOOD_DARK : grass(x, y);
}

function fence(x, y) {
  if ((x === 2 || x === 13) && y > 3 && y < 15) return WOOD_DARK;
  return [6, 7, 11, 12].includes(y) ? WOOD : grass(x, y);
}

function door(x, y) {
  if (x < 3 || x > 12) return WALL;
  if (y < 2 || x === 3 || x === 12) return WOOD_DARK;
  return x === 10 && y === 9 ? KNOB : DOOR;
}

/** Each tile draws pixel (x, y) of itself. `collides` marks the tiles nobody can walk onto. */
export const TILES = [
  { name: 'sky', collides: true, draw: sky },
  { name: 'grass', collides: false, draw: grass },
  { name: 'flowers', collides: false, draw: flowers },
  { name: 'path', collides: false, draw: (x, y) => (noise(x, y, 3) < 0.1 ? PEBBLE : PATH) },
  { name: 'water', collides: true, draw: (x, y) => ((y === 4 && x > 2 && x < 8) || (y === 11 && x > 8 && x < 14) ? WAVE : WATER) },
  { name: 'cliff', collides: true, draw: (x, y) => (y < 2 ? GRASS_DARK : noise(x, y, 4) < 0.25 || x % 5 === 0 ? ROCK_DARK : ROCK) },
  { name: 'tree', collides: true, draw: tree },
  { name: 'fence', collides: true, draw: fence },
  { name: 'wall', collides: true, draw: (x, y) => (x === 0 || x === 15 || y === 15 ? WOOD_DARK : y === 7 ? WOOD : WALL) },
  { name: 'roof', collides: true, draw: (x, y) => (y % 4 === 3 || (x + (y >> 2) * 4) % 8 === 0 ? ROOF_DARK : ROOF) },
  { name: 'door', collides: false, draw: door },
  { name: 'bush', collides: true, draw: (x, y) => (inCircle(x, y, 7.5, 9, 6) ? (noise(x, y, 6) < 0.25 ? LEAF_LIGHT : BUSH) : grass(x, y)) },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rows = Math.ceil(TILES.length / COLUMNS);
  const png = encodePng(COLUMNS * TILE_PIXELS, rows * TILE_PIXELS, (x, y) => {
    const tile = TILES[Math.floor(y / TILE_PIXELS) * COLUMNS + Math.floor(x / TILE_PIXELS)];
    return tile ? tile.draw(x % TILE_PIXELS, y % TILE_PIXELS) : SKY;
  });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(`${OUT}${TILESET_FILE}`, png);
  console.log(`wrote content/maps/${TILESET_FILE} (${TILES.length} tiles, ${COLUMNS * TILE_PIXELS}x${rows * TILE_PIXELS})`);
}
