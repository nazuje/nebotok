import { AvatarsFile, type Avatar, type Language } from '@nebotok/core';
import raw from '../../../content/avatars.json';
import { COURIER, type PixelArt } from './art.ts';

export const AVATARS: readonly Avatar[] = AvatarsFile.parse(raw).avatars;

const UNKNOWN_COLOUR = '#8a8a8a';

export function avatarColour(id: string): string {
  return AVATARS.find((avatar) => avatar.id === id)?.color ?? UNKNOWN_COLOUR;
}

export function avatarName(id: string, language: Language): string {
  return AVATARS.find((avatar) => avatar.id === id)?.name[language] ?? id;
}

const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`;

/** Paints pixel art onto a canvas one pixel per cell; CSS scales it up crisply. */
export function paintCanvas(canvas: HTMLCanvasElement, art: PixelArt): void {
  const height = art.rows.length;
  const width = art.rows[0]?.length ?? 0;
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, width, height);
  art.rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      const colour = art.palette[letter];
      if (colour === undefined) return;
      context.fillStyle = hex(colour);
      context.fillRect(x, y, 1, 1);
    });
  });
}

/** The courier facing forward in an avatar's cap colour, for the profile screens. */
export function avatarPortrait(id: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'avatar';
  canvas.setAttribute('aria-hidden', 'true');
  paintCanvas(canvas, { rows: COURIER.rows, palette: { ...COURIER.palette, y: Number.parseInt(avatarColour(id).slice(1), 16) } });
  return canvas;
}
