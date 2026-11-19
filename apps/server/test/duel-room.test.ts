import type { Room } from '@colyseus/sdk';
import {
  DUEL_ANSWER_MS,
  DUEL_PAUSE_MS,
  encounterZoneAt,
  evenLevel,
  isWalkable,
  newCreature,
  shrineAt,
  type ArenaJoinMessage,
  type ArenaResultMessage,
  type ArenaStartedMessage,
  type CreatureInstance,
  type DuelAnsweredMessage,
  type DuelAskedMessage,
  type Point,
  type Refused,
  type SettingsMessage,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DUEL_WAIT_MS } from '../src/arena-room.ts';
import type { ArenaRoomState } from '../src/arena-state.ts';
import type { WorldRoom } from '../src/world-room.ts';
import { until } from './helpers.ts';
import { send, sleep, storyServer, type Player } from './story-server.ts';

let server: Awaited<ReturnType<typeof storyServer>>;
beforeAll(async () => {
  server = await storyServer({ arenaBattles: true });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  server.clock.offset = 0;
  await server.reset();
});

const map = () => server.world.map;
const spawn = () => map().spawns['player']!;
const creature = (species: string, level: number, hp?: number): CreatureInstance => {
  const made = newCreature(species, level, server.world.battle);
  return hp === undefined ? made : { ...made, hp };
};
const threeStanding = () => [creature('glowbun', 6), creature('puddlepip', 6), creature('pinwhirl', 6)];

/** A tile `distance` tiles from the spawn along one axis, walkable, out of the grass and off shrines. */
function tileAway(distance: number): Point {
  const from = spawn();
  const found = [
    { x: from.x + distance, y: from.y },
    { x: from.x - distance, y: from.y },
    { x: from.x, y: from.y + distance },
    { x: from.x, y: from.y - distance },
  ].find((tile) => isWalkable(map(), tile) && encounterZoneAt(map(), tile) === null && shrineAt(map(), tile) === null);
  if (!found) throw new Error(`nothing free ${distance} tiles from the spawn`);
  return found;
}

type Courier = Player & { readonly token: string };
const courier = (name: string, at: Point = spawn(), team: CreatureInstance[] = threeStanding()) => server.player(name, at, { team });
/** Two couriers a tile apart, each with three standing creatures. */
const pair = async (): Promise<[Courier, Courier]> => [await courier('Test Asker'), await courier('Test Answerer', tileAway(1))];

const keyOf = (who: Player) => who.room.sessionId;
const shown = (who: Player) => who.room.state.players.get(who.room.sessionId);
const refusal = async (who: Player, request: string) => {
  const refused = await who.box.take<Refused>('refused');
  expect(refused.request).toBe(request);
  return refused.reason;
};

async function ask(from: Courier, to: Courier, even = true): Promise<DuelAskedMessage> {
  await send(from, 'duel.ask', { to: keyOf(to), even });
  return to.box.take<DuelAskedMessage>('duel.asked');
}

async function answered(...who: Courier[]): Promise<boolean[]> {
  return Promise.all(who.map(async (each) => (await each.box.take<DuelAnsweredMessage>('duel.answered')).yes));
}

type Fighter = { room: Room<unknown, ArenaRoomState>; started: Promise<ArenaStartedMessage> };

async function enter(who: Courier): Promise<Fighter> {
  const join = await who.box.take<ArenaJoinMessage>('arena.join');
  server.colyseus.sdk.auth.token = who.token;
  const room = await server.colyseus.sdk.consumeSeatReservation<ArenaRoomState>(join.reservation);
  room.reconnection.enabled = false;
  const started = new Promise<ArenaStartedMessage>((resolve) => room.onMessage('arena.started', resolve));
  return { room, started };
}

