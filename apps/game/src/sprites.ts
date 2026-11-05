import { frameNames, isPngSprite, loadArt, type Art, type PixelSprite, type Sprite } from '@nebotok/core';
import type { Scene } from 'phaser';

/**
 * The art in `content/art/`, bundled into the game: drawn sprites become canvases here, so they
 * need no image files, and real-art PNGs are fetched from the game's own server. `docs/art.md` is
 * the guide to the files.
 */

const CONTENT = '../../../content/';
const files = import.meta.glob<unknown>('../../../content/art/*/*.json', { eager: true, import: 'default' });
const pngUrls = import.meta.glob<string>('../../../content/art/png/**/*.png', { eager: true, import: 'default' });

const loaded = loadArt(Object.fromEntries(Object.entries(files).map(([path, raw]) => [path.slice(CONTENT.length), raw])));
if (loaded.problems.length) throw new Error(`content/art does not load: ${loaded.problems.join('; ')}`);
export const ART: Art = loaded;

export function sprite(id: string): Sprite {
  const found = ART.sprites.get(id);
  if (!found) throw new Error(`no sprite ${id} in content/art`);
  return found;
}

export const textureKey = (id: string) => `art:${id}`;
export const animationKey = (id: string, name: string) => `${textureKey(id)}:${name}`;

const drawnSheets = new Map<string, HTMLCanvasElement>();
const pngSheets = new Map<string, HTMLImageElement>();
let pngsLoading: Promise<void> | null = null;

function drawSheet(art: PixelSprite): HTMLCanvasElement {
  const names = Object.keys(art.frames);
  const canvas = document.createElement('canvas');
  canvas.width = art.width * names.length;
  canvas.height = art.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas to draw sprites on');
  names.forEach((name, at) => {
    art.frames[name]?.forEach((row, y) => {
      [...row].forEach((key, x) => {
        const colour = art.palette[key];
        if (colour === undefined) return;
        context.fillStyle = colour;
        context.fillRect(at * art.width + x, y, 1, 1);
      });
    });
  });
  return canvas;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

/** Fetches every real-art PNG once. Drawn sprites need nothing fetched. Await it before drawing. */
export function loadArtImages(): Promise<void> {
  pngsLoading ??= Promise.all(
    [...ART.sprites].map(async ([id, art]) => {
      if (!isPngSprite(art)) return;
      const url = pngUrls[`${CONTENT}art/png/${art.png}`];
      if (!url) throw new Error(`${id} uses content/art/png/${art.png}, which is not in the build`);
      pngSheets.set(id, await loadImage(url));
    }),
  ).then(
    () => undefined,
    (error: unknown) => {
      pngsLoading = null;
      throw error;
    },
  );
  return pngsLoading;
}

/** A sprite's frames side by side in frame order, each `width` wide. */
export function spriteSheet(id: string): HTMLCanvasElement | HTMLImageElement {
  const art = sprite(id);
  if (isPngSprite(art)) {
    const image = pngSheets.get(id);
    if (!image) throw new Error(`${id} has not loaded yet; await loadArtImages() first`);
    return image;
  }
  let sheet = drawnSheets.get(id);
  if (!sheet) {
    sheet = drawSheet(art);
    drawnSheets.set(id, sheet);
  }
  return sheet;
}

/** Where a frame starts in its sprite's sheet, in pixels from the left. */
export function frameLeft(art: Sprite, frame: string): number {
  const at = frameNames(art).indexOf(frame);
  if (at < 0) throw new Error(`no frame "${frame}"`);
  return at * art.width;
}

/** Paints one frame onto a canvas of the frame's size: at once when drawn, or once its PNG loads. */
export function paintFrame(canvas: HTMLCanvasElement, id: string, frame: string): void {
  const art = sprite(id);
  canvas.width = art.width;
  canvas.height = art.height;
  const paint = () => {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, art.width, art.height);
    context.drawImage(spriteSheet(id), frameLeft(art, frame), 0, art.width, art.height, 0, 0, art.width, art.height);
  };
  if (!isPngSprite(art) || pngSheets.has(id)) paint();
  // A PNG that fails to load leaves the canvas empty; the world shows the same failure.
  else loadArtImages().then(paint, () => {});
}

/** Phaser shows each animation frame for 1000 / frameRate ms plus that frame's own `duration`. */
export function animationFrames(ms: readonly number[]): { frameRate: number; durations: number[] } {
  const shortest = Math.min(...ms);
  return { frameRate: 1_000 / shortest, durations: ms.map((each) => each - shortest) };
}

export type AnimationTiming = (name: string, ms: readonly number[]) => readonly number[];

/**
 * The Phaser texture for a sprite, made on first use: one named frame per sprite frame, and every
 * animation looping as `animationKey(id, name)`. `timing` may change an animation's `ms`.
 */
export function spriteTexture(scene: Scene, id: string, timing: AnimationTiming = (_name, ms) => ms): string {
  const key = textureKey(id);
  if (scene.textures.exists(key)) return key;
  const art = sprite(id);
  const sheet = spriteSheet(id);
  const texture = sheet instanceof HTMLCanvasElement ? scene.textures.addCanvas(key, sheet) : scene.textures.addImage(key, sheet);
  if (!texture) throw new Error(`could not add the ${key} texture`);
  frameNames(art).forEach((name, at) => texture.add(name, 0, at * art.width, 0, art.width, art.height));
  for (const [name, animation] of Object.entries(art.animations ?? {})) {
    const { frameRate, durations } = animationFrames(timing(name, animation.ms));
    scene.anims.create({
      key: animationKey(id, name),
      frames: animation.frames.map((frame, at) => ({ key, frame, duration: durations[at] ?? 0 })),
      frameRate,
      repeat: -1,
    });
  }
  return key;
}
