/**
 * Placeholder art drawn in code: each sprite is rows of palette letters, one letter per pixel.
 * '.' is transparent. Real art will replace this; the shapes only need to read at a glance.
 */

export type PixelArt = { readonly rows: readonly string[]; readonly palette: Readonly<Record<string, number>> };

const OUTLINE = 0x1b1b2f;

export const COURIER: PixelArt = {
  palette: { k: OUTLINE, y: 0xf2c14e, s: 0xf4c7a1, b: 0x3a7bd5, r: 0x8b5a2b, m: 0xc98b4f, d: 0x4a3426 },
  rows: [
    '................',
    '.....kkkkkk.....',
    '....kyyyyyyk....',
    '...kyyyyyyyyk...',
    '...kkkkkkkkkkkk.',
    '....kssssssk....',
    '....kskssksk....',
    '....kssssssk....',
    '.....kbbbbk.....',
    '....kbbrbbbk....',
    '...kbbbbrbbbk...',
    '...ksbbbbrbsk...',
    '....kbbbbbmk....',
    '....kbbkkbbk....',
    '....kddk.kddk...',
    '.....kk...kk....',
  ],
};

const GRASS = { g: 0x5bbf5b, l: 0x7ad66f, n: 0x3e9a4a };

export const TILES: Readonly<Record<string, PixelArt>> = {
  grass: {
    palette: GRASS,
    rows: [
      'gggggggggggggggg',
      'gggggglggggggggg',
      'gggggnlngggggggg',
      'gggggggggggggggg',
      'gggggggggggglggg',
      'gglgggggggggnlng',
      'gnlngggggggggggg',
      'gggggggggggggggg',
      'gggggggggggggggg',
      'ggggggggglgggggg',
      'gggggggggnlngggg',
      'gggggggggggggggg',
      'ggglgggggggggggg',
      'ggnlnggggggggglg',
      'ggggggggggggggng',
      'gggggggggggggggg',
    ],
  },
  flowers: {
    palette: { ...GRASS, p: 0xff7eb6, w: 0xfff3b0, o: 0xf59f00 },
    rows: [
      'gggggggggggggggg',
      'gggpgggggggggggg',
      'ggpwpgggggglgggg',
      'gggpgggggggnlngg',
      'gggngggggggggggg',
      'gggggggggogggggg',
      'ggggggggowoggggg',
      'gglggggggogggggg',
      'gnlngggggngggggg',
      'gggggggggggggggg',
      'gggggggggggggpgg',
      'ggggopggggggpwpg',
      'gggowoggggggggpg',
      'ggggogggggggggng',
      'ggggnggggggggggg',
      'gggggggggggggggg',
    ],
  },
  rock: {
    palette: { a: 0x8a5a3b, b: 0x6b4329, c: 0xa8744f },
    rows: [
      'aaaaaaaaaaaaaaaa',
      'aacaaaaaaaaacaaa',
      'aaaaaaabaaaaaaaa',
      'bbbbbbbbbbbbbbbb',
      'aaaaaaaaaaaaaaaa',
      'aaaacaaaaaaaaaca',
      'aaaaaaaaabaaaaaa',
      'bbbbbbbbbbbbbbbb',
      'aaaaaaaaaaaaaaaa',
      'acaaaaaaaaacaaaa',
      'aaaaabaaaaaaaaaa',
      'bbbbbbbbbbbbbbbb',
      'aaaaaaaaaaaaaaaa',
      'aaaaaaaacaaaaaaa',
      'aaabaaaaaaaaabaa',
      'bbbbbbbbbbbbbbbb',
    ],
  },
  cloud: {
    palette: { w: 0xffffff, s: 0xd9f0ff },
    rows: [
      '................',
      '................',
      '................',
      '................',
      '.....wwww.......',
      '...wwwwwwww.....',
      '..wwwwwwwwwwww..',
      '.wwwwwwwwwwwwww.',
      'wwwwwwwwwwwwwwww',
      'wwwwwwwwwwwwwwww',
      '.ssssssssssssss.',
      '................',
      '................',
      '................',
      '................',
      '................',
    ],
  },
};

/**
 * The placeholder island, one letter per tile: g grass, f flowers, r rock underside.
 * The rows narrow at the bottom so it reads as floating.
 */
export const ISLAND: readonly string[] = [
  '...gggg...',
  '.gggggfgg.',
  'gggfgggggg',
  'gggggggfgg',
  'ggfggggggg',
  '.gggggggg.',
  '..rrrrrr..',
  '...rrrr...',
  '....rr....',
];

export const ISLAND_TILE_KEYS: Readonly<Record<string, string>> = { g: 'grass', f: 'flowers', r: 'rock' };

export function checkArt(name: string, art: PixelArt, size: number): void {
  if (art.rows.length !== size) throw new Error(`${name} has ${art.rows.length} rows, not ${size}`);
  art.rows.forEach((row, y) => {
    if (row.length !== size) throw new Error(`${name} row ${y} is ${row.length} wide, not ${size}`);
    for (const letter of row) {
      if (letter !== '.' && art.palette[letter] === undefined) throw new Error(`${name} uses "${letter}" with no colour`);
    }
  });
}
