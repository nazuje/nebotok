// Draws the app icons from a 16 by 16 pixel map and writes them as PNGs into apps/game/public/icons/.
// The PNGs are committed; run `npm run icons` again only after changing the art here.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './lib/png.mjs';

const OUT = fileURLToPath(new URL('../apps/game/public/icons/', import.meta.url));

const PALETTE = {
  S: [0x8f, 0xd3, 0xff],
  W: [0xff, 0xff, 0xff],
  G: [0x5b, 0xbf, 0x5b],
  L: [0x7a, 0xd6, 0x6f],
  F: [0xff, 0x7e, 0xb6],
  D: [0x3e, 0x9a, 0x4a],
  R: [0x8a, 0x5a, 0x3b],
  B: [0x6b, 0x43, 0x29],
};

const ART = [
  'SSSSSSSSSSSSSSSS',
  'SSSSSSSSSSWWSSSS',
  'SSSSSSSSSWWWWSSS',
  'SSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSS',
  'SSSSSGGGGGGSSSSS',
  'SSSGGGLGGGGGGSSS',
  'SSGGGFGGGGGLGGSS',
  'SSGGGGGGGGFGGGSS',
  'SSDDDDDDDDDDDDSS',
  'SSSRRRBRRRRRRSSS',
  'SSSSRRRRRBRRSSSS',
  'SSSSSRRRRRRSSSSS',
  'SSSSSSRBRRSSSSSS',
  'SSSSSSSRRSSSSSSS',
  'SSSSSSSSSSSSSSSS',
];

/** The art scaled by a whole number, centred on a sky-coloured square of `size` pixels. */
function icon(size, artPixels) {
  const scale = Math.floor(artPixels / 16);
  const offset = Math.floor((size - scale * 16) / 2);
  return encodePng(size, size, (x, y) => {
    const ax = Math.floor((x - offset) / scale);
    const ay = Math.floor((y - offset) / scale);
    const letter = ART[ay]?.[ax] ?? 'S';
    return PALETTE[letter];
  });
}

const ICONS = [
  { file: 'favicon-32.png', size: 32, art: 32 },
  { file: 'apple-touch-icon-180.png', size: 180, art: 176 },
  { file: 'icon-192.png', size: 192, art: 192 },
  { file: 'icon-512.png', size: 512, art: 512 },
  // Maskable icons are cropped to a circle or squircle by the device; keep the art inside the middle 80%.
  { file: 'icon-maskable-512.png', size: 512, art: 384 },
];

for (const row of ART) if (row.length !== 16 || [...row].some((letter) => !PALETTE[letter])) throw new Error(`bad icon row ${row}`);
mkdirSync(OUT, { recursive: true });
for (const { file, size, art } of ICONS) {
  writeFileSync(join(OUT, file), icon(size, art));
  console.log(`wrote apps/game/public/icons/${file} (${size}x${size})`);
}
