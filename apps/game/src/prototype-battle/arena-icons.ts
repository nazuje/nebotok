import type { AbilityKind } from './arena-kits.ts';
import { placeholderIcon, weatherIcon } from './prototype-icons.ts';

/**
 * Placeholder pictures for the arena's ability buttons, drawn only for the prototype. A basic shot
 * shows the game's own weather icon; the frost and sun pictures stand for the freeze circle and the
 * sun zone; the rest are small pixel grids here, outlined so they read on any button.
 */

type Grid = { readonly palette: Readonly<Record<string, string>>; readonly rows: readonly string[] };

const GRIDS: Readonly<Partial<Record<AbilityKind, Grid>>> = {
  lunge: {
    palette: { W: '#e6fcf5', B: '#63e6be' },
    rows: ['.............', '.......W.....', '.......WW....', 'BBB....WWW...', '.......WWWW..', '..BBBBWWWWWW.', '.......WWWW..', 'BBB....WWW...', '.......WW....', '.......W.....', '.............', '.............', '.............'],
  },
  wall: {
    palette: { W: '#ffffff', B: '#63e6be' },
    rows: ['.............', '.WW..........', '.WW...B......', '.WW...BB.....', '.WW.BBBBB....', '.WW...BB.....', '.WW...B..B...', '.WW......BB..', '.WW....BBBBB.', '.WW......BB..', '.WW......B...', '.WW..........', '.............'],
  },
  puddle: {
    palette: { B: '#339af0', L: '#a5d8ff', D: '#1864ab' },
    rows: ['.............', '......B......', '.....BBB.....', '.....BLB.....', '......B......', '.............', '...DDDDDDD...', '.DDBBBBBBBDD.', 'DBBLLBBBBBBBD', 'DBBBBBBBBLLBD', '.DDBBBBBBBDD.', '...DDDDDDD...', '.............'],
  },
  cone: {
    palette: { Y: '#ffd43b', O: '#fab005', W: '#fff9db' },
    rows: ['.............', '..........Y..', '........YYY..', '......YYYYY..', '....OOYYWYY..', '.OOOOYYWWWY..', 'OOOOOYWWWWY..', '.OOOOYYWWWY..', '....OOYYWYY..', '......YYYYY..', '........YYY..', '..........Y..', '.............'],
  },
  shield: {
    palette: { Y: '#fcc419', L: '#fff3bf', W: '#ffffff' },
    rows: ['....YYYYY....', '..YYLLLLLYY..', '.YLWWLLLLLLY.', '.YLWLLLLLLLY.', 'YLLLLLLLLLLLY', 'YLLLLLLLLLLLY', 'YLLLLLLLLLLLY', 'YLLLLLLLLLLLY', 'YLLLLLLLLLLLY', '.YLLLLLLLLLY.', '.YLLLLLLLLLY.', '..YYLLLLLYY..', '....YYYYY....'],
  },
};

const OUTLINE = '#102a43';

function paintGrid(grid: Grid): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'proto-icon';
  canvas.setAttribute('aria-hidden', 'true');
  const size = grid.rows.length + 2;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) return canvas;
  const filled = (x: number, y: number) => {
    const key = grid.rows[y]?.[x];
    return key !== undefined && key !== '.';
  };
  for (let y = -1; y <= grid.rows.length; y += 1) {
    for (let x = -1; x <= grid.rows.length; x += 1) {
      const key = grid.rows[y]?.[x];
      const colour = key === undefined ? undefined : grid.palette[key];
      const near = filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1);
      const paint = colour ?? (near ? OUTLINE : undefined);
      if (paint === undefined) continue;
      context.fillStyle = paint;
      context.fillRect(x + 1, y + 1, 1, 1);
    }
  }
  return canvas;
}

/** The picture for an ability of a creature of weather `type`. */
export function abilityIcon(kind: AbilityKind, type: string): HTMLCanvasElement {
  if (kind === 'bolt') return weatherIcon(type);
  if (kind === 'freeze') return placeholderIcon('frost');
  if (kind === 'zone') return placeholderIcon('sun');
  const grid = GRIDS[kind];
  return grid ? paintGrid(grid) : placeholderIcon(type);
}