describe('asking for a duel', () => {
  it('asks a courier nearby, who declines; the pair then waits 30 s', async () => {
    const [asker, answerer] = await pair();
    const asked = await ask(asker, answerer, true);
    expect(asked).toEqual({ from: keyOf(asker), even: true, creatures: [{ species: 'glowbun', level: 6 }, { species: 'puddlepip', level: 6 }, { species: 'pinwhirl', level: 6 }] });

    await send(answerer, 'duel.answer', { yes: false });
    expect(await answered(asker, answerer)).toEqual([false, false]);

    // Either way round, the same two wait after a no.
    await send(asker, 'duel.ask', { to: keyOf(answerer), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('notNow');
    await send(answerer, 'duel.ask', { to: keyOf(asker), even: false });
    expect(await refusal(answerer, 'duel.ask')).toBe('notNow');

    server.clock.offset = DUEL_PAUSE_MS;
    expect((await ask(asker, answerer, false)).even).toBe(false);
    expect(server.logged.lines.filter((line) => line['msg'] === 'duel answered').map((line) => line['end'])).toEqual(['declined']);
  });

  it('declines by itself after 20 s without an answer', async () => {
    const [asker, answerer] = await pair();
    await ask(asker, answerer);
    await sleep(200);
    expect(asker.box.has('duel.answered')).toBe(false);
    server.clock.offset = DUEL_ANSWER_MS;
    expect(await answered(asker, answerer)).toEqual([false, false]);
    // Answering now is too late, and the pause has started.
    await send(answerer, 'duel.answer', { yes: true });
    expect(await refusal(answerer, 'duel.answer')).toBe('notNow');
    await send(asker, 'duel.ask', { to: keyOf(answerer), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('notNow');
  });

  it('takes an ask back without a pause', async () => {
    const [asker, answerer] = await pair();
    await ask(asker, answerer);
    await send(asker, 'duel.cancel', {});
    expect(await answered(asker, answerer)).toEqual([false, false]);
    await ask(asker, answerer);
    await send(answerer, 'duel.cancel', {});
    expect(await refusal(answerer, 'duel.cancel')).toBe('notNow');
  });

  it('ends the ask when the asker leaves', async () => {
    const [asker, answerer] = await pair();
    await ask(asker, answerer);
    await asker.room.leave();
    expect(await answered(answerer)).toEqual([false]);
  });

  it('refuses a courier too far away, oneself, an unknown key and a team without three standing creatures', async () => {
    const asker = await courier('Test Asker');
    const far = await courier('Test Far', tileAway(5));
    await send(asker, 'duel.ask', { to: keyOf(far), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('tooFar');
    await send(asker, 'duel.ask', { to: keyOf(asker), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('invalid');
    await send(asker, 'duel.ask', { to: 'nobody', even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('invalid');
    const tired = await courier('Test Tired', tileAway(1), [creature('glowbun', 6), creature('puddlepip', 6, 0), creature('pinwhirl', 6)]);
    await send(asker, 'duel.ask', { to: keyOf(tired), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('notNow');
    await send(tired, 'duel.ask', { to: keyOf(asker), even: true });
    expect(await refusal(tired, 'duel.ask')).toBe('notNow');
    expect(far.box.has('duel.asked') || tired.box.has('duel.asked')).toBe(false);
  });

  it('refuses while either is busy: fighting, or in another ask', async () => {
    const [asker, answerer] = await pair();
    const third = await courier('Test Third', tileAway(2));
    await ask(asker, answerer);
    // One ask at a time, for the asker and for the one asked.
    await send(asker, 'duel.ask', { to: keyOf(third), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('notNow');
    await send(third, 'duel.ask', { to: keyOf(answerer), even: true });
    expect(await refusal(third, 'duel.ask')).toBe('notNow');
    await send(asker, 'duel.cancel', {});
    await answered(asker, answerer);

    const room = server.colyseus.getRoomById<WorldRoom>(third.room.roomId);
    expect(await room.startWildFight(third.id, { species: 'drizzlesnail', level: 3 })).not.toBeNull();
    await third.box.take('arena.join');
    await send(asker, 'duel.ask', { to: keyOf(third), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('notNow');
    await send(third, 'duel.ask', { to: keyOf(asker), even: true });
    expect(await refusal(third, 'duel.ask')).toBe('inBattle');
  });

  it('lets only the courier asked answer', async () => {
    const [asker, answerer] = await pair();
    const third = await courier('Test Third', tileAway(2));
    await ask(asker, answerer);
    await send(third, 'duel.answer', { yes: true });
    expect(await refusal(third, 'duel.answer')).toBe('notNow');
    await send(asker, 'duel.answer', { yes: true });
    expect(await refusal(asker, 'duel.answer')).toBe('notNow');
    expect(asker.box.has('duel.answered')).toBe(false);
    await send(answerer, 'duel.answer', { yes: false });
    expect(await answered(asker, answerer)).toEqual([false, false]);
  });

  it('closes the connection on a malformed ask', async () => {
    const asker = await courier('Test Asker');
    const left = new Promise<number>((resolve) => asker.room.onLeave(resolve));
    asker.room.send('duel.ask', { to: 7, even: 'yes' });
    expect(await left).toBe(4002);
  });
});

describe('an accepted duel', () => {
  it('seats both couriers in one best of 3, each with their own turtle setting, at the even level', async () => {
    const asker = await courier('Test Asker');
    const answerer = await courier('Test Answerer', tileAway(1), [creature('dawnshell', 12), creature('snowsnoot', 10), creature('glowbun', 8)]);
    expect((await asker.box.take<SettingsMessage>('settings')).turtle).toBe(false);
    await send(asker, 'settings.turtle', { on: true });
    expect((await asker.box.take<SettingsMessage>('settings')).turtle).toBe(true);
    await ask(asker, answerer, true);
    await send(answerer, 'duel.answer', { yes: true });
    expect(await answered(asker, answerer)).toEqual([true, true]);

    const [first, second] = await Promise.all([enter(asker), enter(answerer)]);
    const [mine, theirs] = await Promise.all([first.started, second.started]);
    expect(mine).toMatchObject({ mode: 'rounds', side: 0 });
    expect(theirs).toMatchObject({ mode: 'rounds', side: 1, fightId: mine.fightId });
    const level = evenLevel([threeStanding(), [creature('dawnshell', 12), creature('snowsnoot', 10), creature('glowbun', 8)]]);
    expect(mine.sides.flat().map((each) => each.level)).toEqual(Array(6).fill(level));
    expect(mine.sides[0].map((each) => each.species)).toEqual(['glowbun', 'puddlepip', 'pinwhirl']);
    expect(mine.sides[1].map((each) => each.species)).toEqual(['dawnshell', 'snowsnoot', 'glowbun']);
    await until(() => first.room.state.tick > 10, 'the duel to run');
    expect(first.room.state.bodies.map((body) => body.turtle)).toEqual([true, false]);
    expect(shown(asker)?.inBattle).toBe(true);
    expect(shown(answerer)?.inBattle).toBe(true);
    // Neither can be asked meanwhile.
    const third = await courier('Test Third', tileAway(2));
    await send(third, 'duel.ask', { to: keyOf(asker), even: true });
    expect(await refusal(third, 'duel.ask')).toBe('notNow');

    // The asker leaving the world ends the duel with no result, for both.
    await asker.room.leave();
    const result = await answerer.box.take<ArenaResultMessage>('arena.result');
    expect(result).toMatchObject({ fightId: mine.fightId, outcome: null, rewards: [], learned: [] });
    await until(() => shown(answerer)?.inBattle === false, 'the answerer to be back in the world');
    expect(server.stored(answerer.id)?.team.map((each) => each.level)).toEqual([12, 10, 8]);
  });

  it('waits 30 s for a courier who never comes, then ends with no result for both', async () => {
    const [asker, answerer] = await pair();
    await ask(asker, answerer, false);
    await send(answerer, 'duel.answer', { yes: true });
    await answered(asker, answerer);
    const first = await enter(asker);
    await first.started;
    await answerer.box.take('arena.join');
    await sleep(300);
    expect(first.room.state.tick).toBe(0);
    server.clock.offset = DUEL_WAIT_MS;
    const [mine, theirs] = await Promise.all([asker.box.take<ArenaResultMessage>('arena.result'), answerer.box.take<ArenaResultMessage>('arena.result')]);
    expect(mine.outcome).toBeNull();
    expect(theirs.outcome).toBeNull();
    await until(() => shown(asker)?.inBattle === false && shown(answerer)?.inBattle === false, 'both to be back in the world');
    expect(server.logged.lines.filter((line) => line['msg'] === 'fight settled').map((line) => [line['duel'], line['why']])).toEqual([
      [true, 'away'],
      [true, 'away'],
    ]);
  });
});
