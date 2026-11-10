import { ColyseusTestServer } from '@colyseus/testing';
import type { Room } from '@colyseus/sdk';
import { DIRECTIONS, PROTOCOL_VERSION, createSave, emptyProgress, encounterZoneAt, isWalkable, loadStoryContent, shrineAt, stepFrom, type BattleContent, type Item, type Point, type Progress, type ProgressMessage, type StoryContent, type WorldMap } from '@nebotok/core';
import { createGameServer } from '../src/app.ts';
import { REQUESTS_PER_SECOND } from '../src/world-room.ts';
import type { WorldState } from '../src/world-state.ts';
import type { WorldContent } from '../src/world.ts';
import { capturedLog, freePort, tempServices, until } from './helpers.ts';

const text = (en: string) => ({ en, sl: en });
const say = (en: string) => ({ say: text(en) });
const offer = (quest: string) => ({ if: [{ quest, is: 'available' }], node: 'offer' });
const quest = (id: string, giver: string, steps: object[], rewards: object) => ({ id, chapter: 'test-chapter', giver, requires: [], name: text(id), summary: text(id), steps, rewards, effects: [] });

/** The one wild creature of every zone, and the treat it always takes. */
export const WILD = { species: 'drizzlesnail', level: 3 } as const;

/**
 * A small frozen story for room tests, so editing content/ never moves them. It uses the four
 * characters the map places: Bavko offers the starter and a delivery to Tobolko, Mehurka a walk to
 * the lookout (and a node whose effect cannot happen once it is done), and Vetrinka a round of a
 * rest, a won battle and a befriending.
 */
export function testStory(battle: BattleContent): StoryContent {
  const note: Item = { id: 'test-note', kind: 'quest', quest: 'test-delivery', name: text('Test note'), description: text('A note for tests.') };
  const items = [...[...battle.items.values()].filter((item) => item.kind === 'treat'), note];
  const files = {
    npcs: { npcs: ['bavko', 'tobolko', 'mehurka', 'vetrinka'].map((id) => ({ id, name: text(id), role: text('Tester'), voice: { pitch: 3, pace: 2 } })) },
    dialogue: {
      bavko: {
        npc: 'bavko',
        entries: [{ if: [{ needsStarter: true }], node: 'welcome' }, offer('test-delivery'), { node: 'idle' }],
        nodes: {
          welcome: { ...say('Welcome.'), next: 'starter' },
          starter: { ...say('Pick a creature.'), effects: [{ offerStarter: true }] },
          offer: { ...say('Take this note?'), choices: [{ ...say('Yes.'), next: 'accept' }, { ...say('Later.'), next: 'later' }] },
          accept: { ...say('Here it is.'), effects: [{ startQuest: 'test-delivery' }, { give: 'test-note', count: 1 }] },
          later: say('Later, then.'),
          idle: say('Hello.'),
        },
      },
      tobolko: {
        npc: 'tobolko',
        entries: [{ if: [{ quest: 'test-delivery', at: 'deliver' }, { has: 'test-note', count: 1 }], node: 'thanks' }, { node: 'idle' }],
        nodes: {
          thanks: { ...say('Thank you.'), effects: [{ take: 'test-note', count: 1 }, { completeStep: 'test-delivery', step: 'deliver' }], next: 'after' },
          after: say('Treats are in your bag.'),
          idle: say('Hello.'),
        },
      },
      mehurka: {
        npc: 'mehurka',
        entries: [offer('test-walk'), { if: [{ quest: 'test-walk', is: 'done' }], node: 'done' }, { node: 'idle' }],
        nodes: {
          offer: { ...say('Walk to the lookout.'), effects: [{ startQuest: 'test-walk' }] },
          done: { ...say('Again?'), next: 'again' },
          again: { ...say('Again!'), effects: [{ startQuest: 'test-walk' }] },
          idle: say('Hello.'),
        },
      },
      vetrinka: {
        npc: 'vetrinka',
        entries: [offer('test-rounds'), { node: 'idle' }],
        nodes: { offer: { ...say('Rest, win and befriend.'), effects: [{ startQuest: 'test-rounds' }] }, idle: say('Hello.') },
      },
    },
    quests: {
      quests: [
        quest('test-delivery', 'bavko', [{ id: 'deliver', kind: 'deliver', item: 'test-note', count: 1, to: 'tobolko', hint: text('Deliver.') }], { items: [{ item: 'plain-treat', count: 2 }], xp: 0 }),
        quest('test-walk', 'mehurka', [{ id: 'look', kind: 'reach', mark: 'lookout', hint: text('Look.') }], { items: [{ item: 'plain-treat', count: 1 }], xp: 1 }),
        quest(
          'test-rounds',
          'vetrinka',
          [
            { id: 'rest', kind: 'visitShrine', shrine: 'post-shrine', hint: text('Rest.') },
            { id: 'win', kind: 'winBattles', count: 1, zone: 'post-meadow', hint: text('Win.') },
            { id: 'friend', kind: 'befriend', count: 1, hint: text('Befriend.') },
          ],
          { items: [], xp: 0 },
        ),
      ],
    },
    story: { chapters: [{ id: 'test-chapter', name: text('Tests'), quests: ['test-delivery', 'test-walk', 'test-rounds'] }], flags: [] },
    inventory: { kinds: { quest: { stack: 1 }, treat: { stack: 99 }, material: { stack: 99 } }, order: ['quest', 'treat', 'material'] },
  };
  return loadStoryContent(files, { ...battle, items: new Map(items.map((item) => [item.id, item])) });
}

