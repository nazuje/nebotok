import type { Scene } from 'phaser';
import { COURIER_FACINGS, COURIER_POSES, WALK_CYCLE, courierFrame, withCap, type CourierFacing, type CourierPose } from './art.ts';
import { capColour, paintArt } from './avatars.ts';
import { TILE } from './zoom.ts';

export const frameName = (facing: CourierFacing, pose: CourierPose) => `${facing}-${pose}`;
export const walkAnimation = (texture: string, facing: CourierFacing) => `${texture}-walk-${facing}`;

/**
 * The sprite sheet and walk animations for one avatar, made on first use: every facing and pose
 * of the placeholder courier in the avatar's cap colour. A walk cycle spans two steps.
 */
export function courierTexture(scene: Scene, avatar: string, stepMs: number): string {
  const key = `courier-${avatar}`;
  if (scene.textures.exists(key)) return key;
  const canvas = document.createElement('canvas');
  canvas.width = TILE * COURIER_FACINGS.length * COURIER_POSES.length;
  canvas.height = TILE;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no 2D canvas for the courier sprites');
  const frames: { name: string; left: number }[] = [];
  for (const facing of COURIER_FACINGS) {
    for (const pose of COURIER_POSES) {
      const left = frames.length * TILE;
      paintArt(context, withCap(courierFrame(facing, pose), capColour(avatar)), left, 0);
      frames.push({ name: frameName(facing, pose), left });
    }
  }
  const texture = scene.textures.addCanvas(key, canvas);
  if (!texture) throw new Error(`could not add the ${key} texture`);
  for (const { name, left } of frames) texture.add(name, 0, left, 0, TILE, TILE);
  for (const facing of COURIER_FACINGS) {
    scene.anims.create({
      key: walkAnimation(key, facing),
      frames: WALK_CYCLE.map((pose) => ({ key, frame: frameName(facing, pose) })),
      frameRate: (WALK_CYCLE.length / 2) * (1_000 / stepMs),
      repeat: -1,
    });
  }
  return key;
}
