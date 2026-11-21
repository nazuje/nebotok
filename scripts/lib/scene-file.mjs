// The shape of a scene file for `npm run scene` (scripts/scene.mjs). scripts/scenes/README.md
// explains each field to the people and agents who write them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { DIRECTIONS, LanguageSchema, Pin, ProfileName } from '../../packages/core/src/index.ts';
import { BROWSERS, DEVICES } from './game-page.mjs';
import { ROOT } from './server-process.mjs';

const AVATARS = JSON.parse(readFileSync(join(ROOT, 'content/avatars.json'), 'utf8')).avatars.map((avatar) => avatar.id);
const NPCS = JSON.parse(readFileSync(join(ROOT, 'content/npcs.json'), 'utf8')).npcs.map((npc) => npc.id);
const SPOTS = JSON.parse(readFileSync(join(ROOT, 'content/spots.json'), 'utf8')).spots.map((spot) => spot.id);
const SPECIES = JSON.parse(readFileSync(join(ROOT, 'content/creatures/species.json'), 'utf8')).species.map((species) => species.id);

const Id = z.string().regex(/^[a-z][a-z0-9-]{0,15}$/, 'a lower-case id such as "lan"');
const Label = z.string().regex(/^[a-z0-9-]{1,40}$/, 'lower-case letters, digits and dashes');
const Tile = z.strictObject({ x: z.number().int().min(0), y: z.number().int().min(0) });
const Ms = z.number().int().min(0).max(60_000);

const Player = z.strictObject({
  id: Id,
  name: ProfileName,
  avatar: z.enum(AVATARS).default(AVATARS[0]),
  pin: Pin.optional(),
  browser: z.enum(BROWSERS.map((browser) => browser.name)).default(BROWSERS[0].name),
  device: z.enum(DEVICES.map((device) => device.name)).default(DEVICES[0].name),
  language: LanguageSchema.default('en'),
  /** The device asks for reduced motion. */
  reducedMotion: z.literal(true).optional(),
  /**
   * Starts the player standing on a tile, part way through the story at a quest's step
   * (scripts/lib/story-saves.mjs), with this team instead of the one the story gave, or both.
   */
  prepared: z
    .strictObject({
      quest: z.string().min(1).optional(),
      step: z.string().min(1).optional(),
      at: Tile,
      team: z.array(z.strictObject({ species: z.enum(SPECIES), level: z.number().int().min(1).max(100) })).min(1).max(6).optional(),
    })
    .refine((prepared) => (prepared.quest === undefined) === (prepared.step === undefined), 'a quest and its step go together')
    .refine((prepared) => prepared.quest !== undefined || prepared.team !== undefined, 'say a quest and step, a team, or both')
    .optional(),
});

const Until = z
  .strictObject({
    connection: z.enum(['connecting', 'connected', 'unreachable', 'signedOut', 'replaced', 'outdated']).optional(),
    settled: z.literal(true).optional(),
    at: Tile.optional(),
    sees: z.array(Id).min(1).optional(),
    away: z.array(Id).min(1).optional(),
    seesAt: z.record(Id, Tile).optional(),
    tagsApart: z.literal(true).optional(),
    unmarked: z.literal(true).optional(),
    welcome: z.array(z.enum(['alone', 'together', 'hidden'])).min(1).optional(),
    refused: z.literal(true).optional(),
    toast: z.union([z.literal('hidden'), z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/, 'a string id such as "duel.no"')]).optional(),
    hint: z.enum(['tap', 'joystick', 'hidden']).optional(),
    battle: z.enum(['menu', 'none']).optional(),
    sameBattle: z.literal(true).optional(),
    battling: z.array(Id).min(1).optional(),
    calm: z.array(Id).min(1).optional(),
    talking: z.array(Id).min(1).optional(),
    quiet: z.array(Id).min(1).optional(),
    skilling: z.array(Id).min(1).optional(),
    idle: z.array(Id).min(1).optional(),
    spots: z.partialRecord(z.enum(SPOTS), z.enum(['ready', 'resting'])).optional(),
    game: z.enum(['open', 'none']).optional(),
    talk: z.enum(['open', 'none']).optional(),
    cue: z.enum(['playing', 'none']).optional(),
    cues: z.number().int().min(0).max(100).optional(),
    band: z.enum(['shown', 'hidden']).optional(),
    flags: z.array(z.string().min(1)).min(1).optional(),
    lacksFlags: z.array(z.string().min(1)).min(1).optional(),
    duel: z.enum(['menu', 'watch', 'asking', 'asked', 'none']).optional(),
    arena: z.enum(['rounds', 'watching', 'none']).optional(),
    arenaPhase: z.enum(['picking', 'fighting', 'between', 'ended']).optional(),
    paused: z.boolean().optional(),
    duelling: z.array(Id).min(1).optional(),
    watching: z.array(Id).min(1).optional(),
    trophy: z.array(Id).min(1).optional(),
  })
  .refine((until) => Object.keys(until).length > 0, 'say what to wait for');

