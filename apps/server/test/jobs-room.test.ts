import { ColyseusTestServer } from '@colyseus/testing';
import {
  DIRECTIONS,
  PROTOCOL_VERSION,
  createSave,
  emptyProgress,
  newCreature,
  samePoint,
  stepFrom,
  type BoardJob,
  type CreatureInstance,
  type JobChanged,
  type JobsMessage,
  type JobsProgress,
  type Point,
  type Progress,
  type ProgressMessage,
  type QuestChanged,
  type Refused,
  type SkillsMessage,
  type StoryMessage,
  type StoryProgress,
  type TalkNode,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.ts';
import type { WorldContent } from '../src/world.ts';
import type { WorldState } from '../src/world-state.ts';
import { capturedLog, freePort, tempServices, until } from './helpers.ts';
import { beside, inbox, send, sleep, type Player } from './story-server.ts';

const logged = capturedLog('info');
let temp: ReturnType<typeof tempServices>;
let world: WorldContent;
let colyseus: ColyseusTestServer;

/** Where players stand in these tests: beside Tobolko, with the job board on another side of them. */
let stand: Point;

async function boot() {
  const server = createGameServer(temp.config, logged.log, { ...temp.services, world });
  await server.listen(await freePort(), '127.0.0.1');
  return new ColyseusTestServer(server);
}

beforeAll(async () => {
  temp = tempServices(undefined, logged.log);
  const real = temp.services.world;
  // The board moves next to the tile beside Tobolko, so one tile reaches both.
  stand = beside(real.map, real.map.npcs['tobolko']!);
  const board = DIRECTIONS.map((direction) => stepFrom(stand, direction)).find((tile) => !samePoint(tile, real.map.npcs['tobolko']!))!;
  world = { ...real, map: { ...real.map, stations: { ...real.map.stations, 'post-board': board } } };
  colyseus = await boot();
});
afterAll(async () => {
  await colyseus.shutdown();
  temp.dispose();
});
beforeEach(async () => {
  await colyseus.cleanup();
  temp.services.db.exec('DELETE FROM players');
  logged.lines.length = 0;
});

const MAIN_QUESTS = ['first-round', 'restless-grass', 'bell-for-the-shrine', 'a-new-friend', 'wind-readings', 'the-grey-letter'];
/** Every quest done, so each character's first entry that holds is a job entry or idle talk. */
const ALL_DONE: StoryProgress = { active: [], done: [...MAIN_QUESTS, 'treats-from-scratch'], flags: [] };
/** The side quest at its last step, finishing any job. */
const ONE_JOB_LEFT: StoryProgress = { active: [{ quest: 'treats-from-scratch', step: 3, count: 0 }], done: MAIN_QUESTS, flags: [] };

const strong = (): CreatureInstance => newCreature('glowbun', 20, world.battle);
const job = (number: number, template: string, item: string, count: number, to: string | null = null): BoardJob => ({ job: number, template, item, count, to, progress: 0 });
/** A board with a delivery of 3 cloudberries to Tobolko first. */
const deliveryBoard = (seed = 7): JobsProgress => ({
  seed,
  drawn: 3,
  done: 0,
  board: [job(1, 'berries-for-the-post', 'cloudberry', 3, 'tobolko'), job(2, 'berries-please', 'cloudberry', 4), job(3, 'bun-batch', 'berry-bun', 2)],
});

/** Joins a player saved at `at` with `progress`, after taking `welcome` and the first `progress`. */
async function player(name: string, progress: Partial<Progress> = {}, at: Point = stand): Promise<Player> {
  const made = await temp.services.profiles.create({ name, avatar: 'green' });
  if (!made.ok) throw new Error(made.error);
  const { id } = made.value;
  const position = { map: world.map.id, ...at, facing: 'left' as const };
  temp.services.progress.save(id, createSave({ name, language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position, ...emptyProgress(), team: [strong()], story: ALL_DONE, ...progress }));
  return join(id);
}

async function join(id: number): Promise<Player> {
  const login = await temp.services.profiles.login({ profileId: id });
  if (!login.ok) throw new Error(login.error);
  colyseus.sdk.auth.token = login.value.token;
  const room = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
  room.reconnection.enabled = false;
  const box = inbox(room);
  await box.take('welcome');
  return { id, room, box, progress: await box.take<ProgressMessage>('progress') };
}

/** The saved data as stored. */
const stored = (id: number) => {
  const row = temp.services.db.prepare('SELECT data FROM player_progress WHERE player_id = ?').get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Progress) : undefined;
};

