import type { Room } from '@colyseus/sdk';
import {
  ARENA_NONE,
  DIRECTION_VECTORS,
  MAX_TEAM,
  newCreature,
  xpForWin,
  xpToNextLevel,
  type ArenaFight,
  type ArenaJoinMessage,
  type ArenaResultMessage,
  type CreatureInstance,
  type Point,
  type QuestChanged,
  type TalkEnded,
  type TalkNode,
  type WildResult,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ArenaRoom } from '../src/arena-room.ts';
import type { ArenaRoomState } from '../src/arena-state.ts';
import { BATTLE_IDLE_MS } from '../src/battles.ts';
import { until } from './helpers.ts';
import { WILD, beside, send, sleep, storyServer, type Player } from './story-server.ts';

// Tall grass with ARENA_BATTLES on: every step in it meets the test zone's wild creature, under rain.
const WEATHER = 'rain';
let server: Awaited<ReturnType<typeof storyServer>>;
beforeAll(async () => {
  server = await storyServer({ arenaBattles: true, zoneWeather: WEATHER });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  server.clock.offset = 0;
  await server.reset();
});

const map = () => server.world.map;
const grass = () => map().encounterAreas.find((area) => area.zone === 'post-meadow')!;
/** A tile just right of the meadow grass, and the grass tile next to it. */
const besideGrass = (): Point => ({ x: grass().x + grass().width, y: grass().y + 1 });
const intoGrass = (): Point => ({ x: grass().x + grass().width - 1, y: grass().y + 1 });
const besideNpc = (npc: string): Point => beside(map(), map().npcs[npc]!);
const me = ({ room }: Player) => room.state.players.get(room.sessionId);
const standsOn = (who: Player, tile: Point) => me(who)?.x === tile.x && me(who)?.y === tile.y && me(who)?.moving === false;
const settledLogs = () => server.logged.lines.filter((line) => line['msg'] === 'fight settled');

/** A level 14 pinwhirl one experience point short of 15, where it learns gale-wallop with four moves known. */
const nearlyFifteen = (): CreatureInstance => ({ ...newCreature('pinwhirl', 14, server.world.battle), xp: xpToNextLevel(14) - 1 });
const filler = (): CreatureInstance => newCreature('glowbun', 5, server.world.battle);

type Fighter = { room: Room<unknown, ArenaRoomState>; server: ArenaRoom };

/** Steps into the grass and takes the `arena.join` it brings. */
async function meetWild(who: Player): Promise<ArenaJoinMessage> {
  who.room.send('walk.to', intoGrass());
  return who.box.take<ArenaJoinMessage>('arena.join');
}

async function enter(who: Player & { readonly token: string }, join: ArenaJoinMessage): Promise<Fighter> {
  server.colyseus.sdk.auth.token = who.token;
  const room = await server.colyseus.sdk.consumeSeatReservation<ArenaRoomState>(join.reservation);
  room.reconnection.enabled = false;
  room.onMessage('*', () => {});
  await until(() => room.state.bodies?.length === 2, 'the fight’s first state');
  return { room, server: server.colyseus.getRoomById<ArenaRoom>(room.roomId) };
}

/** The one of the 16 stick directions closest to the way from `from` to `to`. */
function toward(from: Point, to: Point): number {
  let best = ARENA_NONE;
  let bestDot = 0;
  DIRECTION_VECTORS.forEach(([x, y], direction) => {
    const dot = x * (to.x - from.x) + y * (to.y - from.y);
    if (dot > bestDot) [best, bestDot] = [direction, dot];
  });
  return best;
}

