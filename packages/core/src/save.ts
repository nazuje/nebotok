import { z } from 'zod';
import { ContentId, LanguageSchema } from './content.ts';
import { DirectionSchema } from './grid.ts';
import { MapId } from './map.ts';

/** The version `createSave` writes. Raise it only together with a migration from the version before. */
export const SAVE_VERSION = 4;

/** How many creatures a player's storage holds, besides the team of up to 6. */
export const STORAGE_LIMIT = 200;
export const NICKNAME_MAX = 16;

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

const uniqueIds = (ids: readonly string[]) => new Set(ids).size === ids.length;

/**
 * One creature a player owns, as v3 saves it. `hp` is its health now (0 when fainted); `xp` is the
 * experience gained since it reached `level`; `moves` are the one to four it knows, in slot order.
 */
const CreatureV3 = z.strictObject({
  species: ContentId,
  level: z.number().int().min(1).max(100),
  xp: z.number().int().min(0).max(10_000_000),
  hp: z.number().int().min(0).max(1_023),
  moves: z.array(ContentId).min(1).max(4).refine(uniqueIds, 'a creature knows each move once'),
  nickname: z.string().trim().min(1).max(NICKNAME_MAX).optional(),
});

/**
 * v3 adds creatures, treats and shrines. `team` is the up to 6 creatures that battle, in order;
 * `storage` the rest. Both empty means the player has not chosen a starter yet. `inventory` holds
 * each item id once, with how many. `lastShrine` is where they wake after their team faints (null:
 * the map's player spawn). `seen` and `befriended` are species ids, each once.
 */
const SaveDataV3 = z.strictObject({
  name: z.string().trim().min(1).max(40),
  language: LanguageSchema,
  createdAt: z.iso.datetime(),
  position: z.strictObject({ map: MapId, x: Tile, y: Tile, facing: DirectionSchema }).nullable(),
  team: z.array(CreatureV3).max(6),
  storage: z.array(CreatureV3).max(STORAGE_LIMIT),
  inventory: z
    .array(z.strictObject({ item: ContentId, count: z.number().int().min(1).max(999) }))
    .max(500)
    .refine((entries) => uniqueIds(entries.map((entry) => entry.item)), 'each item appears once'),
  lastShrine: z.strictObject({ map: MapId, shrine: ContentId }).nullable(),
  seen: z.array(ContentId).max(1_000).refine(uniqueIds, 'each species appears once'),
  befriended: z.array(ContentId).max(1_000).refine(uniqueIds, 'each species appears once'),
});

/** Quests a player can have going at once, and how many quest ids and story flags a save keeps. */
export const MAX_ACTIVE_QUESTS = 50;
export const MAX_STORY_IDS = 1_000;

/**
 * One quest a player is doing, as v4 saves it: `step` is the index of the current step in the
 * quest's `steps`, and `count` the progress on it (battles won, creatures befriended) since it began.
 */
const QuestProgressV4 = z.strictObject({
  quest: ContentId,
  step: z.number().int().min(0).max(49),
  count: z.number().int().min(0).max(999),
});

/** A player's story: the quests going on, the quests done and the story flags set. Each id once. */
const StoryV4 = z
  .strictObject({
    active: z
      .array(QuestProgressV4)
      .max(MAX_ACTIVE_QUESTS)
      .refine((entries) => uniqueIds(entries.map((entry) => entry.quest)), 'each quest appears once'),
    done: z.array(ContentId).max(MAX_STORY_IDS).refine(uniqueIds, 'each quest appears once'),
    flags: z.array(ContentId).max(MAX_STORY_IDS).refine(uniqueIds, 'each flag appears once'),
  })
  .refine((story) => story.active.every((entry) => !story.done.includes(entry.quest)), 'a quest is active or done, not both');

/**
 * v4 adds the story. Ids the content no longer has stay in the save until `pruneStory` drops them
 * when it is loaded; a later version may reset the placeholder story and keep everything else.
 */
const SaveDataV4 = z.strictObject({ ...SaveDataV3.shape, story: StoryV4 });

export const CreatureInstance = CreatureV3;
export type CreatureInstance = z.infer<typeof CreatureInstance>;
export const StoryProgress = StoryV4;
export type StoryProgress = z.infer<typeof StoryProgress>;
export type QuestProgress = StoryProgress['active'][number];
export const SaveData = SaveDataV4;
export type SaveData = z.infer<typeof SaveData>;
export type SaveFile = { readonly v: typeof SAVE_VERSION; readonly data: SaveData };

/** How the data of each version looked, so an old save is checked before it is upgraded. */
export const SAVE_SCHEMAS: Readonly<Record<number, z.ZodType>> = {
  1: SaveDataV1,
  2: SaveDataV2,
  3: SaveDataV3,
  4: SaveDataV4,
};

export type Migration = (data: unknown) => unknown;

/** `migrations[n]` turns version n data into version n + 1 data. */
export const migrations: Readonly<Record<number, Migration>> = {
  // A v1 player has never been placed on a map, so they start at the spawn.
  1: (data) => ({ ...(data as z.infer<typeof SaveDataV1>), position: null }),
  // A v2 player has no creatures yet: like a new player, they choose a starter and get its treats.
  2: (data) => ({ ...(data as z.infer<typeof SaveDataV2>), team: [], storage: [], inventory: [], lastShrine: null, seen: [], befriended: [] }),
  // A v3 player has started no quest yet; their creatures, items and shrine stay as they are.
  3: (data) => ({ ...(data as z.infer<typeof SaveDataV3>), story: { active: [], done: [], flags: [] } }),
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
