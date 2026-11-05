// Draws each tileset in content/art/tilesets/ into content/maps/<name>.png, the image Tiled shows
// for it. The game draws its tiles from content/art/ itself; this PNG is for Tiled, and
// content:validate fails when it is out of date. Run `npm run tiles` after changing any tile.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_DIR, artPixels, readArt, renderTileset } from './lib/art.mjs';

const art = readArt();
const pixel = artPixels(art);
for (const [name, tileset] of art.tilesets) {
  const { width, height, png } = renderTileset(art, pixel, name);
  writeFileSync(join(CONTENT_DIR, 'maps', `${name}.png`), png);
  console.log(`wrote content/maps/${name}.png (${tileset.tiles.length} tiles, ${width}x${height})`);
}
