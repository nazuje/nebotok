import type { Room } from '@colyseus/sdk';
import {
  isWalkable,
  newCreature,
  xpToNextLevel,
  type BattleResult,
  type BattleUpdate,
  type CreatureInstance,
  type MoveOffer,
  type Point,
  type ProgressMessage,
  type QuestChanged,
  type Refused,
  type StoryMessage,
  type TalkEnded,
  type TalkNode,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TALK_IDLE_MS } from '../src/talk.ts';
import type { WorldRoom } from '../src/world-room.ts';
import type { WorldState } from '../src/world-state.ts';
import { repeat, until } from './helpers.ts';
import { WILD, beside, inbox, send, sleep, storyServer, type Player } from './story-server.ts';

let server: Awaited<ReturnType<typeof storyServer>>;
beforeAll(async () => {
  server = await storyServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});

const map = () => server.world.map;
const npcAt = (npc: string): Point => map().npcs[npc]!;
const besideNpc = (npc: string): Point => beside(map(), npcAt(npc));
const me = ({ room }: Player) => room.state.players.get(room.sessionId);
const standsOn = (who: Player, tile: Point) => me(who)?.x === tile.x && me(who)?.y === tile.y && me(who)?.moving === false;
const roomOf = ({ room }: Player) => server.colyseus.getRoomById<WorldRoom>(room.roomId);
const grass = () => map().encounterAreas.find((area) => area.zone === 'post-meadow')!;
const intoGrass = (): Point => ({ x: grass().x + grass().width - 1, y: grass().y + 1 });

const strong = (): CreatureInstance => newCreature('glowbun', 60, server.world.battle);
const favourite = (): string => server.world.battle.species.get(WILD.species)!.favouriteTreat!;

/** Sends talk.start and takes the node it opens at. */
async function talk(who: Player, npc: string): Promise<TalkNode> {
  await send(who, 'talk.start', { npc });
  return who.box.take<TalkNode>('talk.node');
}

/** Tobolko stands by the grass, where wild creatures always appear here: talk to him from below, coming along the rows south of it. */
const belowTobolko = (): Point => ({ x: npcAt('tobolko').x, y: npcAt('tobolko').y + 1 });
async function walkToTobolko(who: Player) {
  const row = belowTobolko().y + 1;
  const east = Array.from({ length: 5 }, (_, at) => ({ x: grass().x + grass().width + at, y: row })).find((tile) => isWalkable(map(), tile))!;
  await walkTo(who, east);
  await walkTo(who, belowTobolko());
}

async function walkTo(who: Player, tile: Point) {
  who.room.send('walk.to', tile);
  await until(() => standsOn(who, tile), `the walk to ${tile.x},${tile.y}`, Date.now() + 10_000);
}

/** The types heard since `from`, the place in `heard` to start at. */
const heardSince = (who: Player, from: number) => who.box.types().slice(from);

