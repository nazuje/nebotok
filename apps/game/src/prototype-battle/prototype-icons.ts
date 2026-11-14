import { frameNames, spriteFor } from '@nebotok/core';
import { paintFrame, sprite } from '../sprites.ts';

/**
 * Placeholder pixel icons for each weather type, drawn here only for the prototype's picture buttons:
 * a sun disc, a swirl, a raindrop, a snowflake, a lightning bolt and a flower. Each grid gets a dark
 * outline when painted so it reads on any colour.
 */

type Icon = { readonly palette: Readonly<Record<string, string>>; readonly rows: readonly string[] };

const ICONS: Readonly<Record<string, Icon>> = {
  sun: {
    palette: { Y: '#ffd43b', O: '#f08c00' },
    rows: ['......Y......', '.Y....Y....Y.', '..Y.......Y..', '.....OOO.....', '....OYYYO....', '...OYYYYYO...', 'YY.OYYYYYO.YY', '...OYYYYYO...', '....OYYYO....', '.....OOO.....', '..Y.......Y..', '.Y....Y....Y.', '......Y......'],
  },
  gale: {
    palette: { B: '#66d9e8', W: '#e3fafc' },
    rows: ['.............', '....BBBBB....', '..BB.....B...', '.B...BBB..B..', '.B..B...B.B..', 'B..B..BW.B.B.', 'B..B.BB..B.B.', 'B..B....B..B.', '.B..BBBB..B..', '.B.......B...', '..BB...BB....', '....BBB......', '.............'],
  },
  rain: {
    palette: { B: '#339af0', L: '#d0ebff' },
    rows: ['......B......', '......B......', '.....BBB.....', '.....BBB.....', '....BBBBB....', '...BBLBBBB...', '..BBLBBBBBB..', '..BLLBBBBBB..', '..BLBBBBBBB..', '..BBBBBBBBB..', '...BBBBBBB...', '....BBBBB....', '.............'],
  },
  frost: {
    palette: { C: '#99e9f2', W: '#ffffff' },
    rows: ['......C......', '....C.C.C....', '.C...CCC...C.', '..C...C...C..', '...C..C..C...', '....C.C.C....', 'CCCCCCWCCCCCC', '....C.C.C....', '...C..C..C...', '..C...C...C..', '.C...CCC...C.', '....C.C.C....', '......C......'],
  },
  storm: {
    palette: { Y: '#ffe066', O: '#fab005' },
    rows: ['.......YYYY..', '......YYYY...', '.....YYYY....', '....YYYY.....', '...YYYY......', '..YYYYYYYYY..', '.......YYYY..', '......YYYO...', '.....YYYO....', '....YYO......', '...YYO.......', '..YO.........', '.Y...........'],
  },
  bloom: {
    palette: { P: '#f783ac', Y: '#ffd43b' },
    rows: ['....PPPPP....', '...PPPPPPP...', '...PPPPPPP...', 'PPP.PPPPP.PPP', 'PPPP.PPP.PPPP', 'PPPPPYYYPPPPP', 'PPPPPYYYPPPPP', 'PPPPPYYYPPPPP', 'PPPP.PPP.PPPP', 'PPP.PPPPP.PPP', '...PPPPPPP...', '...PPPPPPP...', '....PPPPP....'],
  },
};

const OUTLINE = '#102a43';

/** Each weather type's colour, for cards, trails and glows. */
export const TYPE_COLOUR: Readonly<Record<string, number>> = {
  sun: 0xffc928,
  gale: 0x5fd3c6,
  rain: 0x339af0,
  frost: 0x9be7f5,
  storm: 0x845ef7,
  bloom: 0xf783ac,
};

export const typeColour = (type: string): number => TYPE_COLOUR[type] ?? 0xffffff;
export const cssColour = (colour: number): string => `#${colour.toString(16).padStart(6, '0')}`;

/** A placeholder icon on a canvas one pixel per grid cell, plus a one-pixel outline all round. */
export function placeholderIcon(type: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'proto-icon';
  canvas.setAttribute('aria-hidden', 'true');
  const icon = ICONS[type];
  const size = (icon?.rows.length ?? 13) + 2;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!icon || !context) return canvas;
  const filled = (x: number, y: number) => {
    const key = icon.rows[y]?.[x];
    return key !== undefined && key !== '.';
  };
  for (let y = -1; y <= icon.rows.length; y += 1) {
    for (let x = -1; x <= icon.rows.length; x += 1) {
      const key = icon.rows[y]?.[x];
      const colour = key === undefined ? undefined : icon.palette[key];
      const near = filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1);
      const paint = colour ?? (near ? OUTLINE : undefined);
      if (paint === undefined) continue;
      context.fillStyle = paint;
      context.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  return canvas;
}

/** The game's own weather icon from content/art, for the wheel's cards. */
export function weatherIcon(type: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'proto-icon';
  canvas.setAttribute('aria-hidden', 'true');
  const id = spriteFor.weatherIcon(type);
  paintFrame(canvas, id, frameNames(sprite(id))[0] ?? '');
  return canvas;
}
