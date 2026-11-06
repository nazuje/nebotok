import { z } from 'zod';

/**
 * Placeholder art as data. Each sprite is `content/art/<kind>/<name>.json`, and its id is
 * `<kind>/<name>`. A sprite is either drawn in its file (a palette and rows of characters, one
 * character per pixel), a recolour of another drawn sprite, or a PNG in `content/art/png/` with its
 * frames side by side. `docs/art.md` is the guide.
 */

export const SPRITE_KINDS = ['tiles', 'couriers', 'creatures', 'icons', 'backgrounds', 'items'] as const;
export type SpriteKind = (typeof SPRITE_KINDS)[number];

/** "." is always transparent, so it can never be a palette colour. */
export const TRANSPARENT = '.';
export const MAX_COLOURS = 16;
const MAX_SIDE = 64;
const MAX_FRAMES = 64;
const MAX_ANIMATIONS = 16;

/** The facings the courier is drawn in. Facing left is facing right, mirrored. */
export const COURIER_FACINGS = ['down', 'up', 'right'] as const;
export type CourierFacing = (typeof COURIER_FACINGS)[number];
export const COURIER_POSES = ['stand', 'step-a', 'step-b'] as const;
export type CourierPose = (typeof COURIER_POSES)[number];
export const courierFrame = (facing: CourierFacing, pose: CourierPose) => `${facing}-${pose}`;
export const courierWalk = (facing: CourierFacing) => `walk-${facing}`;
/** The courier drawn for an avatar id that has no sprite of its own. */
export const DEFAULT_COURIER = 'couriers/courier';

/** The sprite each kind of content needs, by its id. */
export const spriteFor = {
  avatar: (id: string) => `couriers/${id}`,
  species: (id: string) => `creatures/${id}`,
  /** The small picture of a species for the world, lists and menus. */
  speciesIcon: (id: string) => `icons/${id}`,
  weather: (id: string) => `backgrounds/${id}`,
  item: (id: string) => `items/${id}`,
} as const;

type KindRule = { readonly sizes: readonly (readonly [number, number])[]; readonly frames: readonly string[]; readonly animations: readonly string[] };

/** The sizes each kind may be, and the frames and animations the game asks every sprite of it for. */
export const SPRITE_RULES: Readonly<Record<SpriteKind, KindRule>> = {
  tiles: { sizes: [[16, 16]], frames: [], animations: [] },
  couriers: {
    sizes: [[16, 16]],
    frames: COURIER_FACINGS.flatMap((facing) => COURIER_POSES.map((pose) => courierFrame(facing, pose))),
    animations: COURIER_FACINGS.map(courierWalk),
  },
  creatures: { sizes: [[32, 32], [48, 48]], frames: ['front', 'back'], animations: [] },
  icons: { sizes: [[16, 16]], frames: [], animations: [] },
  backgrounds: { sizes: [[64, 36]], frames: [], animations: [] },
  items: { sizes: [[16, 16]], frames: [], animations: [] },
};

const NAME = '[a-z][a-z0-9-]{0,31}';
export const SpriteId = z.string().regex(new RegExp(`^[a-z]+/${NAME}$`), 'sprite ids look like "tiles/grass"');
export const SPRITE_FILE = new RegExp(`^art/([a-z]+)/(${NAME})\\.json$`);
export const TILESET_FILE = new RegExp(`^art/tilesets/(${NAME})\\.json$`);
/** Real art: PNGs in `content/art/png/`, named by the sprites that use them. */
export const ART_PNG = /^art\/png\/([a-z0-9-]+(?:\/[a-z0-9-]+)*\.png)$/;

const FRAME_NAME = /^[a-z][a-z0-9-]{0,23}$/;
const FRAME_NAME_RULE = 'frame and animation names are short lowercase words, such as "step-a"';
const FrameName = z.string().regex(FRAME_NAME, FRAME_NAME_RULE);
/** One printable ASCII character other than ".", which is transparent. */
const PALETTE_KEY = /^[!-\-/-~]$/;

/** A record whose keys follow `pattern`, with `min` to `max` entries; zod's own key errors name no rule. */
function namedRecord<T extends z.ZodType>(values: T, pattern: RegExp, rule: (key: string) => string, [min, max]: readonly [number, number], noun: string) {
  return z.record(z.string(), values).superRefine((record, ctx) => {
    const keys = Object.keys(record);
    if (keys.length < min || keys.length > max) ctx.addIssue({ code: 'custom', message: `has ${min} to ${max} ${noun}, not ${keys.length}` });
    for (const key of keys) if (!pattern.test(key)) ctx.addIssue({ code: 'custom', message: rule(key), path: [key] });
  });
}

