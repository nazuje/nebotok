import { AvatarsFile, courierFrame, type Avatar, type Language } from '@nebotok/core';
import raw from '../../../content/avatars.json';
import { courierSprite } from './couriers.ts';
import { paintFrame } from './sprites.ts';

export const AVATARS: readonly Avatar[] = AvatarsFile.parse(raw).avatars;

export function avatarName(id: string, language: Language): string {
  return AVATARS.find((avatar) => avatar.id === id)?.name[language] ?? id;
}

/** The avatar's courier facing forward, standing, for the profile screens. CSS scales it up crisply. */
export function avatarPortrait(id: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'avatar';
  canvas.setAttribute('aria-hidden', 'true');
  paintFrame(canvas, courierSprite(id), courierFrame('down', 'stand'));
  return canvas;
}
