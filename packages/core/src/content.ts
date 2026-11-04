import { z } from 'zod';
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
  'language.en',
  'language.sl',
  'language.switch',
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

/** Each file in `content/` and the schema it must match. A file not listed here is an error. */
export const CONTENT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'strings.json': StringsFile,
};

export type ContentCheck = { readonly ok: true } | { readonly ok: false; readonly problems: readonly string[] };

export function checkContentFile(fileName: string, raw: unknown): ContentCheck {
  const schema = CONTENT_SCHEMAS[fileName];
  if (!schema) return { ok: false, problems: [`no schema for content file "${fileName}"; add one to CONTENT_SCHEMAS`] };
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true };
  return {
    ok: false,
    problems: result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  };
}