describe('starting a talk', () => {
  it('sends story right after progress on joining', async () => {
    // Saves are repaired against content/, so this story names a quest of the real one.
    const live = [...server.temp.services.world.story.quests.keys()][0]!;
    const story = { active: [{ quest: live, step: 0, count: 0 }], done: [], flags: [] };
    const who = await server.player('Storied Courier', besideNpc('bavko'), { team: [strong()], story });
    expect(who.box.types()[0]).toBe('story');
    expect(await who.box.take<StoryMessage>('story')).toEqual(story);
    expect(me(who)?.talking).toBe(false);
  });

  it('talks only next to the character, and refuses one nobody knows', async () => {
    const far = { x: npcAt('bavko').x + 3, y: npcAt('bavko').y + 3 };
    const who = await server.player('Distant Courier', far, { team: [strong()] });
    await send(who, 'talk.start', { npc: 'bavko' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'talk.start', reason: 'tooFar' });
    await send(who, 'talk.start', { npc: 'nobody' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'talk.start', reason: 'invalid' });
    expect(me(who)?.talking).toBe(false);
  });

  it('opens a talk, stops the walk, shows the speech mark to others, and sends each player only their own lines', async () => {
    const tile = besideNpc('bavko');
    const first = await server.player('First Courier', tile, { team: [strong()] });
    const second = await server.player('Second Courier', tile, { team: [strong()] });
    const node = await talk(first, 'bavko');
    expect(node).toEqual({ conversation: expect.any(Number), npc: 'bavko', node: 'offer', choices: [0, 1], cue: null });
    await until(() => second.room.state.players.get(first.room.sessionId)?.talking === true, 'the other player to see the talk');
    const other = await talk(second, 'bavko');
    expect(other.conversation).not.toBe(node.conversation);
    await send(first, 'talk.next', { conversation: node.conversation, choice: 1 });
    expect(await first.box.take<TalkNode>('talk.node')).toMatchObject({ conversation: node.conversation, node: 'later', choices: [] });
    await sleep(100);
    expect(first.box.heard.filter((message) => message.type === 'talk.node')).toEqual([]);
    expect(second.box.heard.filter((message) => message.type === 'talk.node')).toEqual([]);
    expect(second.box.has('talk.ended')).toBe(false);
  });

  it('refuses what does not fit the talk', async () => {
    const who = await server.player('Muddled Talker', besideNpc('bavko'), { team: [strong()] });
    await send(who, 'talk.next', { conversation: 1, choice: null });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'talk.next', reason: 'notTalking' });
    await send(who, 'talk.end', { conversation: 1 });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'talk.end', reason: 'notTalking' });
    const node = await talk(who, 'bavko');
    const wrong: [string, object, Refused['reason']][] = [
      ['talk.start', { npc: 'bavko' }, 'notNow'],
      ['talk.next', { conversation: node.conversation + 1, choice: 0 }, 'invalid'],
      ['talk.end', { conversation: node.conversation + 1 }, 'invalid'],
      ['talk.next', { conversation: node.conversation, choice: 2 }, 'invalid'],
      ['talk.next', { conversation: node.conversation, choice: null }, 'invalid'],
    ];
    await repeat(wrong.length, async (index) => {
      const [type, payload, reason] = wrong[index]!;
      await send(who, type, payload);
      expect(await who.box.take<Refused>('refused')).toEqual({ request: type, reason });
    });
    expect(me(who)?.talking).toBe(true);
  });

  it('disconnects a client that sends a malformed talk request', async () => {
    const who = await server.player('Chatty Courier', besideNpc('bavko'));
    const left = new Promise<number>((resolve) => who.room.onLeave((code) => resolve(code)));
    who.room.send('talk.next', { conversation: 1, choice: 7 });
    expect(await left).toBe(4002);
  });
});

describe('the starter from Bavko', () => {
  it('offers the starter at the node that says so, and ends the talk once it is chosen', async () => {
    const who = await server.player('New Courier', besideNpc('bavko'));
    expect(who.progress.needsStarter).toBe(true);
    const welcome = await talk(who, 'bavko');
    expect(welcome).toMatchObject({ node: 'welcome', cue: null, choices: [] });
    await send(who, 'talk.next', { conversation: welcome.conversation, choice: null });
    expect(await who.box.take<TalkNode>('talk.node')).toMatchObject({ node: 'starter', cue: 'offerStarter' });
    await send(who, 'starter.choose', { species: 'puddlepip' });
    expect(await who.box.take<ProgressMessage>('progress')).toMatchObject({ needsStarter: false, team: [{ species: 'puddlepip' }] });
    expect(await who.box.take<TalkEnded>('talk.ended')).toEqual({ conversation: welcome.conversation });
    await until(() => me(who)?.talking === false, 'the speech mark to go');
    expect((await talk(who, 'bavko')).node).toBe('offer');
  });

  it('refuses starter.choose until the player is at the node that offers it', async () => {
    const who = await server.player('Patient Courier', besideNpc('bavko'));
    await send(who, 'starter.choose', { species: 'puddlepip' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'starter.choose', reason: 'notTalking' });
    const welcome = await talk(who, 'bavko');
    expect(welcome.node).toBe('welcome');
    await send(who, 'starter.choose', { species: 'puddlepip' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'starter.choose', reason: 'notTalking' });
    await send(who, 'talk.next', { conversation: welcome.conversation, choice: null });
    expect((await who.box.take<TalkNode>('talk.node')).cue).toBe('offerStarter');
    await send(who, 'starter.choose', { species: 'boltkit' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'starter.choose', reason: 'invalid' });
    await send(who, 'starter.choose', { species: 'puddlepip' });
    expect((await who.box.take<ProgressMessage>('progress')).team).toMatchObject([{ species: 'puddlepip' }]);
    expect(await who.box.take<TalkEnded>('talk.ended')).toEqual({ conversation: welcome.conversation });
    await send(who, 'starter.choose', { species: 'glowbun' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'starter.choose', reason: 'notNow' });
  });
});

