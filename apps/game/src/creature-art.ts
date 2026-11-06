import { spriteFor } from '@nebotok/core';
import type { Scene } from 'phaser';
import { paintFrame, spriteTexture } from './sprites.ts';

/**
 * What each species looks like: its sprite in `content/art/creatures/`, with a `front` and a `back`
 * frame (`docs/art.md`). `creatureTexture` and `creaturePortrait` are the only places that decide
 * which picture a species gets.
 */

/** The size the battle field is laid out for. Creature sprites are 32 by 32 or 48 by 48. */
export const CREATURE_SIZE = 32;
export type Facing = 'front' | 'back';

/** The Phaser texture and frame for a species from one side, made on first use. */
export function creatureTexture(scene: Scene, species: string, facing: Facing): { key: string; frame: Facing } {
  return { key: spriteTexture(scene, spriteFor.species(species)), frame: facing };
}

/** A species from the front, for HTML screens; CSS scales it up crisply. */
export function creaturePortrait(species: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'creature';
  canvas.setAttribute('aria-hidden', 'true');
  paintFrame(canvas, spriteFor.species(species), 'front');
  return canvas;
}