/** Walks at the wild creature pressing button 1 every fourth input, 30 inputs a second, until the fight is settled. */
async function fightToTheEnd(who: Player, fighter: Fighter, deadline = Date.now() + 15_000, sent = 0): Promise<void> {
  if (who.box.has('arena.result')) return;
  if (Date.now() > deadline) throw new Error('the fight did not end');
  const [mine, wild] = fighter.room.state.bodies;
  const input = fighter.room.input();
  Object.assign(input.data, { dir: mine && wild ? toward(mine, wild) : ARENA_NONE, press: sent % 4 === 0 ? 0 : ARENA_NONE, dash: false, treat: false, swap: false, leave: false });
  input.send();
  await sleep(33);
  return fightToTheEnd(who, fighter, deadline, sent + 1);
}

/** Takes Vetrinka's round of a rest, a won battle in the meadow and a befriending, and rests at the shrine. */
async function restOnRounds(who: Player): Promise<void> {
  const offer = await send(who, 'talk.start', { npc: 'vetrinka' }).then(() => who.box.take<TalkNode>('talk.node'));
  expect((await who.box.take<QuestChanged>('quest.changed')).change).toBe('started');
  await send(who, 'talk.end', { conversation: offer.conversation });
  await who.box.take<TalkEnded>('talk.ended');
  who.room.send('walk.to', map().shrines['post-shrine']!);
  expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-rounds', change: 'step', step: 1 });
}

/** The arena room ends its fight as `result`, as the island would have, and hands it to the world room. */
function endAs(join: ArenaJoinMessage, result: WildResult) {
  const room = server.colyseus.getRoomById<ArenaRoom>(join.reservation.roomId);
  const fight: ArenaFight = room.current;
  if (fight.mode !== 'wild') throw new Error('expected a wild fight');
  server.fights.finish({ fightId: join.fightId, fight: { ...fight, outcome: { result, tick: fight.tick } }, why: 'done' });
}