describe('a delivery', () => {
  it('starts a quest, carries the note, delivers it and gives the rewards, in order and saved', async () => {
    const who = await server.player('Delivering Courier', besideNpc('bavko'), { team: [strong()] });
    await who.box.take<StoryMessage>('story');
    const offer = await talk(who, 'bavko');
    let from = who.box.heard.length;
    await send(who, 'talk.next', { conversation: offer.conversation, choice: 0 });
    expect(await who.box.take<TalkNode>('talk.node')).toMatchObject({ node: 'accept', choices: [] });
    expect(heardSince(who, from)).toEqual(['quest.changed', 'progress', 'story']);
    expect(await who.box.take<QuestChanged>('quest.changed')).toEqual({ quest: 'test-delivery', change: 'started', step: 0, rewards: null, cue: null });
    expect((await who.box.take<ProgressMessage>('progress')).inventory).toContainEqual({ item: 'test-note', count: 1 });
    expect(await who.box.take<StoryMessage>('story')).toEqual({ active: [{ quest: 'test-delivery', step: 0, count: 0 }], done: [], flags: [] });

    // Walking is ignored while talking; continuing from the last node ends the talk.
    who.room.send('walk.to', belowTobolko());
    await sleep(300);
    expect(standsOn(who, besideNpc('bavko'))).toBe(true);
    await send(who, 'talk.next', { conversation: offer.conversation, choice: null });
    expect(await who.box.take<TalkEnded>('talk.ended')).toEqual({ conversation: offer.conversation });

    await walkToTobolko(who);
    from = who.box.heard.length;
    const thanks = await talk(who, 'tobolko');
    expect(thanks).toMatchObject({ npc: 'tobolko', node: 'thanks' });
    expect(heardSince(who, from)).toEqual(['quest.changed', 'progress', 'story']);
    expect(await who.box.take<QuestChanged>('quest.changed')).toEqual({
      quest: 'test-delivery',
      change: 'done',
      step: 1,
      rewards: { items: [{ item: 'plain-treat', count: 2 }], extra: [], xp: 0, creatures: [], skills: [] },
      cue: null,
    });
    expect((await who.box.take<ProgressMessage>('progress')).inventory).toEqual([{ item: 'plain-treat', count: 2 }]);
    expect(await who.box.take<StoryMessage>('story')).toEqual({ active: [], done: ['test-delivery'], flags: [] });
    await send(who, 'talk.next', { conversation: thanks.conversation, choice: null });
    expect((await who.box.take<TalkNode>('talk.node')).node).toBe('after');
    await send(who, 'talk.end', { conversation: thanks.conversation });
    await who.box.take<TalkEnded>('talk.ended');
    expect(server.stored(who.id)).toMatchObject({ inventory: [{ item: 'plain-treat', count: 2 }], story: { active: [], done: ['test-delivery'] } });
  });
});

describe('a talk and the connection', () => {
  it('ends a talk left without a request for two minutes', async () => {
    const who = await server.player('Sleepy Talker', besideNpc('bavko'), { team: [strong()] });
    const node = await talk(who, 'bavko');
    server.clock.offset += TALK_IDLE_MS - 1_000;
    roomOf(who).checkBattles();
    await sleep(100);
    expect(who.box.has('talk.ended')).toBe(false);
    server.clock.offset += 1_000;
    roomOf(who).checkBattles();
    expect(await who.box.take<TalkEnded>('talk.ended')).toEqual({ conversation: node.conversation });
    await until(() => me(who)?.talking === false, 'the speech mark to go');
    await walkTo(who, { x: besideNpc('bavko').x, y: besideNpc('bavko').y + 1 });
  });

  it('sends the node again after a reconnection, and goes on from there', async () => {
    const who = await server.player('Dropping Talker', besideNpc('bavko'), { team: [strong()] });
    const node = await talk(who, 'bavko');
    const { reconnectionToken } = who.room;
    await who.room.leave(false);
    const back: Room<unknown, WorldState> = await server.colyseus.sdk.reconnect<WorldState>(reconnectionToken);
    back.reconnection.enabled = false;
    const again: Player = { ...who, room: back, box: inbox(back) };
    await again.box.take<ProgressMessage>('progress');
    await again.box.take<StoryMessage>('story');
    expect(await again.box.take<TalkNode>('talk.node')).toEqual(node);
    expect(again.box.types()).toEqual([]);
    await send(again, 'talk.next', { conversation: node.conversation, choice: 1 });
    expect((await again.box.take<TalkNode>('talk.node')).node).toBe('later');
  });

  it('ends the talk when the player leaves', async () => {
    const who = await server.player('Leaving Talker', besideNpc('bavko'), { team: [strong()] });
    await talk(who, 'bavko');
    await who.room.leave();
    await until(() => server.logged.lines.some((line) => line.msg === 'talk ended' && line.why === 'left'), 'the talk to end');
    expect(server.logged.lines.find((line) => line.msg === 'talk ended')).toMatchObject({ npc: 'bavko', why: 'left' });
  });
});

