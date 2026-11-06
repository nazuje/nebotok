import { animationFrameAt, frameNames, type SpriteAnimation } from '@nebotok/core';
import type { Scene } from 'phaser';
import { ART, frameLeft, sprite, spriteSheet } from './sprites.ts';
import { TILE } from './zoom.ts';

export type TilesetArt = {
  /** The texture key to give `addTilesetImage`. */
  readonly key: string;
  /** Shows each animated tile's frame for this moment. */
  animate(now: number): void;
};

/**
 * A map tileset drawn from `content/art/tilesets/<name>.json` onto one canvas texture, laid out as
 * the tileset image Tiled shows. A tile whose sprite has animations plays the first one, so every
 * copy of that tile on the map moves together.
 */
export function tilesetArt(scene: Scene, name: string): TilesetArt {
  const tileset = ART.tilesets.get(name);
  if (!tileset) throw new Error(`no content/art/tilesets/${name}.json`);
  const key = `tileset:${name}`;
  const canvas = document.createElement('canvas');
  canvas.width = tileset.columns * TILE;
  canvas.height = Math.ceil(tileset.tiles.length / tileset.columns) * TILE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas to draw tiles on');
  const draw = (at: number, id: string, frame: string) => {
    const left = (at % tileset.columns) * TILE;
    const top = Math.floor(at / tileset.columns) * TILE;
    context.clearRect(left, top, TILE, TILE);
    context.drawImage(spriteSheet(id), frameLeft(sprite(id), frame), 0, TILE, TILE, left, top, TILE, TILE);
  };
  tileset.tiles.forEach((id, at) => draw(at, id, frameNames(sprite(id))[0] ?? ''));
  const animated = tileset.tiles.flatMap((id, at) => {
    const animation: SpriteAnimation | undefined = Object.values(sprite(id).animations ?? {})[0];
    return animation ? [{ id, at, animation, shown: frameNames(sprite(id))[0] ?? '' }] : [];
  });
  const texture = scene.textures.addCanvas(key, canvas);
  if (!texture) throw new Error(`could not add the ${key} texture`);
  return {
    key,
    animate(now) {
      let changed = false;
      for (const tile of animated) {
        const frame = animationFrameAt(tile.animation, now);
        if (frame === tile.shown) continue;
        draw(tile.at, tile.id, frame);
        tile.shown = frame;
        changed = true;
      }
      if (changed) texture.refresh();
    },
  };
}
