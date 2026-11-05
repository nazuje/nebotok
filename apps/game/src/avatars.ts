import { AvatarsFile, type Avatar, type Language } from '@nebotok/core';
import raw from '../../../content/avatars.json';
import { COURIER, withCap, type PixelArt } from './art.ts';

export const AVATARS: readonly Avatar[] = AvatarsFile.parse(raw).avatars;

const UNKNOWN_COLOUR = '#8a8a8a';

export function avatarColour(id: string): string {
  return AVATARS.find((avatar) => avatar.id === id)?.color ?? UNKNOWN_COLOUR;
}

/** The avatar's colour as a number, for recolouring pixel art. */
export function capColour(id: string): number {
  return Number.parseInt(avatarColour(id).slice(1), 16);
}

export function avatarName(id: string, language: Language): string {
  return AVATARS.find((avatar) => avatar.id === id)?.name[language] ?? id;
}

const hex = (colour: number) => `#${colour.toString(16).padStart(6, '0')}`;

/** Paints pixel art one pixel per cell with its top left corner at (left, top). */
export function paintArt(context: CanvasRenderingContext2D, art: PixelArt, left: number, top: number): void {
  art.rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      const colour = art.palette[letter];
      if (colour === undefined) return;
      context.fillStyle = hex(colour);
      context.fillRect(left + x, top + y, 1, 1);
    });
  });
}

/** Paints pixel art onto a canvas one pixel per cell; CSS scales it up crisply. */
export function paintCanvas(canvas: HTMLCanvasElement, art: PixelArt): void {
  canvas.width = art.rows[0]?.length ?? 0;
  canvas.height = art.rows.length;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  paintArt(context, art, 0, 0);
}

/** The courier facing forward in an avatar's cap colour, for the profile screens. */
export function avatarPortrait(id: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'avatar';
  canvas.setAttribute('aria-hidden', 'true');
  paintCanvas(canvas, withCap(COURIER, capColour(id)));
  return canvas;
}