async function openBoard(who: Player): Promise<JobsMessage> {
  await send(who, 'board.open', { station: 'post-board' });
  return who.box.take<JobsMessage>('jobs');
}

async function talk(who: Player, npc: string): Promise<TalkNode> {
  await send(who, 'talk.start', { npc });
  return who.box.take<TalkNode>('talk.node');
}

async function refused(who: Player, station: string): Promise<Refused['reason']> {
  await send(who, 'board.open', { station });
  return (await who.box.take<Refused>('refused')).reason;
}

describe('opening the board', () => {
  it('refuses a board away from it, a station that is no board, a player with no creature and one who is talking', async () => {
    const away = await player('Distant Courier', {}, beside(world.map, world.map.npcs['bavko']!));
    expect(await refused(away, 'post-board')).toBe('tooFar');
    expect(await refused(away, 'post-pot')).toBe('invalid');
    expect(await refused(away, 'nowhere')).toBe('invalid');

    const fresh = await player('Fresh Courier', { team: [] });
    expect(fresh.progress.needsStarter).toBe(true);
    expect(await refused(fresh, 'post-board')).toBe('notNow');

    const chatty = await player('Chatty Courier');
    await talk(chatty, 'tobolko');
    expect(await refused(chatty, 'post-board')).toBe('notNow');
    expect(chatty.box.has('jobs')).toBe(false);
    expect(stored(chatty.id)?.jobs).toBeNull();
  });

  it('draws three jobs on the first open, saves them at once, and shows the same board again and after a restart', async () => {
    const who = await player('Board Courier');
    expect(who.box.has('jobs')).toBe(false);
    const from = who.box.heard.length;
    const first = await openBoard(who);
    expect(who.box.types().slice(from)).toEqual(['progress']);
    expect(first.board.map((entry) => entry.job)).toEqual([1, 2, 3]);
    expect(new Set(first.board.map((entry) => entry.template)).size).toBe(3);
    for (const entry of first.board) expect(entry).toMatchObject({ progress: 0, kind: world.story.skills!.templates.get(entry.template)!.kind });
    const saved = stored(who.id)?.jobs;
    expect(saved).toMatchObject({ drawn: 3, done: 0, board: first.board.map(({ kind: _kind, ...entry }) => entry) });

    who.box.heard.length = 0;
    expect(await openBoard(who)).toEqual(first);
    expect(who.box.types()).toEqual([]);
    expect(stored(who.id)?.jobs).toEqual(saved);

    await who.room.leave();
    await colyseus.shutdown();
    colyseus = await boot();
    const back = await join(who.id);
    await until(() => back.box.has('jobs'), 'the board on joining');
    const types = back.box.types();
    expect(types.indexOf('story')).toBeLessThan(types.indexOf('skills'));
    expect(types.indexOf('skills')).toBeLessThan(types.indexOf('jobs'));
    expect(types.at(-1)).toBe('jobs');
    expect(await back.box.take<JobsMessage>('jobs')).toEqual(first);
  });

  it('gives two players boards of their own', async () => {
    const first = await player('First Courier');
    const second = await player('Second Courier');
    await openBoard(first);
    await sleep(100);
    expect(second.box.has('jobs')).toBe(false);
    await openBoard(second);
    expect(stored(first.id)?.jobs?.seed).not.toBe(stored(second.id)?.jobs?.seed);
  });

  it('repairs a save whose job template is gone, and refills the board on the next open', async () => {
    const jobs: JobsProgress = { seed: 11, drawn: 3, done: 1, board: [job(1, 'gone-template', 'cloudberry', 3), job(2, 'berries-please', 'cloudberry', 4), job(3, 'bun-batch', 'berry-bun', 2)] };
    const who = await player('Repaired Courier', { jobs });
    expect(logged.lines).toContainEqual(expect.objectContaining({ msg: 'save repaired', playerId: who.id, droppedJobs: ['gone-template'] }));
    expect((await who.box.take<JobsMessage>('jobs')).board.map((entry) => entry.job)).toEqual([2, 3]);
    const refilled = await openBoard(who);
    expect(refilled.board.map((entry) => entry.job)).toEqual([2, 3, 4]);
    expect(stored(who.id)?.jobs).toMatchObject({ seed: 11, drawn: 4, done: 1 });
  });
});

