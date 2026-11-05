/**
 * Placeholder art drawn in code: each sprite is rows of palette letters, one letter per pixel.
 * '.' is transparent. Real art will replace this; the shapes only need to read at a glance.
 */

export type PixelArt = { readonly rows: readonly string[]; readonly palette: Readonly<Record<string, number>> };

const OUTLINE = 0x1b1b2f;

/** `y` is the cap, which each avatar recolours. */
const COURIER_PALETTE: Readonly<Record<string, number>> = { k: OUTLINE, y: 0xf2c14e, s: 0xf4c7a1, b: 0x3a7bd5, r: 0x8b5a2b, m: 0xc98b4f, d: 0x4a3426 };

/** The facings the courier is drawn in. Facing left is facing right, mirrored. */
export const COURIER_FACINGS = ['down', 'up', 'right'] as const;
export type CourierFacing = (typeof COURIER_FACINGS)[number];
export const COURIER_POSES = ['stand', 'stepA', 'stepB'] as const;
export type CourierPose = (typeof COURIER_POSES)[number];
/** One walk cycle covers two steps: a foot forward, standing, the other foot, standing. */
export const WALK_CYCLE: readonly CourierPose[] = ['stepA', 'stand', 'stepB', 'stand'];

/** Everything above the feet, 14 rows. */
const BODIES: Readonly<Record<CourierFacing, readonly string[]>> = {
  down: [
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
  ],
  up: [
    '................',
    '.....kkkkkk.....',
    '....kyyyyyyk....',
    '...kyyyyyyyyk...',
    '...kkkkkkkkkk...',
    '....kddddddk....',
    '....kddddddk....',
    '....kddddddk....',
    '.....kbbbbk.....',
    '....kbmmmmbk....',
    '...kbbmmmmbbk...',
    '...ksbmmmmbsk...',
    '....kbbbbbbk....',
    '....kbbkkbbk....',
  ],
  right: [
    '................',
    '.....kkkkkk.....',
    '....kyyyyyyk....',
    '....kyyyyyyyk...',
    '....kkkkkkkkkkk.',
    '....kddsssssk...',
    '....kdssskssk...',
    '....kdsssssk....',
    '.....kbbbbk.....',
    '....kmbbbbbk....',
    '...kmmbbbbbk....',
    '...kmmbbbsbk....',
    '....kbbbbbbk....',
    '....kbbkkbbk....',
  ],
};

/** The bottom two rows, per pose: seen from the front or back, and from the side. */
const FRONT_FEET: Readonly<Record<CourierPose, readonly [string, string]>> = {
  stand: ['....kddk.kddk...', '.....kk...kk....'],
  stepA: ['.....kk..kddk...', '..........kk....'],
  stepB: ['....kddk..kk....', '.....kk.........'],
};
const SIDE_FEET: Readonly<Record<CourierPose, readonly [string, string]>> = {
  stand: ['.....kdkkdk.....', '.....kk..kk.....'],
  stepA: ['....kdk..kdk....', '...kk......kk...'],
  stepB: ['......kddk......', '......kkkk......'],
};

export function courierFrame(facing: CourierFacing, pose: CourierPose): PixelArt {
  const feet = facing === 'right' ? SIDE_FEET : FRONT_FEET;
  return { palette: COURIER_PALETTE, rows: [...BODIES[facing], ...feet[pose]] };
}

/** The courier facing forward, standing. */
export const COURIER: PixelArt = courierFrame('down', 'stand');

/** The same art with its cap in another colour. */
export function withCap(art: PixelArt, colour: number): PixelArt {
  return { rows: art.rows, palette: { ...art.palette, y: colour } };
}

export function checkArt(name: string, art: PixelArt, size: number): void {
  if (art.rows.length !== size) throw new Error(`${name} has ${art.rows.length} rows, not ${size}`);
  art.rows.forEach((row, y) => {
    if (row.length !== size) throw new Error(`${name} row ${y} is ${row.length} wide, not ${size}`);
    for (const letter of row) {
      if (letter !== '.' && art.palette[letter] === undefined) throw new Error(`${name} uses "${letter}" with no colour`);
    }
  });
}