const Colour = z.string().regex(/^#[0-9a-f]{6}$/, 'colours look like #3a7bd5');
const Palette = namedRecord(Colour, PALETTE_KEY, (key) => `palette key "${key}" must be one character other than "."`, [1, MAX_COLOURS], 'colours');
const Side = z.number().int().min(1).max(MAX_SIDE);
const PngPath = z.string().regex(/^[a-z0-9-]+(?:\/[a-z0-9-]+)*\.png$/, 'png names a file in content/art/png/, such as "tiles/grass.png"');

/** An animation plays its frames in order, each for its `ms`, and loops. */
const Animation = z
  .strictObject({ frames: z.array(FrameName).min(1).max(32), ms: z.array(z.number().int().min(16).max(10_000)).min(1).max(32) })
  .refine((animation) => animation.frames.length === animation.ms.length, 'an animation has one "ms" for each frame');
export type SpriteAnimation = z.infer<typeof Animation>;
const Animations = namedRecord(Animation, FRAME_NAME, (key) => `"${key}": ${FRAME_NAME_RULE}`, [0, MAX_ANIMATIONS], 'animations');

type Issue = { readonly path: (string | number)[]; readonly message: string };

function animationIssues(animations: Readonly<Record<string, SpriteAnimation>> | undefined, frames: readonly string[]): Issue[] {
  return Object.entries(animations ?? {}).flatMap(([name, animation]) =>
    animation.frames.flatMap((frame, at) => (frames.includes(frame) ? [] : [{ path: ['animations', name, 'frames', at], message: `animation "${name}" plays frame "${frame}", which this sprite does not have` }])),
  );
}

function addIssues(ctx: z.RefinementCtx, issues: readonly Issue[]): void {
  for (const { path, message } of issues) ctx.addIssue({ code: 'custom', message, path });
}

function pixelIssues(sprite: { width: number; height: number; palette: Record<string, string>; frames: Record<string, string[]> }): Issue[] {
  const issues: Issue[] = [];
  for (const [name, rows] of Object.entries(sprite.frames)) {
    if (rows.length !== sprite.height) issues.push({ path: ['frames', name], message: `frame "${name}" has ${rows.length} rows, not ${sprite.height}` });
    rows.forEach((row, y) => {
      if (row.length !== sprite.width) issues.push({ path: ['frames', name, y], message: `frame "${name}" row ${y} is ${row.length} wide, not ${sprite.width}` });
      const unknown = [...new Set(row)].filter((pixel) => pixel !== TRANSPARENT && !Object.hasOwn(sprite.palette, pixel));
      if (unknown.length) issues.push({ path: ['frames', name, y], message: `frame "${name}" row ${y} uses ${unknown.map((pixel) => `"${pixel}"`).join(', ')}, not in the palette` });
    });
  }
  return issues;
}

/** A sprite drawn in its file: every frame is `height` rows of `width` palette characters. */
export const PixelSprite = z
  .strictObject({
    width: Side,
    height: Side,
    palette: Palette,
    frames: namedRecord(z.array(z.string().max(MAX_SIDE)).min(1).max(MAX_SIDE), FRAME_NAME, (key) => `"${key}": ${FRAME_NAME_RULE}`, [1, MAX_FRAMES], 'frames'),
    animations: Animations.optional(),
  })
  .superRefine((sprite, ctx) => addIssues(ctx, [...pixelIssues(sprite), ...animationIssues(sprite.animations, Object.keys(sprite.frames))]));
export type PixelSprite = z.infer<typeof PixelSprite>;

/** Real art: a PNG of `frames.length` frames side by side, each `width` by `height`. */
export const PngSprite = z
  .strictObject({
    width: Side,
    height: Side,
    png: PngPath,
    frames: z.array(FrameName).min(1).max(MAX_FRAMES),
    animations: Animations.optional(),
  })
  .superRefine((sprite, ctx) => {
    sprite.frames.forEach((frame, at) => {
      if (sprite.frames.indexOf(frame) !== at) ctx.addIssue({ code: 'custom', message: `frame "${frame}" appears twice`, path: ['frames', at] });
    });
    addIssues(ctx, animationIssues(sprite.animations, sprite.frames));
  });
export type PngSprite = z.infer<typeof PngSprite>;

/** Another drawn sprite with some of its palette colours changed. */
export const RecolourSprite = z.strictObject({ recolour: SpriteId, palette: Palette });
export type RecolourSprite = z.infer<typeof RecolourSprite>;

/** A sprite as the game draws it: recolours already applied. */
export type Sprite = PixelSprite | PngSprite;
export type SpriteFile = Sprite | RecolourSprite;

export const isPngSprite = (sprite: Sprite): sprite is PngSprite => 'png' in sprite;
export const frameNames = (sprite: Sprite): readonly string[] => (isPngSprite(sprite) ? sprite.frames : Object.keys(sprite.frames));

function spriteSchemaOf(raw: unknown): z.ZodType<SpriteFile> {
  if (raw && typeof raw === 'object' && 'recolour' in raw) return RecolourSprite;
  if (raw && typeof raw === 'object' && 'png' in raw) return PngSprite;
  return PixelSprite;
}

export function parseSpriteFile(raw: unknown): SpriteFile {
  return spriteSchemaOf(raw).parse(raw);
}

const isKind = (kind: string): kind is SpriteKind => (SPRITE_KINDS as readonly string[]).includes(kind);

/** What a sprite of this id lacks for its kind: a size it may not be, or a frame the game asks for. */
export function spriteKindProblems(id: string, sprite: Sprite): string[] {
  const kind = id.split('/')[0] ?? '';
  if (!isKind(kind)) return [`"${kind}" is not a kind of sprite; use one of ${SPRITE_KINDS.join(', ')}`];
  const rule = SPRITE_RULES[kind];
  const problems: string[] = [];
  if (!rule.sizes.some(([width, height]) => sprite.width === width && sprite.height === height)) {
    problems.push(`${kind} sprites are ${rule.sizes.map(([width, height]) => `${width}×${height}`).join(' or ')}, not ${sprite.width}×${sprite.height}`);
  }
  const frames = frameNames(sprite);
  for (const frame of rule.frames) if (!frames.includes(frame)) problems.push(`${kind} sprites need a frame "${frame}"`);
  for (const animation of rule.animations) if (!sprite.animations?.[animation]) problems.push(`${kind} sprites need an animation "${animation}"`);
  return problems;
}

/** One sprite file. Recolours are checked against their base by `loadArt`. */
export function spriteFile(id: string): z.ZodType {
  return z.unknown().superRefine((raw, ctx) => {
    const kind = id.split('/')[0] ?? '';
    if (!isKind(kind)) {
      ctx.addIssue({ code: 'custom', message: `"${kind}" is not a kind of sprite; use one of ${SPRITE_KINDS.join(', ')}` });
      return;
    }
    const result = spriteSchemaOf(raw).safeParse(raw);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: issue.path.map((key) => (typeof key === 'number' ? key : String(key))) });
      return;
    }
    if (!('recolour' in result.data)) for (const message of spriteKindProblems(id, result.data)) ctx.addIssue({ code: 'custom', message });
  });
}

