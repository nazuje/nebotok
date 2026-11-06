// Reads content/art/ for the art scripts: the sprites and tilesets, and every frame's pixels, whether
// drawn in its file or read from a PNG in content/art/png/.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { frameNames, isPngSprite, loadArt, pixelColour } from '../../packages/core/src/index.ts';
import { decodePng, encodePng } from './png.mjs';

export const CONTENT_DIR = fileURLToPath(new URL('../../content/', import.meta.url));
const TILE = 16;

/** Every art JSON file, keyed by its name under content/, such as art/tiles/grass.json. */
export function readArtFiles(contentDir = CONTENT_DIR) {
  const dir = join(contentDir, 'art');
  if (!existsSync(dir)) return {};
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => join(entry.parentPath, entry.name).slice(contentDir.length))
    .toSorted();
  return Object.fromEntries(files.map((file) => [file, JSON.parse(readFileSync(join(contentDir, file), 'utf8'))]));
}

/** loadArt on the art in content/; throws when any file has a problem. */
export function readArt(contentDir = CONTENT_DIR) {
  const art = loadArt(readArtFiles(contentDir));
  if (art.problems.length) throw new Error(`content/art has problems; run npm run content:validate\n  ${art.problems.join('\n  ')}`);
  return art;
}

/** Every way a PNG-backed sprite's file is missing or the wrong size. */
export function pngProblems(art, contentDir = CONTENT_DIR) {
  return [...art.sprites].flatMap(([id, sprite]) => {
    if (!isPngSprite(sprite)) return [];
    const file = join(contentDir, 'art', 'png', sprite.png);
    if (!existsSync(file)) return [`${id} uses content/art/png/${sprite.png}, which does not exist`];
    let image;
    try {
      image = decodePng(readFileSync(file));
    } catch (error) {
      return [`content/art/png/${sprite.png}: ${error.message}`];
    }
    const width = sprite.width * sprite.frames.length;
    if (image.width === width && image.height === sprite.height) return [];
    return [`content/art/png/${sprite.png} is ${image.width}×${image.height}; ${id} has ${sprite.frames.length} frame(s) of ${sprite.width}×${sprite.height} side by side, so ${width}×${sprite.height}`];
  });
}

/** Reads any sprite frame's pixel as [r, g, b, a]. */
export function artPixels(art, contentDir = CONTENT_DIR) {
  const images = new Map();
  const image = (png) => {
    if (!images.has(png)) images.set(png, decodePng(readFileSync(join(contentDir, 'art', 'png', png))));
    return images.get(png);
  };
  return (id, frame, x, y) => {
    const sprite = art.sprites.get(id);
    if (!sprite) throw new Error(`no sprite ${id}`);
    if (isPngSprite(sprite)) {
      const { width, rgba } = image(sprite.png);
      const at = (y * width + frameNames(sprite).indexOf(frame) * sprite.width + x) * 4;
      return [...rgba.subarray(at, at + 4)];
    }
    const colour = pixelColour(sprite, frame, x, y);
    return colour === null ? [0, 0, 0, 0] : [(colour >> 16) & 0xff, (colour >> 8) & 0xff, colour & 0xff, 255];
  };
}

/**
 * The PNG Tiled shows for a tileset: each tile's first frame, `columns` to a row. It is RGB unless a
 * tile has see-through pixels, so an opaque tileset stays byte for byte what it was.
 */
export function renderTileset(art, pixel, name) {
  const tileset = art.tilesets.get(name);
  if (!tileset) throw new Error(`no tileset ${name}`);
  const width = tileset.columns * TILE;
  const height = Math.ceil(tileset.tiles.length / tileset.columns) * TILE;
  const at = (x, y) => {
    const id = tileset.tiles[Math.floor(y / TILE) * tileset.columns + Math.floor(x / TILE)];
    return id ? pixel(id, frameNames(art.sprites.get(id))[0], x % TILE, y % TILE) : [0, 0, 0, 0];
  };
  let alpha = false;
  for (let y = 0; y < height && !alpha; y += 1) for (let x = 0; x < width && !alpha; x += 1) alpha = at(x, y)[3] < 255;
  return { width, height, png: encodePng(width, height, at, { alpha }) };
}