const step = (name, fields) => z.strictObject({ do: z.literal(name), shot: Label.optional(), ...fields });
const Step = z.discriminatedUnion('do', [
  step('join', { player: Id }),
  step('walk', { player: Id, to: Tile }),
  step('tap', { player: Id, tile: Tile }),
  step('hold', { player: Id, direction: z.enum(DIRECTIONS), ms: Ms }),
  step('wait', { ms: Ms }),
  step('waitFor', { player: Id, until: Until, ms: Ms.default(15_000) }),
  step('reload', { player: Id }),
  step('drop', { player: Id, ms: Ms }),
  step('meet', { player: Id }),
  step('fight', { player: Id, slot: z.number().int().min(0).max(3).default(0) }),
  step('run', { player: Id }),
  step('talk', { player: Id, npc: z.enum(NPCS), open: z.literal(true).optional() }),
  step('play', { player: Id, miss: z.literal(true).optional() }),
  step('ask', { player: Id, to: Id, even: z.boolean().default(true) }),
  step('answer', { player: Id, yes: z.boolean() }),
  step('watch', { player: Id, who: Id }),
  step('pick', { player: Id }),
  step('giveUp', { player: Id }),
  step('continue', { player: Id }),
]);

/** Every player a step names, so a typo is caught before any browser starts. */
const named = (entry) =>
  [entry.player, ...(entry.do === 'ask' ? [entry.to] : []), ...(entry.do === 'watch' ? [entry.who] : []), ...(entry.until?.duelling ?? []), ...(entry.until?.watching ?? []), ...(entry.until?.trophy ?? []), ...(entry.until?.sees ?? []), ...(entry.until?.away ?? []), ...Object.keys(entry.until?.seesAt ?? {}), ...(entry.until?.battling ?? []), ...(entry.until?.calm ?? []), ...(entry.until?.talking ?? []), ...(entry.until?.quiet ?? []), ...(entry.until?.skilling ?? []), ...(entry.until?.idle ?? [])].filter(Boolean);

export const Scene = z
  .strictObject({ name: Label, about: z.string().min(1), players: z.array(Player).min(1).max(6), steps: z.array(Step).min(1) })
  .superRefine((scene, context) => {
    const ids = scene.players.map((player) => player.id);
    if (new Set(ids).size !== ids.length) context.addIssue({ code: 'custom', path: ['players'], message: 'two players share an id' });
    if (new Set(scene.players.map((player) => player.name)).size !== ids.length) context.addIssue({ code: 'custom', path: ['players'], message: 'two players share a name' });
    const joined = new Set();
    scene.steps.forEach((entry, index) => {
      for (const id of named(entry)) if (!ids.includes(id)) context.addIssue({ code: 'custom', path: ['steps', index], message: `no player "${id}"` });
      if (entry.do === 'join' && joined.has(entry.player)) context.addIssue({ code: 'custom', path: ['steps', index], message: `"${entry.player}" has already joined` });
      if (entry.do !== 'join' && entry.player && !joined.has(entry.player)) context.addIssue({ code: 'custom', path: ['steps', index], message: `"${entry.player}" has not joined yet` });
      if (entry.do === 'join') joined.add(entry.player);
    });
  });

/** A scene file's text read as a scene, or the problems with it in plain words. */
export function parseScene(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { ok: false, problems: `not JSON: ${error.message}` };
  }
  const parsed = Scene.safeParse(json);
  return parsed.success ? { ok: true, scene: parsed.data } : { ok: false, problems: z.prettifyError(parsed.error) };
}