/** The tiles of one map tileset, in tile id order, `columns` to a row. A tile id is its position here. */
export const Tileset = z.strictObject({
  columns: z.number().int().min(1).max(16),
  tiles: z.array(SpriteId).min(1).max(256),
});
export type Tileset = z.infer<typeof Tileset>;

export function artSchemaFor(fileName: string): z.ZodType | undefined {
  if (TILESET_FILE.test(fileName)) return Tileset;
  const sprite = SPRITE_FILE.exec(fileName);
  return sprite?.[1] && sprite[2] ? spriteFile(`${sprite[1]}/${sprite[2]}`) : undefined;
}

export type Art = {
  readonly sprites: ReadonlyMap<string, Sprite>;
  readonly tilesets: ReadonlyMap<string, Tileset>;
};
export type ArtResult = Art & { readonly problems: readonly string[] };

function resolveRecolour(id: string, recolour: RecolourSprite, files: ReadonlyMap<string, SpriteFile>): Sprite | string {
  const base = files.get(recolour.recolour);
  if (!base) return `${id} recolours ${recolour.recolour}, which does not exist`;
  if ('recolour' in base || isPngSprite(base)) return `${id} recolours ${recolour.recolour}, which is not drawn in its file`;
  const unknown = Object.keys(recolour.palette).filter((key) => !Object.hasOwn(base.palette, key));
  if (unknown.length) return `${id} recolours ${unknown.map((key) => `"${key}"`).join(', ')}, not in the palette of ${recolour.recolour}`;
  return { ...base, palette: { ...base.palette, ...recolour.palette } };
}

