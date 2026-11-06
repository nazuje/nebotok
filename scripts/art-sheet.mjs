// Draws every sprite in content/art/ onto one contact sheet, .proof/art/sheet.png, for review: each
// frame scaled up with its pixels kept sharp, labelled with the sprite id and frame names, and each
// tileset as Tiled shows it. See-through pixels show a checkerboard.
//   npm run art:sheet [-- --out <file>]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { frameNames } from '../packages/core/src/index.ts';
import { artPixels, readArt } from './lib/art.mjs';
import { encodePng } from './lib/png.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const { values } = parseArgs({ options: { out: { type: 'string', default: join(ROOT, '.proof', 'art', 'sheet.png') } } });

const SCALE = 4;
const TEXT = 2;
const GAP = 8;
const MARGIN = 16;
const MAX_WIDTH = 1400;
const PAPER = [0xee, 0xee, 0xf2];
const CHECK = [0xd4, 0xd4, 0xdc];
const INK = [0x1b, 0x1b, 0x2f];
const FAINT = [0x6e, 0x6e, 0x80];

// A 3×5 pixel font for labels: one string of five rows per character.
const GLYPHS = Object.fromEntries(
  Object.entries({
    a: '.#. #.# ### #.# #.#', b: '##. #.# ##. #.# ##.', c: '.## #.. #.. #.. .##', d: '##. #.# #.# #.# ##.', e: '### #.. ##. #.. ###',
    f: '### #.. ##. #.. #..', g: '.## #.. #.# #.# .##', h: '#.# #.# ### #.# #.#', i: '### .#. .#. .#. ###', j: '..# ..# ..# #.# .#.',
    k: '#.# #.# ##. #.# #.#', l: '#.. #.. #.. #.. ###', m: '#.# ### ### #.# #.#', n: '##. #.# #.# #.# #.#', o: '.#. #.# #.# #.# .#.',
    p: '##. #.# ##. #.. #..', q: '.#. #.# #.# ##. .##', r: '##. #.# ##. #.# #.#', s: '.## #.. .#. ..# ##.', t: '### .#. .#. .#. .#.',
    u: '#.# #.# #.# #.# ###', v: '#.# #.# #.# #.# .#.', w: '#.# #.# ### ### #.#', x: '#.# #.# .#. #.# #.#', y: '#.# #.# .#. .#. .#.',
    z: '### ..# .#. #.. ###', 0: '### #.# #.# #.# ###', 1: '.#. ##. .#. .#. ###', 2: '##. ..# .#. #.. ###', 3: '##. ..# .#. ..# ##.',
    4: '#.# #.# ### ..# ..#', 5: '### #.. ##. ..# ##.', 6: '.## #.. ### #.# ###', 7: '### ..# .#. .#. .#.', 8: '### #.# ### #.# ###',
    9: '### #.# ### ..# ##.', '-': '... ... ### ... ...', '/': '..# ..# .#. #.. #..', ' ': '... ... ... ... ...', '?': '##. ..# .#. ... .#.',
  }).map(([char, rows]) => [char, rows.replaceAll(' ', '')]),
);
const GLYPH_WIDTH = (3 + 1) * TEXT;
const TEXT_HEIGHT = 5 * TEXT;
const textWidth = (label) => label.length * GLYPH_WIDTH;

const art = readArt();
const pixel = artPixels(art);
const blocks = [];
for (const [id, sprite] of [...art.sprites].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
  const frames = frameNames(sprite).map((frame) => ({ label: frame, width: sprite.width, height: sprite.height, at: (x, y) => pixel(id, frame, x, y) }));
  blocks.push({ kind: id.split('/')[0], label: id, frames });
}
for (const [name, tileset] of art.tilesets) {
  const rows = Math.ceil(tileset.tiles.length / tileset.columns);
  const at = (x, y) => {
    const id = tileset.tiles[Math.floor(y / 16) * tileset.columns + Math.floor(x / 16)];
    return id ? pixel(id, frameNames(art.sprites.get(id))[0], x % 16, y % 16) : [0, 0, 0, 0];
  };
  blocks.push({ kind: 'tilesets', label: `tilesets/${name}`, frames: [{ label: `${tileset.tiles.length} tiles`, width: tileset.columns * 16, height: rows * 16, at }] });
}

// Lay the blocks out left to right, starting a new line when a row is full or the kind changes.
const placed = [];
let x = MARGIN;
let y = MARGIN;
let lineHeight = 0;
let lastKind = null;
let sheetWidth = 0;
for (const block of blocks) {
  const cells = block.frames.map((frame) => Math.max(frame.width * SCALE, textWidth(frame.label)));
  const width = Math.max(textWidth(block.label), cells.reduce((sum, cell) => sum + cell, 0) + GAP * (cells.length - 1));
  const height = TEXT_HEIGHT + 4 + Math.max(...block.frames.map((frame) => frame.height * SCALE)) + 4 + TEXT_HEIGHT;
  if (x > MARGIN && (x + width > MAX_WIDTH || block.kind !== lastKind)) {
    x = MARGIN;
    y += lineHeight + GAP * 3;
    lineHeight = 0;
  }
  placed.push({ block, cells, x, y });
  x += width + GAP * 4;
  sheetWidth = Math.max(sheetWidth, x);
  lineHeight = Math.max(lineHeight, height);
  lastKind = block.kind;
}
const width = Math.max(sheetWidth, MARGIN * 2);
const height = y + lineHeight + MARGIN;

const canvas = Array.from({ length: width * height }, () => PAPER);
const put = (px, py, colour) => {
  if (px >= 0 && py >= 0 && px < width && py < height) canvas[py * width + px] = colour;
};
const write = (label, left, top, colour) => {
  [...label].forEach((char, at) => {
    const glyph = GLYPHS[char] ?? GLYPHS['?'];
    for (let gy = 0; gy < 5; gy += 1) {
      for (let gx = 0; gx < 3; gx += 1) {
        if (glyph[gy * 3 + gx] !== '#') continue;
        for (let s = 0; s < TEXT * TEXT; s += 1) put(left + at * GLYPH_WIDTH + gx * TEXT + (s % TEXT), top + gy * TEXT + Math.floor(s / TEXT), colour);
      }
    }
  });
};
for (const { block, cells, x: left, y: top } of placed) {
  write(block.label, left, top, INK);
  let cellLeft = left;
  block.frames.forEach((frame, index) => {
    const frameTop = top + TEXT_HEIGHT + 4;
    for (let fy = 0; fy < frame.height * SCALE; fy += 1) {
      for (let fx = 0; fx < frame.width * SCALE; fx += 1) {
        const [r, g, b, a] = frame.at(Math.floor(fx / SCALE), Math.floor(fy / SCALE));
        const under = (Math.floor(fx / SCALE) + Math.floor(fy / SCALE)) % 2 ? CHECK : PAPER;
        const mix = (channel, back) => Math.round((channel * a + back * (255 - a)) / 255);
        put(cellLeft + fx, frameTop + fy, [mix(r, under[0]), mix(g, under[1]), mix(b, under[2])]);
      }
    }
    write(frame.label, cellLeft, frameTop + frame.height * SCALE + 4, FAINT);
    cellLeft += (cells[index] ?? 0) + GAP;
  });
}

mkdirSync(dirname(values.out), { recursive: true });
writeFileSync(values.out, encodePng(width, height, (px, py) => canvas[py * width + px]));
console.log(`wrote ${relative(process.cwd(), values.out)}: ${art.sprites.size} sprites and ${art.tilesets.size} tileset(s), ${width}x${height}`);
