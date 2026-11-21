import type { Room } from '@colyseus/sdk';
import {
  ARENA_NONE,
  DUEL_ANSWER_MS,
  DUEL_PAUSE_MS,
  DUEL_TROPHY_MS,
  DUEL_WATCHERS,
  encounterZoneAt,
  evenLevel,
  isWalkable,
  newCreature,
  shrineAt,
  xpForWin,
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
import { DUEL_WAIT_MS, type ArenaRoom } from '../src/arena-room.ts';
import type { ArenaRoomState } from '../src/arena-state.ts';
import type { WorldRoom } from '../src/world-room.ts';
import { repeat, until } from './helpers.ts';
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

  it('takes an ask back; the pair then waits 30 s, as after a no', async () => {
    const [asker, answerer] = await pair();
    await ask(asker, answerer);
    await send(asker, 'duel.cancel', {});
    expect(await answered(asker, answerer)).toEqual([false, false]);

    // Asking straight again, either way round, is refused, so the answer card cannot be flashed.
    await send(asker, 'duel.ask', { to: keyOf(answerer), even: true });
    expect(await refusal(asker, 'duel.ask')).toBe('notNow');
    await send(answerer, 'duel.ask', { to: keyOf(asker), even: true });
    expect(await refusal(answerer, 'duel.ask')).toBe('notNow');
    expect(answerer.box.has('duel.asked') || asker.box.has('duel.asked')).toBe(false);

    server.clock.offset = DUEL_PAUSE_MS;
    await ask(asker, answerer);
    await send(answerer, 'duel.cancel', {});
    expect(await refusal(answerer, 'duel.cancel')).toBe('notNow');
    expect(server.logged.lines.filter((line) => line['msg'] === 'duel answered').map((line) => line['end'])).toEqual(['cancelled']);
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
    // While picking, each side is told only its own defaults.
    expect([...mine.sides[0], ...theirs.sides[1]].map((each) => each.level)).toEqual(Array(6).fill(level));
    expect(mine.sides[0].map((each) => each.species)).toEqual(['glowbun', 'puddlepip', 'pinwhirl']);
    expect(mine.sides[1]).toEqual([]);
    expect(theirs.sides[1].map((each) => each.species)).toEqual(['dawnshell', 'snowsnoot', 'glowbun']);
    await pickBoth(first, second);
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

/** Both duellists send their picks, the first three of their teams, and round 1 starts. */
async function pickBoth(first: Fighter, second: Fighter) {
  await until(() => first.room.state.phase === 'picking' && second.room.state.phase === 'picking', 'picking to start');
  first.room.send('arena.pick', { order: [0, 1, 2] });
  second.room.send('arena.pick', { order: [0, 1, 2] });
  await until(() => first.room.state.phase === 'fighting' && first.room.state.bodies.length === 2, 'round 1 to start');
}

/** An accepted duel with both duellists in its room. */
async function duel(asker: Courier, answerer: Courier, even = false): Promise<[Fighter, Fighter]> {
  await ask(asker, answerer, even);
  await send(answerer, 'duel.answer', { yes: true });
  await answered(asker, answerer);
  return Promise.all([enter(asker), enter(answerer)]);
}

/** Streams one arena input from a seat, as a client does once per step. */
function input(room: Room<unknown, ArenaRoomState>, fields: Partial<Record<'dir' | 'press', number> & Record<'dash' | 'treat' | 'swap' | 'leave', boolean>>) {
  const handle = room.input();
  Object.assign(handle.data, { dir: ARENA_NONE, press: ARENA_NONE, dash: false, treat: false, swap: false, leave: false }, fields);
  handle.send();
}

/** Holds give up, as the duel island's corner button sends it once held. */
async function giveUp(fighter: Fighter) {
  await repeat(10, async () => {
    input(fighter.room, { leave: true });
    await sleep(33);
  });
}

describe('the duel island', () => {
  it('lets both duellists pick from every standing creature, the first three standing being the defaults', async () => {
    const asker = await courier('Test Asker', spawn(), [creature('glowbun', 6), creature('puddlepip', 6, 0), creature('pinwhirl', 6), creature('snowsnoot', 7), creature('dawnshell', 8)]);
    const answerer = await courier('Test Answerer', tileAway(1), [creature('dawnshell', 9), creature('glowbun', 9), creature('puddlepip', 9), creature('snowsnoot', 9)]);
    const [first, second] = await duel(asker, answerer);
    const [mine, theirs] = await Promise.all([first.started, second.started]);
    expect(mine).toMatchObject({ watching: false, side: 0 });
    expect(mine.sides[0].map((each) => each.place)).toEqual([0, 2, 3]);
    expect(mine.sides[1]).toEqual([]);
    expect(theirs.sides[1].map((each) => each.place)).toEqual([0, 1, 2]);
    await until(() => first.room.state.duel && shown(asker)?.duelling === true && shown(asker)?.inBattle === true, 'the duel mark');

    const again = new Promise<ArenaStartedMessage>((resolve) => first.room.onMessage('arena.started', resolve));
    await until(() => first.room.state.phase === 'picking', 'picking to start');
    first.room.send('arena.pick', { order: [4, 3, 0] });
    second.room.send('arena.pick', { order: [3, 1, 0] });
    const lined = await again;
    expect(lined.sides[0].map((each) => each.place)).toEqual([4, 3, 0]);
    expect(lined.sides[1].map((each) => each.species)).toEqual(['snowsnoot', 'glowbun', 'dawnshell']);
    await until(() => first.room.state.bodies[0]?.species === 'dawnshell', 'round 1 with the picks');
  });

  it('seats up to six watchers, who see the same state and whose input is thrown away; a seventh is refused', async () => {
    const [asker, answerer] = await pair();
    const [first, second] = await duel(asker, answerer);
    await pickBoth(first, second);
    const fightRoom = server.colyseus.getRoomById<ArenaRoom>(first.room.roomId);

    const watchers = await repeat(DUEL_WATCHERS, (at) => courier(`Test Watcher ${at + 1}`, tileAway(2)));
    const seats = await repeat(DUEL_WATCHERS, async (at) => {
      const watcher = watchers[at]!;
      await send(watcher, 'duel.watch', { who: keyOf(asker) });
      return enter(watcher);
    });
    const started = await seats[0]!.started;
    expect(started).toMatchObject({ watching: true, side: 0, mode: 'rounds' });
    expect(started.sides[0].length).toBe(3);
    await until(() => first.room.state.watchers.length === DUEL_WATCHERS, 'the stands to fill');
    expect([...first.room.state.watchers]).toEqual(Array(DUEL_WATCHERS).fill('green'));
    expect(watchers.every((each) => shown(each)?.watching === true)).toBe(true);

    const seventh = await courier('Test Seventh', tileAway(2));
    await send(seventh, 'duel.watch', { who: keyOf(answerer) });
    expect(await refusal(seventh, 'duel.watch')).toBe('full');
    expect(shown(seventh)?.watching).toBe(false);

    // A watcher's input, even give up, changes nothing.
    const watching = seats[0]!.room;
    await repeat(10, async () => {
      input(watching, { leave: true, dir: 0, press: 0 });
      await sleep(33);
    });
    await until(() => fightRoom.stats.watcherInputs >= 5, 'watcher input to be thrown away');
    expect(fightRoom.stats.inputs).toBe(0);
    expect(first.room.state.phase).toBe('fighting');
    const tick = fightRoom.state.tick;
    await until(() => watching.state.tick > tick && watching.state.bodies.length === 2, 'the watcher to see the fight');
    expect(watching.state.bodies.map((body) => body.id)).toEqual([...first.room.state.bodies].map((body) => body.id));

    // One tap leaves: the stands have a seat again, and the world no longer shows them watching.
    await watching.leave();
    await until(() => shown(watchers[0]!)?.watching === false && first.room.state.watchers.length === DUEL_WATCHERS - 1, 'the watcher to stop watching');
    await send(seventh, 'duel.watch', { who: keyOf(answerer) });
    await (await enter(seventh)).started;
  });

  it('refuses to watch anything but a duel, and stops watching on a walk or on leaving the world', async () => {
    const [asker, answerer] = await pair();
    const watcher = await courier('Test Watcher', tileAway(2));
    await send(watcher, 'duel.watch', { who: keyOf(asker) });
    expect(await refusal(watcher, 'duel.watch')).toBe('notNow');
    await send(watcher, 'duel.watch', { who: keyOf(watcher) });
    expect(await refusal(watcher, 'duel.watch')).toBe('invalid');

    const [first] = await duel(asker, answerer);
    await send(watcher, 'duel.watch', { who: keyOf(asker) });
    const seat = await enter(watcher);
    await seat.started;
    const gone = new Promise<number>((resolve) => seat.room.onLeave(resolve));
    await until(() => shown(watcher)?.watching === true, 'the watching mark');
    // Neither duellist can watch, and a watcher cannot be asked.
    await send(answerer, 'duel.watch', { who: keyOf(asker) });
    expect(await refusal(answerer, 'duel.watch')).toBe('inBattle');
    const fourth = await courier('Test Fourth', tileAway(2));
    await send(fourth, 'duel.ask', { to: keyOf(watcher), even: true });
    expect(await refusal(fourth, 'duel.ask')).toBe('notNow');

    // Walking ends the watching in the world, and the duel's room sends the watcher's seat out too.
    await send(watcher, 'walk.to', { x: spawn().x, y: spawn().y });
    await until(() => shown(watcher)?.watching === false, 'walking to stop the watching');
    await gone;
    await until(() => first.room.state.watchers.length === 0, 'the stands to empty after the walk');

    // A watcher who leaves the world loses their seat on the stands with it.
    const second = await courier('Test Second Watcher', tileAway(2));
    await send(second, 'duel.watch', { who: keyOf(answerer) });
    const secondSeat = await enter(second);
    await secondSeat.started;
    await until(() => first.room.state.watchers.length === 1, 'the second watcher on the stands');
    const secondGone = new Promise<number>((resolve) => secondSeat.room.onLeave(resolve));
    await second.room.leave();
    await secondGone;
    await until(() => first.room.state.watchers.length === 0, 'the stands to empty after leaving the world');
  });

  it('gives each side 25% of a win for each creature that fought, win or lose, keeps health, and crowns the winner', async () => {
    const [asker, answerer] = await pair();
    const [first, second] = await duel(asker, answerer);
    await pickBoth(first, second);
    const watcher = await courier('Test Watcher', tileAway(2));
    await send(watcher, 'duel.watch', { who: keyOf(asker) });
    const seat = await enter(watcher);
    await seat.started;
    const before = server.stored(asker.id)!.team.map((each) => each.hp);

    await giveUp(first);
    const [lost, won, watched] = await Promise.all([asker.box.take<ArenaResultMessage>('arena.result'), answerer.box.take<ArenaResultMessage>('arena.result'), watcher.box.take<ArenaResultMessage>('arena.result')]);
    // Each duellist hears the outcome from their own side; a watcher from side 0's.
    expect(lost.outcome).toMatchObject({ result: 'lost', winner: 1 });
    expect(won.outcome).toMatchObject({ result: 'won', winner: 1 });
    expect(lost.rounds.map((round) => round.how)).toEqual(['gaveUp', 'gaveUp']);
    // Both sides' creatures are level 6: a quarter of a win over one, truncated.
    const xp = Math.trunc(xpForWin(6) / 4);
    expect(lost.rewards.map((reward) => [reward.index, reward.xp])).toEqual([[0, xp]]);
    expect(won.rewards.map((reward) => reward.index)).toEqual([0]);
    expect(watched).toMatchObject({ outcome: { result: 'lost', winner: 1 }, rewards: [], learned: [] });

    await until(() => shown(asker)?.inBattle === false && shown(watcher)?.watching === false, 'everyone back in the world');
    expect(server.stored(asker.id)!.team.map((each) => each.hp)).toEqual(before);
    expect(shown(answerer)?.trophy).toBe(true);
    expect(shown(asker)?.trophy).toBe(false);
    expect(server.logged.lines.find((line) => line['msg'] === 'fighter gave up')).toMatchObject({ side: 0 });
    server.clock.offset = DUEL_TROPHY_MS;
    await until(() => shown(answerer)?.trophy === false, 'the trophy to come off');
  });

  it('pauses while a duellist is away, and watchers see it waiting', async () => {
    const [asker, answerer] = await pair();
    const [first, second] = await duel(asker, answerer);
    await pickBoth(first, second);
    const watcher = await courier('Test Watcher', tileAway(2));
    await send(watcher, 'duel.watch', { who: keyOf(answerer) });
    const seat = await enter(watcher);
    await seat.started;
    const fightRoom = server.colyseus.getRoomById<ArenaRoom>(first.room.roomId);

    const { reconnectionToken } = second.room;
    await second.room.leave(false);
    await until(() => seat.room.state.waiting, 'the watcher to see the duel waiting');
    const tick = fightRoom.state.tick;
    await sleep(300);
    expect(fightRoom.state.tick).toBe(tick);

    server.colyseus.sdk.auth.token = answerer.token;
    const back = await server.colyseus.sdk.reconnect<ArenaRoomState>(reconnectionToken);
    back.reconnection.enabled = false;
    await until(() => !seat.room.state.waiting && fightRoom.state.tick > tick + 10, 'the duel to go on');
  });
});
