import { spriteFor } from '@nebotok/core';
import { ART } from './sprites.ts';

/** A battle without battlefield weather is a clear day, which the sun background already draws. */
export const CLEAR_WEATHER = 'sun';

/** The background sprite behind a battle in `weather`, or the clear day when it has none or no art. */
export function backdropSprite(weather: string | null): string {
  const id = spriteFor.weather(weather ?? CLEAR_WEATHER);
  return ART.sprites.has(id) ? id : spriteFor.weather(CLEAR_WEATHER);
}

type Size = { readonly width: number; readonly height: number };
/** Where a background goes, in game pixels: its top left corner and a whole-number scale. */
export type BackdropPlacement = { readonly x: number; readonly y: number; readonly scale: number };

/**
 * The background as big as it must be to span the whole canvas width and reach from the top down to
 * the field's bottom edge, at a whole-number scale so its pixels stay square. It is centred across and
 * rests on the field's bottom, so its ground lies under your creature; whatever it crops is sky above
 * the canvas or the sides.
 */
export function backdropPlacement(art: Size, canvas: Size, fieldBottom: number): BackdropPlacement {
  const bottom = Math.max(1, Math.min(fieldBottom, canvas.height));
  const scale = Math.max(1, Math.ceil(Math.max(canvas.width / art.width, bottom / art.height)));
  return { x: Math.round((canvas.width - art.width * scale) / 2), y: Math.round(bottom - art.height * scale), scale };
}
