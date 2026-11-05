import { z } from 'zod';
import { MapId, playabilityProblems, readTiledMap } from './map.ts';
import { WELCOME_MESSAGE_KEYS } from './protocol.ts';

export const LANGUAGES = ['en', 'sl'] as const;
export type Language = (typeof LANGUAGES)[number];
export const LanguageSchema = z.enum(LANGUAGES);

const Text = z.string().trim().min(1);

export const LocalizedText = z.strictObject({ en: Text, sl: Text });
export type LocalizedText = z.infer<typeof LocalizedText>;

/** Dotted lower-camel ids, such as `connection.unreachable`. */
const StringId = z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'ids look like "area.name"');

/** Every id the client or the rules ask for, so a missing line fails validation, not a player's screen. */
export const REQUIRED_STRING_IDS = [
  'game.title',
  'connection.connecting',
  'connection.connected',
  'connection.unreachable',
  'connection.reconnecting',
  'connection.replaced',
  'connection.signedOut',
  'connection.outdated',
  'language.en',
  'language.sl',
  'language.switch',
  'profile.title',
  'profile.new',
  'profile.name',
  'profile.nameHint',
  'profile.avatar',
  'profile.pin',
  'profile.pinHint',
  'profile.pinPrompt',
  'profile.create',
  'profile.play',
  'profile.back',
  'profile.switch',
  'profile.locked',
  'profile.empty',
  'profile.hasPin',
  'profile.pinChoose',
  'profile.pinSet',
  'profile.pinRemove',
  'profile.pinDelete',
  'profile.retry',
  'profile.time.minute',
  'profile.time.minutes.one',
  'profile.time.minutes.two',
  'profile.time.minutes.few',
  'profile.time.minutes.other',
  'profile.time.about',
  'profile.time.hour',
  'profile.pinNudge',
  'profile.takenOver',
  'profile.pinAgain',
  'profile.pinMismatch',
  'profile.pinAdded',
  'profile.done',
  'settings.open',
  'settings.close',
  'settings.language',
  'settings.controls',
  'settings.controls.tap',
  'settings.controls.joystick',
  'settings.addPin',
  'profile.error.nameInvalid',
  'profile.error.nameTaken',
  'profile.error.pinInvalid',
  'profile.error.pinWrong',
  'profile.error.locked',
  'profile.error.full',
  'profile.error.busy',
  'profile.error.signedOut',
  'profile.error.hasPin',
  'profile.error.unknown',
  'walk.blocked',
  ...WELCOME_MESSAGE_KEYS,
] as const;
export type StringId = (typeof REQUIRED_STRING_IDS)[number];

export const StringsFile = z.record(StringId, LocalizedText).superRefine((strings, ctx) => {
  for (const id of REQUIRED_STRING_IDS) {
    if (!(id in strings)) ctx.addIssue({ code: 'custom', message: `missing string "${id}"`, path: [id] });
  }
});
export type Strings = Readonly<Record<StringId, LocalizedText>> & Readonly<Record<string, LocalizedText>>;

export function parseStrings(raw: unknown): Strings {
  return StringsFile.parse(raw) as Strings;
}

/** Settings for the whole world: where players start and how fast everyone walks. */
export const WorldSettings = z.strictObject({
  startMap: MapId,
  walkTilesPerSecond: z.number().int().min(1).max(12),
});
export type WorldSettings = z.infer<typeof WorldSettings>;

