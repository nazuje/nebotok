import type { Scene } from 'phaser';
import { speciesType } from './battle-content.ts';

/**
 * Stand-in creature art until the drawn sprites land: one simple shape per weather type, seen from
 * the front (with a face) or the back, on a 32 by 32 grid. `creatureArt` is the only place that
 * decides what a species looks like.
 */
export const CREATURE_SIZE = 32;
export type Facing = 'front' | 'back';

/** One letter per pixel, '.' transparent: `k` outline, `b` body, `s` shade, `l` light, `e` eyes. */
export type CreatureArt = { readonly rows: readonly string[]; readonly palette: Readonly<Record<string, number>> };

const OUTLINE = 0x1b1b2f;

const COLOURS: Readonly<Record<string, readonly [body: number, shade: number, light: number]>> = {
  sun: [0xf2c14e, 0xd9952b, 0xfff1b8],
  rain: [0x4a90d9, 0x2f6bb0, 0xa9d4ff],
  frost: [0x9fe3f0, 0x5fb3c9, 0xffffff],
  bloom: [0xe88ac0, 0xc2569a, 0xffd6ec],
  gale: [0xc8d6e5, 0x8fa3b8, 0xffffff],
  storm: [0x8a7fe0, 0x5649b0, 0xd2ccff],
};
const UNKNOWN: readonly [number, number, number] = [0xa0a0a0, 0x707070, 0xdddddd];

const within = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => (x - cx) ** 2 * ry ** 2 + (y - cy) ** 2 * rx ** 2 < rx ** 2 * ry ** 2;

/** Whether pixel (x, y) is inside each type's body. */
const SHAPES: Readonly<Record<string, (x: number, y: number) => boolean>> = {
  // A round blob with four short rays.
  sun: (x, y) => within(x, y, 16, 18, 10, 10) || (x >= 15 && x <= 16 && (y === 5 || y === 6)) || (y >= 17 && y <= 18 && (x === 4 || x === 28)),
  // A drop, pointed at the top.
  rain: (x, y) => within(x, y, 16, 21, 10, 9) || (y >= 5 && y < 21 && Math.abs(x - 15.5) * 16 <= (y - 5) * 10),
  // A crystal: a diamond, taller than it is wide.
  frost: (x, y) => Math.abs(x - 15.5) * 14 + Math.abs(y - 17.5) * 10 <= 140,
  // A bud with four round petals.
  bloom: (x, y) => within(x, y, 16, 19, 8, 8) || within(x, y, 9, 15, 5, 5) || within(x, y, 23, 15, 5, 5) || within(x, y, 16, 9, 5, 4),
  // A wide, low gust with a curl on top.
  gale: (x, y) => within(x, y, 16, 21, 13, 8) || within(x, y, 22, 12, 5, 4),
  // A cloud: three puffs over a flat base.
  storm: (x, y) => within(x, y, 11, 18, 7, 7) || within(x, y, 20, 15, 8, 8) || (x >= 5 && x <= 27 && y >= 18 && y <= 26),
};
const blob = (x: number, y: number) => within(x, y, 16, 19, 11, 10);

function letterAt(inside: (x: number, y: number) => boolean, x: number, y: number, facing: Facing): string {
  if (!inside(x, y)) {
    const touches = inside(x - 1, y) || inside(x + 1, y) || inside(x, y - 1) || inside(x, y + 1);
    return touches ? 'k' : '.';
  }
  // Light from the top left: a highlight there, shade along the bottom right edge.
  if (!inside(x + 1, y + 1) || !inside(x + 2, y + 2)) return 's';
  if (!inside(x - 2, y - 2) && inside(x + 2, y + 2)) return 'l';
  if (facing === 'front' && (x === 12 || x === 13 || x === 19 || x === 20) && (y === 17 || y === 18)) return 'e';
  return 'b';
}

/** The stand-in art for a species, by its weather type. Swap this one function for the real sprites. */
export function creatureArt(species: string, facing: Facing): CreatureArt {
  const type = speciesType(species) ?? '';
  const inside = SHAPES[type] ?? blob;
  const [body, shade, light] = COLOURS[type] ?? UNKNOWN;
  const rows = Array.from({ length: CREATURE_SIZE }, (_row, y) => Array.from({ length: CREATURE_SIZE }, (_column, x) => letterAt(inside, x, y, facing)).join(''));
  return { rows, palette: { k: OUTLINE, b: body, s: shade, l: light, e: OUTLINE } };
}

const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`;

function paint(canvas: HTMLCanvasElement, art: CreatureArt): void {
  canvas.width = CREATURE_SIZE;
  canvas.height = CREATURE_SIZE;
  const context = canvas.getContext('2d');
  if (!context) return;
  art.rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      const colour = art.palette[letter];
      if (colour === undefined) return;
      context.fillStyle = hex(colour);
      context.fillRect(x, y, 1, 1);
    });
  });
}

/** The Phaser texture for a species from one side, made on first use. */
export function creatureTexture(scene: Scene, species: string, facing: Facing): string {
  const key = `creature-${species}-${facing}`;
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  paint(canvas, creatureArt(species, facing));
  if (!scene.textures.addCanvas(key, canvas)) throw new Error(`could not add the ${key} texture`);
  return key;
}

/** A species from the front, for HTML screens; CSS scales it up crisply. */
export function creaturePortrait(species: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'creature';
  canvas.setAttribute('aria-hidden', 'true');
  paint(canvas, creatureArt(species, 'front'));
  return canvas;
}
