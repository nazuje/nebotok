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
  'profile.error.nameInvalid',
  'profile.error.nameTaken',
  'profile.error.pinInvalid',
  'profile.error.pinWrong',
  'profile.error.locked',
  'profile.error.full',
  'profile.error.busy',
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

/** Each file in `content/` and the schema it must match. A file not listed here is an error. */
export const CONTENT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'strings.json': StringsFile,
  'world.json': WorldSettings,
  'avatars.json': AvatarsFile,
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
