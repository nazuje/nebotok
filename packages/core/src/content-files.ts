import { z } from 'zod';
import { artSchemaFor } from './art.ts';
import {
  AvatarsFile,
  BattleRules,
  BefriendRules,
  EncountersFile,
  ItemsFile,
  MovesFile,
  RenamedFile,
  ShrinesFile,
  SpeciesFile,
  StartersFile,
  StringsFile,
  WeatherFile,
  WorldSettings,
} from './content.ts';
import { playabilityProblems, readTiledMap } from './map.ts';
import { DIALOGUE_FILE, InventoryFile, NpcsFile, QuestsFile, StoryFile, dialogueFile } from './story-content.ts';

/** Each file in `content/` and the schema it must match. A file not listed here is an error. */
export const CONTENT_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'strings.json': StringsFile,
  'world.json': WorldSettings,
  'avatars.json': AvatarsFile,
  'items.json': ItemsFile,
  'inventory.json': InventoryFile,
  'encounters.json': EncountersFile,
  'shrines.json': ShrinesFile,
  'starters.json': StartersFile,
  'npcs.json': NpcsFile,
  'quests.json': QuestsFile,
  'story.json': StoryFile,
  'creatures/weather.json': WeatherFile,
  'creatures/moves.json': MovesFile,
  'creatures/species.json': SpeciesFile,
  'creatures/battle-rules.json': BattleRules,
  'creatures/befriending.json': BefriendRules,
  'creatures/renamed.json': RenamedFile,
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
  if (map?.[1]) return tiledMapFile(map[1]);
  const dialogue = DIALOGUE_FILE.exec(fileName);
  if (dialogue?.[1]) return dialogueFile(dialogue[1]);
  // Art: sprites and tilesets in content/art/, whose schemas live in art.ts.
  return artSchemaFor(fileName);
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
