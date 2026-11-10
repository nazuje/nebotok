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
    toast: z.enum(['blocked', 'hidden']).optional(),
    hint: z.enum(['tap', 'joystick', 'hidden']).optional(),
    battle: z.enum(['menu', 'none']).optional(),
    sameBattle: z.literal(true).optional(),
    battling: z.array(Id).min(1).optional(),
    calm: z.array(Id).min(1).optional(),
    talking: z.array(Id).min(1).optional(),
    quiet: z.array(Id).min(1).optional(),
    talk: z.enum(['open', 'none']).optional(),
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
]);

/** Every player a step names, so a typo is caught before any browser starts. */
const named = (entry) =>
  [entry.player, ...(entry.until?.sees ?? []), ...(entry.until?.away ?? []), ...Object.keys(entry.until?.seesAt ?? {}), ...(entry.until?.battling ?? []), ...(entry.until?.calm ?? []), ...(entry.until?.talking ?? []), ...(entry.until?.quiet ?? [])].filter(Boolean);

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