describe('deliveries', () => {
  it('delivers a job at its character, finishes the quest, draws the next job at once, all in order and saved', async () => {
    const who = await player('Delivering Courier', { story: ONE_JOB_LEFT, jobs: deliveryBoard(), inventory: [{ item: 'cloudberry', count: 3 }] });
    await who.box.take<StoryMessage>('story');
    await who.box.take<SkillsMessage>('skills');
    await who.box.take<JobsMessage>('jobs');
    const from = who.box.heard.length;
    await send(who, 'talk.start', { npc: 'tobolko' });
    await until(() => who.box.has('talk.node'), 'the talk to open');
    expect(who.box.types().slice(from)).toEqual(['job.changed', 'quest.changed', 'progress', 'skills', 'story', 'jobs', 'talk.node']);
    expect(await who.box.take<TalkNode>('talk.node')).toMatchObject({ npc: 'tobolko', node: 'job-thanks' });

    const changed = await who.box.take<JobChanged>('job.changed');
    expect(changed).toMatchObject({ job: 1, change: 'done', progress: 3, rewards: { items: [{ item: 'berry-bun', count: 1 }], extra: [], skills: [{ skill: 'foraging', xp: 24 }] } });
    expect(changed.next?.job).toBe(4);
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'treats-from-scratch', change: 'done', rewards: { items: [{ item: 'berry-bun', count: 2 }], skills: [{ skill: 'cooking', xp: 20 }] } });
    expect((await who.box.take<ProgressMessage>('progress')).inventory).toEqual([{ item: 'berry-bun', count: 3 }]);
    const skills = await who.box.take<SkillsMessage>('skills');
    expect(skills.skills.find((entry) => entry.skill === 'foraging')?.level).toBe(changed.rewards?.skills[0]?.level);
    expect(skills.skills.find((entry) => entry.skill === 'cooking')).toMatchObject({ level: 1, xp: 20 });
    expect((await who.box.take<StoryMessage>('story')).done).toContain('treats-from-scratch');
    const board = await who.box.take<JobsMessage>('jobs');
    expect(board.board.map((entry) => entry.job)).toEqual([2, 3, 4]);
    expect(board.board.at(-1)).toEqual(changed.next);

    expect(stored(who.id)).toMatchObject({ inventory: [{ item: 'berry-bun', count: 3 }], jobs: { drawn: 4, done: 1, board: board.board.map(({ kind: _kind, ...entry }) => entry) } });
    expect(stored(who.id)?.skills.map((entry) => entry.skill).toSorted()).toEqual(['cooking', 'foraging']);
  });

  it('only says what is still needed without the items, and hands nothing to the wrong character', async () => {
    const short = await player('Short Courier', { jobs: deliveryBoard(), inventory: [{ item: 'cloudberry', count: 2 }] });
    const from = short.box.heard.length;
    expect((await talk(short, 'tobolko')).node).toBe('job-waiting');
    expect(short.box.types().slice(from)).toEqual([]);
    expect(stored(short.id)?.jobs).toEqual(deliveryBoard());

    const wrong = await player('Wrong Courier', { jobs: deliveryBoard(), inventory: [{ item: 'cloudberry', count: 3 }] }, beside(world.map, world.map.npcs['bavko']!));
    await wrong.box.take<JobsMessage>('jobs');
    expect((await talk(wrong, 'bavko')).node).not.toBe('job-thanks');
    await sleep(100);
    expect(wrong.box.has('job.changed')).toBe(false);
    expect(stored(wrong.id)).toMatchObject({ inventory: [{ item: 'cloudberry', count: 3 }], jobs: deliveryBoard() });
  });

  it('keeps one player delivering from touching another board', async () => {
    const giver = await player('Giving Courier', { jobs: deliveryBoard(1), inventory: [{ item: 'cloudberry', count: 3 }] });
    const other = await player('Other Courier', { jobs: deliveryBoard(2), inventory: [{ item: 'cloudberry', count: 3 }] });
    await talk(giver, 'tobolko');
    await giver.box.take<JobChanged>('job.changed');
    await sleep(100);
    expect(other.box.has('job.changed')).toBe(false);
    expect(stored(other.id)?.jobs).toEqual(deliveryBoard(2));
    await until(() => stored(giver.id)?.jobs?.done === 1, 'the delivery to be saved');
  });
});
