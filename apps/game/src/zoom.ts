export const TILE = 16;

/** The smallest patch of world, in tiles, every screen must show. Sized for a phone held upright. */
export const MIN_VIEW_TILES = { width: 11, height: 11 } as const;

export type View = { readonly zoom: number; readonly width: number; readonly height: number };

/**
 * The largest whole-number zoom that still shows MIN_VIEW_TILES, and the game size in world
 * pixels that fills the screen at that zoom. Whole numbers keep every pixel the same size.
 */
export function integerView(screenWidth: number, screenHeight: number): View {
  const fit = Math.min(screenWidth / (MIN_VIEW_TILES.width * TILE), screenHeight / (MIN_VIEW_TILES.height * TILE));
  const zoom = Math.max(1, Math.floor(fit));
  return {
    zoom,
    width: Math.max(1, Math.floor(screenWidth / zoom)),
    height: Math.max(1, Math.floor(screenHeight / zoom)),
  };
}