const AvatarId = z.string().regex(/^[a-z][a-z0-9-]{0,19}$/, 'avatar ids are short lowercase words');
export const Avatar = z.strictObject({
  id: AvatarId,
  name: LocalizedText,
  /** The placeholder colour the client tints the courier with, until real art arrives. */
  color: z.string().regex(/^#[0-9a-f]{6}$/, 'colours look like #3a7bd5'),
});
export type Avatar = z.infer<typeof Avatar>;

export const AvatarsFile = z
  .strictObject({ avatars: z.array(Avatar).min(2).max(16) })
  .superRefine(({ avatars }, ctx) => {
    const ids = avatars.map((avatar) => avatar.id);
    ids.forEach((id, at) => {
      if (ids.indexOf(id) !== at) ctx.addIssue({ code: 'custom', message: `avatar "${id}" appears twice`, path: ['avatars', at, 'id'] });
    });
  });
export type AvatarsFile = z.infer<typeof AvatarsFile>;

/** Ids of creatures, moves and weather types: short lowercase words joined by dashes. */
export const ContentId = z.string().regex(/^[a-z][a-z0-9-]{0,23}$/, 'ids are short lowercase words, such as "sun-blob"');

function noRepeatedIds(entries: readonly { readonly id: string }[], key: string, ctx: z.RefinementCtx): void {
  const ids = entries.map((entry) => entry.id);
  ids.forEach((id, at) => {
    if (ids.indexOf(id) !== at) ctx.addIssue({ code: 'custom', message: `"${id}" appears twice`, path: [key, at, 'id'] });
  });
}

/**
 * One of the six weather types. A move of this type hits the types in `strongAgainst` harder and
 * the types in `weakAgainst` softer. While this weather is on the battlefield, moves of the types in
 * `field.boosts` grow stronger and moves of the types in `field.weakens` grow weaker.
 */
export const WeatherType = z.strictObject({
  id: ContentId,
  name: LocalizedText,
  strongAgainst: z.array(ContentId).max(12),
  weakAgainst: z.array(ContentId).max(12),
  field: z.strictObject({ boosts: z.array(ContentId).max(12), weakens: z.array(ContentId).max(12) }),
});
export type WeatherType = z.infer<typeof WeatherType>;

export const WeatherFile = z
  .strictObject({ types: z.array(WeatherType).min(1).max(12) })
  .superRefine(({ types }, ctx) => {
    noRepeatedIds(types, 'types', ctx);
    const known = new Set(types.map((type) => type.id));
    types.forEach((type, at) => {
      const lists = { strongAgainst: type.strongAgainst, weakAgainst: type.weakAgainst, 'field.boosts': type.field.boosts, 'field.weakens': type.field.weakens };
      for (const [list, ids] of Object.entries(lists)) {
        for (const id of ids) {
          if (!known.has(id)) ctx.addIssue({ code: 'custom', message: `${list} names "${id}", which is not a weather type`, path: ['types', at, ...list.split('.')] });
        }
      }
      for (const id of type.strongAgainst) {
        if (type.weakAgainst.includes(id)) ctx.addIssue({ code: 'custom', message: `"${type.id}" is both strong and weak against "${id}"`, path: ['types', at] });
      }
      for (const id of type.field.boosts) {
        if (type.field.weakens.includes(id)) ctx.addIssue({ code: 'custom', message: `"${type.id}" weather both boosts and weakens "${id}"`, path: ['types', at, 'field'] });
      }
    });
  });
export type WeatherFile = z.infer<typeof WeatherFile>;

/** A move with `power` 0 only changes the weather, so it must name the weather it calls. */
export const Move = z
  .strictObject({
    id: ContentId,
    name: LocalizedText,
    type: ContentId,
    power: z.number().int().min(0).max(200),
    /** The chance to hit, in percent. */
    accuracy: z.number().int().min(1).max(100),
    setsWeather: ContentId.optional(),
  })
  .refine((move) => move.power > 0 || move.setsWeather !== undefined, 'a move needs power, setsWeather or both');
export type Move = z.infer<typeof Move>;

export const MovesFile = z.strictObject({ moves: z.array(Move).min(1).max(1_000) }).superRefine(({ moves }, ctx) => noRepeatedIds(moves, 'moves', ctx));
export type MovesFile = z.infer<typeof MovesFile>;

const BaseStat = z.number().int().min(1).max(255);

export const Species = z
  .strictObject({
    id: ContentId,
    name: LocalizedText,
    type: ContentId,
    stats: z.strictObject({ hp: BaseStat, attack: BaseStat, defense: BaseStat, speed: BaseStat }),
    /** Every creature knows exactly four moves. */
    moves: z.array(ContentId).length(4),
  })
  .refine((species) => new Set(species.moves).size === species.moves.length, 'a creature knows each move once');
export type Species = z.infer<typeof Species>;

export const SpeciesFile = z.strictObject({ species: z.array(Species).min(1).max(1_000) }).superRefine(({ species }, ctx) => noRepeatedIds(species, 'species', ctx));
export type SpeciesFile = z.infer<typeof SpeciesFile>;

/** Numbers that tune every battle. Percentages multiply damage; 100 changes nothing. */
export const BattleRules = z.strictObject({
  /** After this many turns the battle ends, and the side with more health left wins. */
  turnLimit: z.number().int().min(10).max(500),
  /** How many turns weather called by a move lasts, counting the turn it was called. */
  weatherTurns: z.number().int().min(1).max(20),
  strongPercent: z.number().int().min(100).max(400),
  weakPercent: z.number().int().min(10).max(100),
  boostPercent: z.number().int().min(100).max(300),
  weakenPercent: z.number().int().min(10).max(100),
  /** A move of the creature's own type. */
  sameTypePercent: z.number().int().min(100).max(200),
  /** Each hit rolls a damage percentage from this up to 100. */
  minRollPercent: z.number().int().min(50).max(100),
});
export type BattleRules = z.infer<typeof BattleRules>;

/** Each file in `content/` and the schema it must match. A file not listed here is an error. */
export const CONTENT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'strings.json': StringsFile,
  'world.json': WorldSettings,
  'avatars.json': AvatarsFile,
  'creatures/weather.json': WeatherFile,
  'creatures/moves.json': MovesFile,
  'creatures/species.json': SpeciesFile,
  'creatures/battle-rules.json': BattleRules,
};

/** Maps are `content/maps/<id>.tmj`, Tiled's JSON format; see content/AGENTS.md. */
export const MAP_FILE = /^maps\/([a-z][a-z0-9-]*)\.tmj$/;

/** A map file must convert into a rules map and be playable: spawn walkable, every walkable tile reachable. */
export function tiledMapFile(id: string): z.ZodType {
  return z.unknown().superRefine((raw, ctx) => {
    const result = readTiledMap(id, raw);
    const problems = result.ok ? playabilityProblems(result.map) : result.problems;
    for (const message of problems) ctx.addIssue({ code: 'custom', message });
  });
}

export function contentSchemaFor(fileName: string): z.ZodType | undefined {
  const exact = CONTENT_SCHEMAS[fileName];
  if (exact) return exact;
  const map = MAP_FILE.exec(fileName);
  return map?.[1] ? tiledMapFile(map[1]) : undefined;
}

export type ContentCheck = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

export function checkContentFile(fileName: string, raw: unknown): ContentCheck {
  const schema = contentSchemaFor(fileName);
  if (!schema) return { ok: false, problems: [`no schema for content file "${fileName}"; add one to CONTENT_SCHEMAS`] };
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true };
  return {
    ok: false,
    problems: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}