describe('quests finished by events', () => {
  it('counts a rest, a won battle and a befriending, and refuses a talk in a battle', async () => {
    const who = await server.player('Busy Courier', besideNpc('vetrinka'), { team: [strong()], inventory: [{ item: favourite(), count: 1 }] });
    const offer = await talk(who, 'vetrinka');
    expect((await who.box.take<QuestChanged>('quest.changed')).change).toBe('started');
    await send(who, 'talk.end', { conversation: offer.conversation });
    await who.box.take<TalkEnded>('talk.ended');

    who.room.send('walk.to', map().shrines['post-shrine']!);
    expect(await who.box.take<QuestChanged>('quest.changed')).toEqual({ quest: 'test-rounds', change: 'step', step: 1, rewards: null, cue: null });
    await who.box.take('storage');

    // Tobolko stands beside the grass, so a battle there is in reach of a talk.
    who.room.send('walk.to', intoGrass());
    const started = await who.box.take<BattleUpdate>('battle.started');
    await send(who, 'talk.start', { npc: 'tobolko' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'talk.start', reason: 'inBattle' });
    await fightToTheEnd(who, started.battle.phase);
    expect((await who.box.take<BattleResult>('battle.result')).outcome.winner).toBe(0);
    expect(await who.box.take<QuestChanged>('quest.changed')).toEqual({ quest: 'test-rounds', change: 'step', step: 2, rewards: null, cue: null });

    // Out of the grass on its east side, and back in.
    const here = { x: me(who)!.x, y: me(who)!.y };
    await walkTo(who, { x: here.x + 1, y: here.y });
    who.room.send('walk.to', here);
    await who.box.take<BattleUpdate>('battle.started');
    await send(who, 'battle.treat', { itemId: favourite() });
    await who.box.take('battle.befriend');
    await who.box.take<BattleResult>('battle.result');
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-rounds', change: 'done', step: 3 });
    expect(server.stored(who.id)?.story.done).toEqual(['test-rounds']);
  });

  it('counts reaching a mark, teaches by the experience a quest gives, and offers a move as after a battle', async () => {
    const level = 14;
    const full = ['sun-ray', 'storm-tap', 'sun-call', 'heat-shimmer'];
    const learner = { ...newCreature('glowbun', level, server.world.battle), xp: xpToNextLevel(level) - 1, moves: full };
    const who = await server.player('Looking Courier', besideNpc('mehurka'), { team: [learner] });
    const offer = await talk(who, 'mehurka');
    await send(who, 'talk.end', { conversation: offer.conversation });
    await who.box.take<TalkEnded>('talk.ended');

    who.box.heard.length = 0;
    who.room.send('walk.to', beside(map(), map().marks['lookout']!));
    await who.box.take<StoryMessage>('story');
    expect(who.box.types()).toEqual(['quest.changed', 'move.offer', 'progress']);
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-walk', change: 'done', rewards: { xp: 1, creatures: [{ index: 0, xp: 1, level: level + 1 }] } });
    const move = await who.box.take<MoveOffer>('move.offer');
    expect(move).toMatchObject({ index: 0, move: 'sun-wallop', moves: full });
    expect((await who.box.take<ProgressMessage>('progress')).team[0]).toMatchObject({ level: level + 1, moves: full });

    await walkTo(who, besideNpc('mehurka'));
    await send(who, 'talk.start', { npc: 'mehurka' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'talk.start', reason: 'notNow' });
    await send(who, 'move.choose', { offer: move.offer, forget: 0 });
    expect((await who.box.take<ProgressMessage>('progress')).team[0]?.moves[0]).toBe('sun-wallop');

    // A node whose effect cannot happen is a content bug: refused, the talk ends, and it is logged.
    const done = await talk(who, 'mehurka');
    expect(done.node).toBe('done');
    await send(who, 'talk.next', { conversation: done.conversation, choice: null });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'talk.next', reason: 'invalid' });
    expect(await who.box.take<TalkEnded>('talk.ended')).toEqual({ conversation: done.conversation });
    expect(server.logged.lines).toContainEqual(expect.objectContaining({ msg: 'talk effect failed', npc: 'mehurka', node: 'done' }));
  });
});

/** Attacks until the battle is over, leaving a beaten wild creature. */
async function fightToTheEnd(who: Player, phase: string, steps = 0): Promise<void> {
  if (phase === 'over') return;
  if (steps > 40) throw new Error('the battle did not end');
  await send(who, phase === 'befriend' ? 'battle.run' : 'battle.move', phase === 'befriend' ? {} : { slot: 0 });
  return fightToTheEnd(who, (await who.box.take<BattleUpdate>('battle.turn')).battle.phase, steps + 1);
}
