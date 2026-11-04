import { z } from 'zod';
import { LanguageSchema } from './content.ts';
import { DirectionSchema } from './grid.ts';
import { MapId } from './map.ts';

/** The version `createSave` writes. Raise it only together with a migration from the version before. */
export const SAVE_VERSION = 2;

const SaveDataV1 = z.strictObject({
  name: z.string().trim().min(1).max(40),
  language: LanguageSchema,
  createdAt: z.iso.datetime(),
});

const Tile = z.number().int().min(0).max(1_023);

/** v2 adds where the player stood when they left. null means they have not been placed yet. */
const SaveDataV2 = z.strictObject({
  name: z.string().trim().min(1).max(40),
  language: LanguageSchema,
  createdAt: z.iso.datetime(),
  position: z.strictObject({ map: MapId, x: Tile, y: Tile, facing: DirectionSchema }).nullable(),
});

export const SaveData = SaveDataV2;
export type SaveData = z.infer<typeof SaveData>;
export type SaveFile = { readonly v: typeof SAVE_VERSION; readonly data: SaveData };

/** How the data of each version looked, so an old save is checked before it is upgraded. */
export const SAVE_SCHEMAS: Readonly<Record<number, z.ZodType>> = {
  1: SaveDataV1,
  2: SaveDataV2,
};

export type Migration = (data: unknown) => unknown;

/** `migrations[n]` turns version n data into version n + 1 data. */
export const migrations: Readonly<Record<number, Migration>> = {
  // A v1 player has never been placed on a map, so they start at the spawn.
  1: (data) => ({ ...(data as z.infer<typeof SaveDataV1>), position: null }),
};

const Envelope = z.object({ v: z.number().int().min(1), data: z.unknown() });

export class SaveError extends Error {
  override name = 'SaveError';
}

export function createSave(data: SaveData): SaveFile {
  return { v: SAVE_VERSION, data: SaveData.parse(data) };
}

export function migrateSave(raw: unknown): SaveFile {
  const envelope = Envelope.safeParse(raw);
  if (!envelope.success) throw new SaveError(`not a save file: ${envelope.error.issues[0]?.message ?? 'bad shape'}`);
  const { v } = envelope.data;
  if (v > SAVE_VERSION) throw new SaveError(`save version ${v} is newer than this game (${SAVE_VERSION})`);

  const own = SAVE_SCHEMAS[v];
  if (!own) throw new SaveError(`no schema for save version ${v}`);
  const checked = own.safeParse(envelope.data.data);
  if (!checked.success) throw new SaveError(`save version ${v} is damaged: ${checked.error.issues[0]?.message ?? 'bad data'}`);

  let data: unknown = checked.data;
  for (let from = v; from < SAVE_VERSION; from += 1) {
    const step = migrations[from];
    if (!step) throw new SaveError(`no migration from save version ${from}`);
    data = step(data);
  }
  return { v: SAVE_VERSION, data: SaveData.parse(data) };
}
