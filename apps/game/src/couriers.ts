import { DEFAULT_COURIER, courierFrame, courierWalk, spriteFor, type CourierFacing, type CourierPose } from '@nebotok/core';
import type { Scene } from 'phaser';
import { ART, spriteTexture, type AnimationTiming } from './sprites.ts';

export const frameName = (facing: CourierFacing, pose: CourierPose) => courierFrame(facing, pose);
export const walkAnimation = (texture: string, facing: CourierFacing) => `${texture}:${courierWalk(facing)}`;

/** The sprite drawn for an avatar: its own courier, or the default one for an avatar without. */
export function courierSprite(avatar: string): string {
  const own = spriteFor.avatar(avatar);
  return ART.sprites.has(own) ? own : DEFAULT_COURIER;
}

/** Scales `ms` so they add up to `total`, keeping their proportions. */
export function stretched(ms: readonly number[], total: number): number[] {
  const sum = ms.reduce((all, each) => all + each, 0);
  return ms.map((each) => (each * total) / sum);
}

/** One walk cycle covers two steps, so the walk animations are stretched to the walking speed. */
export function walkTiming(stepMs: number): AnimationTiming {
  return (name, ms) => (name.startsWith('walk-') ? stretched(ms, 2 * stepMs) : ms);
}

/** The texture and walk animations for one avatar's courier, made on first use. */
export function courierTexture(scene: Scene, avatar: string, stepMs: number): string {
  return spriteTexture(scene, courierSprite(avatar), walkTiming(stepMs));
}