describe('wild fights in the grass', () => {
  it('starts an arena fight on a step into the grass, under the zone’s weather, and shows the courier fighting to others', async () => {
    const watcher = await server.player('Watching Courier', { x: 20, y: 12 });
    const who = await server.player('Grass Courier', besideGrass(), { team: [nearlyFifteen()] });
    const join = await meetWild(who);
    expect(who.box.has('battle.started')).toBe(false);
    await until(() => me(who)?.inBattle === true && watcher.room.state.players.get(who.room.sessionId)?.inBattle === true, 'both to see the fight');
    await until(() => me(who)?.moving === false, 'the courier to stand');
    expect({ x: me(who)!.x, y: me(who)!.y }).toEqual(intoGrass());
    expect(server.fights.plan(join.fightId)?.setup).toMatchObject({ mode: 'wild', weather: WEATHER, wild: { species: WILD.species, level: WILD.level } });
    expect(server.stored(who.id)).toMatchObject({ seen: [WILD.species], position: { ...intoGrass() } });

    const fighter = await enter(who, join);
    await until(() => fighter.room.state.tick > 0, 'the fight to run');
    expect(fighter.room.state.weather).toBe(WEATHER);
    // The world takes no walking while the fight goes on.
    who.room.send('walk.to', besideGrass());
    await sleep(200);
    expect(standsOn(who, intoGrass())).toBe(true);
    expect(server.logged.lines.find((line) => line['msg'] === 'fight planned')).toMatchObject({ zone: 'post-meadow', species: WILD.species });
  });

  it('gives the experience of a win, and every move the level up teaches as learned, never offered', async () => {
    const who = await server.player('Winning Courier', besideGrass(), { team: [nearlyFifteen()] });
    const fighter = await enter(who, await meetWild(who));
    await fightToTheEnd(who, fighter);
    const result = await who.box.take<ArenaResultMessage>('arena.result');
    expect(['won', 'wonByRingOut']).toContain(result.outcome?.result);
    expect(result.rewards).toEqual([{ index: 0, xp: xpForWin(WILD.level), level: 15 }]);
    expect(result.learned).toEqual([{ index: 0, move: 'gale-wallop' }]);
    expect(result.befriended).toBeNull();
    await until(() => me(who)?.inBattle === false, 'the seat to be free');
    await sleep(100);
    expect(who.box.has('move.offer')).toBe(false);
    const team = server.stored(who.id)?.team;
    expect(team?.[0]).toMatchObject({ level: 15, moves: nearlyFifteen().moves });
    expect(settledLogs()).toEqual([expect.objectContaining({ zone: 'post-meadow', learned: 1 })]);
  });

  it('counts a ring-out win in the zone and a befriending for quests, with no friend from the ring-out and a full team’s friend in storage', async () => {
    const team = [nearlyFifteen(), ...Array.from({ length: MAX_TEAM - 1 }, filler)];
    const who = await server.player('Questing Courier', besideNpc('vetrinka'), { team });
    await restOnRounds(who);

    const ringOut = await meetWild(who);
    endAs(ringOut, 'wonByRingOut');
    const rung = await who.box.take<ArenaResultMessage>('arena.result');
    expect(rung).toMatchObject({ outcome: { result: 'wonByRingOut' }, rewards: [{ index: 0, xp: xpForWin(WILD.level), level: 15 }], befriended: null });
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-rounds', change: 'step', step: 2 });
    expect(server.stored(who.id)?.storage).toEqual([]);

    // Out of the grass on its east side, and back in.
    await until(() => me(who)?.inBattle === false, 'the seat to be free');
    const here = { x: me(who)!.x, y: me(who)!.y };
    who.room.send('walk.to', { x: here.x + 1, y: here.y });
    await until(() => standsOn(who, { x: here.x + 1, y: here.y }), 'the step out of the grass');
    who.room.send('walk.to', here);
    const friendly = await who.box.take<ArenaJoinMessage>('arena.join');
    endAs(friendly, 'befriended');
    const befriended = await who.box.take<ArenaResultMessage>('arena.result');
    expect(befriended).toMatchObject({ outcome: { result: 'befriended' }, befriended: { species: WILD.species, level: WILD.level, placedIn: 'storage' } });
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-rounds', change: 'done', step: 3 });
    const stored = server.stored(who.id);
    expect(stored?.team).toHaveLength(MAX_TEAM);
    expect(stored?.storage).toEqual([expect.objectContaining({ species: WILD.species, level: WILD.level })]);
    expect(stored?.befriended).toContain(WILD.species);
    expect(stored?.story.done).toEqual(['test-rounds']);
  });

  it('counts a befriending as a won battle in its zone, as a turn battle does', async () => {
    const who = await server.player('Befriending Courier', besideNpc('vetrinka'), { team: [nearlyFifteen()] });
    await restOnRounds(who);

    endAs(await meetWild(who), 'befriended');
    expect(await who.box.take<ArenaResultMessage>('arena.result')).toMatchObject({ outcome: { result: 'befriended' }, befriended: { species: WILD.species, placedIn: 'team' } });
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-rounds', change: 'step', step: 2 });
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-rounds', change: 'done', step: 3 });
    expect(server.stored(who.id)?.story.done).toEqual(['test-rounds']);
  });

  it('ends the fight of a player who dropped out of it as ran after the idle time, with no experience', async () => {
    const who = await server.player('Dropped Courier', besideGrass(), { team: [nearlyFifteen()] });
    const fighter = await enter(who, await meetWild(who));
    await fighter.room.leave(false);
    await until(() => fighter.server.paused, 'the fight to wait');
    server.clock.offset = BATTLE_IDLE_MS;
    const result = await who.box.take<ArenaResultMessage>('arena.result');
    expect(result).toMatchObject({ outcome: { result: 'ran' }, rewards: [], learned: [], befriended: null });
    await until(() => me(who)?.inBattle === false, 'the seat to be free');
    expect(server.stored(who.id)?.team[0]).toMatchObject({ level: 14 });
    expect(settledLogs()).toEqual([expect.objectContaining({ why: 'away', result: 'ran' })]);
  });
});