/**
 * Reads every art file, keyed by its name under `content/` (such as `art/tiles/grass.json`), into
 * the sprites the game draws and the tilesets maps use. Problems name the file they are in.
 */
export function loadArt(entries: Readonly<Record<string, unknown>>): ArtResult {
  const problems: string[] = [];
  const files = new Map<string, SpriteFile>();
  const tilesets = new Map<string, Tileset>();
  for (const [file, raw] of Object.entries(entries).toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    const tileset = TILESET_FILE.exec(file);
    const sprite = SPRITE_FILE.exec(file);
    const schema = artSchemaFor(file);
    const checked = schema?.safeParse(raw);
    if (!schema || !checked) problems.push(`content/${file}: not an art file`);
    else if (!checked.success) problems.push(...checked.error.issues.map((issue) => `content/${file}: ${issue.message}`));
    else if (tileset?.[1]) tilesets.set(tileset[1], Tileset.parse(raw));
    else if (sprite?.[1] && sprite[2]) files.set(`${sprite[1]}/${sprite[2]}`, parseSpriteFile(raw));
  }
  const sprites = new Map<string, Sprite>();
  for (const [id, file] of files) {
    if (!('recolour' in file)) {
      sprites.set(id, file);
      continue;
    }
    const resolved = resolveRecolour(id, file, files);
    if (typeof resolved === 'string') {
      problems.push(`content/art/${id}.json: ${resolved}`);
      continue;
    }
    const kindProblems = spriteKindProblems(id, resolved);
    if (kindProblems.length) problems.push(...kindProblems.map((problem) => `content/art/${id}.json: ${problem}`));
    else sprites.set(id, resolved);
  }
  for (const [name, tileset] of tilesets) {
    tileset.tiles.forEach((id, at) => {
      if (!id.startsWith('tiles/')) problems.push(`content/art/tilesets/${name}.json: tile ${at} is ${id}, which is not a tiles/ sprite`);
      else if (!files.has(id)) problems.push(`content/art/tilesets/${name}.json: tile ${at} is ${id}, which does not exist`);
    });
  }
  return { sprites, tilesets, problems };
}

/** Everything in `content/` that names art, by id. */
export type ArtUsers = {
  readonly avatars: readonly string[];
  readonly species: readonly string[];
  readonly weather: readonly string[];
  readonly items: readonly string[];
  /** Tileset names, the map tileset image without `.png`. */
  readonly tilesets: readonly string[];
};

/** Every sprite or tileset that some content needs and the art lacks. */
export function missingArt(art: Art, users: ArtUsers): string[] {
  const needs: [string, string][] = [
    ['the game, for avatars without a courier of their own,', DEFAULT_COURIER],
    ...users.avatars.map((id): [string, string] => [`avatar "${id}"`, spriteFor.avatar(id)]),
    ...users.species.flatMap((id): [string, string][] => [
      [`species "${id}"`, spriteFor.species(id)],
      [`species "${id}"`, spriteFor.speciesIcon(id)],
    ]),
    ...users.weather.map((id): [string, string] => [`weather "${id}"`, spriteFor.weather(id)]),
    ...users.items.map((id): [string, string] => [`item "${id}"`, spriteFor.item(id)]),
  ];
  return [
    ...needs.flatMap(([who, id]) => (art.sprites.has(id) ? [] : [`${who} needs the sprite ${id} (content/art/${id}.json)`])),
    ...users.tilesets.flatMap((name) => (art.tilesets.has(name) ? [] : [`tileset "${name}" needs content/art/tilesets/${name}.json`])),
  ];
}

/** A drawn frame's pixel as 0xrrggbb, or null where it is transparent. */
export function pixelColour(sprite: PixelSprite, frame: string, x: number, y: number): number | null {
  const key = sprite.frames[frame]?.[y]?.[x];
  const colour = key === undefined ? undefined : sprite.palette[key];
  return colour === undefined ? null : Number.parseInt(colour.slice(1), 16);
}

/** Which frame of an animation shows `ms` after it started; it loops. */
export function animationFrameAt(animation: SpriteAnimation, ms: number): string {
  const total = animation.ms.reduce((sum, each) => sum + each, 0);
  let left = ((ms % total) + total) % total;
  for (const [at, each] of animation.ms.entries()) {
    if (left < each) return animation.frames[at] ?? animation.frames[0] ?? '';
    left -= each;
  }
  return animation.frames[0] ?? '';
}