/** A tile next to `point` to talk or reach from: walkable, out of the grass and away from shrines. */
export function beside(map: WorldMap, point: Point): Point {
  const side = DIRECTIONS.map((direction) => stepFrom(point, direction)).find((tile) => isWalkable(map, tile) && encounterZoneAt(map, tile) === null && shrineAt(map, tile) === null);
  if (!side) throw new Error(`nothing walkable beside ${point.x},${point.y}`);
  return side;
}

type Heard = { readonly type: string; readonly payload: unknown };
export type Inbox = { readonly heard: Heard[]; take<T>(type: string): Promise<T>; has(type: string): boolean; types(): string[] };

/** Every message a room receives, in order; `take` waits for the first one of a type and removes it. */
export function inbox(room: Room<unknown, WorldState>): Inbox {
  const heard: Heard[] = [];
  room.onMessage('*', (type: string | number, payload: unknown) => heard.push({ type: String(type), payload }));
  const has = (type: string) => heard.some((message) => message.type === type);
  return {
    heard,
    has,
    types: () => heard.map((message) => message.type),
    async take<T>(type: string): Promise<T> {
      await until(() => has(type), `a ${type} message`, Date.now() + 5_000);
      const [message] = heard.splice(
        heard.findIndex((entry) => entry.type === type),
        1,
      );
      return message!.payload as T;
    },
  };
}

/** Requests are limited to REQUESTS_PER_SECOND, so tests pace theirs. */
export const PACE_MS = Math.ceil(1_000 / REQUESTS_PER_SECOND) + 20;
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Player = { id: number; room: Room<unknown, WorldState>; box: Inbox; progress: ProgressMessage };

/**
 * A real server whose world has the test story, wild creatures that appear at every step in the
 * grass and always take their favourite treat, and a clock tests can move on with `clock.offset`.
 */
export async function storyServer() {
  const clock = { offset: 0 };
  const logged = capturedLog('info');
  const temp = tempServices(() => Date.now() + clock.offset);
  const real = temp.services.world;
  const world: WorldContent = {
    ...real,
    story: testStory(real.battle),
    encounters: new Map(
      [...real.encounters].map(([id, zone]) => [id, { ...zone, encounterPercent: 100, creatures: [{ species: WILD.species, minLevel: WILD.level, maxLevel: WILD.level, weight: 1 }] }]),
    ),
    battle: {
      ...real.battle,
      befriending: { basePercent: 0, tiredPercent: 0, favouritePercent: 100, likedPercent: 0, levelPenaltyPer10Levels: 0, minPercent: 0, maxPercent: 100, windowPercent: 100 },
    },
  };
  const server = createGameServer(temp.config, logged.log, { ...temp.services, world });
  await server.listen(await freePort(), '127.0.0.1');
  const colyseus = new ColyseusTestServer(server);

  /** Joins a player saved at `at` with `progress`, after taking `welcome` and the first `progress`. */
  async function player(name: string, at: Point, progress: Partial<Progress> = {}): Promise<Player> {
    const made = await temp.services.profiles.create({ name, avatar: 'green' });
    if (!made.ok) throw new Error(made.error);
    const { id } = made.value;
    const position = { map: world.map.id, ...at, facing: 'left' as const };
    temp.services.progress.save(id, createSave({ name, language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position, ...emptyProgress(), ...progress }));
    const login = await temp.services.profiles.login({ profileId: id });
    if (!login.ok) throw new Error(login.error);
    colyseus.sdk.auth.token = login.value.token;
    const room = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
    room.reconnection.enabled = false;
    const box = inbox(room);
    await box.take('welcome');
    return { id, room, box, progress: await box.take<ProgressMessage>('progress') };
  }

  /** The saved data as stored, before the load repair (which would drop the test story's ids). */
  const stored = (id: number) => {
    const row = temp.services.db.prepare('SELECT data FROM player_progress WHERE player_id = ?').get(id) as { data: string } | undefined;
    return row ? (JSON.parse(row.data) as Progress) : undefined;
  };

  return {
    clock,
    logged,
    temp,
    world,
    colyseus,
    player,
    stored,
    async reset() {
      await colyseus.cleanup();
      temp.services.db.exec('DELETE FROM players');
      logged.lines.length = 0;
    },
    async close() {
      await colyseus.shutdown();
      temp.dispose();
    },
  };
}

/** Sends a request after the pace gap. */
export async function send(who: Player, type: string, payload: object) {
  await sleep(PACE_MS);
  who.room.send(type, payload);
}
