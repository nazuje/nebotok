import {
  newCreature,
  type ArenaFight,
  type ArenaJoinMessage,
  type ArenaResultMessage,
  type CreatureInstance,
  type QuestChanged,
  type RoundsResult,
  type TalkEnded,
  type TalkNode,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ArenaRoom } from '../src/arena-room.ts';
import { until } from './helpers.ts';
import { WILD, beside, send, storyServer, type Player } from './story-server.ts';

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

const besideMehurka = () => beside(server.world.map, server.world.map.npcs['mehurka']!);
const me = ({ room }: Player) => room.state.players.get(room.sessionId);
const team = (): CreatureInstance[] => ['glowbun', 'pinwhirl', 'puddlepip'].map((species) => newCreature(species, 20, server.world.battle));

async function talkTo(who: Player): Promise<TalkNode> {
  await send(who, 'talk.start', { npc: 'mehurka' });
  return who.box.take<TalkNode>('talk.node');
}

async function next(who: Player, at: TalkNode, choice: number | null): Promise<void> {
  await send(who, 'talk.next', { conversation: at.conversation, choice });
}

/** From Mehurka's challenge, says yes and goes on from the fight node: the talk ends and the fight starts. */
async function acceptChallenge(who: Player, challenge: TalkNode): Promise<ArenaJoinMessage> {
  expect(challenge).toMatchObject({ node: 'challenge', choices: [0, 1] });
  await next(who, challenge, 0);
  const fight = await who.box.take<TalkNode>('talk.node');
  expect(fight).toMatchObject({ node: 'fight', choices: [] });
  await next(who, fight, null);
  expect(await who.box.take<TalkEnded>('talk.ended')).toEqual({ conversation: fight.conversation });
  return who.box.take<ArenaJoinMessage>('arena.join');
}

/** The arena room ends its best of 3 as `result`, as the rounds would have, and hands it to the world room. */
function endAs(join: ArenaJoinMessage, result: RoundsResult, winner: 0 | 1 | null) {
  const fight: ArenaFight = server.colyseus.getRoomById<ArenaRoom>(join.reservation.roomId).current;
  if (fight.mode !== 'rounds') throw new Error('expected a best of 3');
  server.fights.finish({ fightId: join.fightId, fight: { ...fight, outcome: { result, winner, tick: fight.tick } }, why: 'done' });
}

describe('trainer fights from a talk', () => {
  it('starts a best of 3 against the trainer from the talk, and a win gives the reward once, moves the quest on and opens the talk at won', async () => {
    const who = await server.player('Trainer Courier', besideMehurka(), { team: team() });
    const offer = await talkTo(who);
    expect(offer.node).toBe('trainer');
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-trainer', change: 'started' });
    await next(who, offer, null);
    const join = await acceptChallenge(who, await who.box.take<TalkNode>('talk.node'));
    await until(() => me(who)?.inBattle === true && me(who)?.talking === false, 'the courier to be fighting, not talking');
    const plan = server.fights.plan(join.fightId);
    expect(plan?.setup).toMatchObject({ mode: 'rounds' });
    if (plan?.setup.mode !== 'rounds') throw new Error('expected a best of 3');
    expect(plan.setup.picks[1].map(({ place, fighter }) => ({ place, species: fighter.species, level: fighter.level, computer: fighter.computer }))).toEqual(
      [1, 2, 3].map((level) => ({ place: null, species: WILD.species, level, computer: true })),
    );
    expect(plan.minds).toEqual([{ side: 1, mind: 'WILD' }]);
    expect(plan.pickers).toEqual([{ side: 0, team: plan.setup.picks[0] }]);

    endAs(join, 'won', 0);
    const winning = await who.box.take<ArenaResultMessage>('arena.result');
    expect(winning.outcome).toMatchObject({ result: 'won' });
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-trainer', change: 'done', step: 1 });
    const won = await who.box.take<TalkNode>('talk.node');
    expect(won).toMatchObject({ npc: 'mehurka', node: 'won', choices: [] });
    await until(() => me(who)?.inBattle === false && me(who)?.talking === true, 'the courier to be talking again');
    expect(server.stored(who.id)).toMatchObject({ inventory: [{ item: 'plain-treat', count: 3 }], story: { active: [], done: ['test-trainer'], flags: ['test-trainer-won'] } });
    await next(who, won, null);
    await who.box.take<TalkEnded>('talk.ended');

    // A rematch, lost: the talk goes on at lost, and the first win's treats are not given again.
    const rematch = await acceptChallenge(who, await talkTo(who));
    endAs(rematch, 'lost', 1);
    // A loss gives half of what the win gave for the same creature it faced.
    const losing = await who.box.take<ArenaResultMessage>('arena.result');
    const winXp = winning.rewards.find((reward) => reward.index === 0)?.xp ?? 0;
    expect(winXp).toBeGreaterThan(1);
    expect(losing.rewards.map((reward) => [reward.index, reward.xp])).toEqual([[0, Math.trunc(winXp / 2)]]);
    expect(await who.box.take<TalkNode>('talk.node')).toMatchObject({ node: 'lost' });
    expect(server.stored(who.id)?.inventory).toEqual([{ item: 'plain-treat', count: 3 }]);
    expect(server.logged.lines.filter((line) => line['msg'] === 'fight planned')).toEqual([expect.objectContaining({ trainer: 'test-trainer' }), expect.objectContaining({ trainer: 'test-trainer' })]);
  });

  it('refuses a choice at the fight node', async () => {
    const who = await server.player('Choosing Courier', besideMehurka(), { team: team() });
    const offer = await talkTo(who);
    await next(who, offer, null);
    const challenge = await who.box.take<TalkNode>('talk.node');
    await next(who, challenge, 0);
    const fight = await who.box.take<TalkNode>('talk.node');
    await next(who, fight, 0);
    expect(await who.box.take('refused')).toEqual({ request: 'talk.next', reason: 'invalid' });
    expect(me(who)?.talking).toBe(true);
  });
});

describe('trainer fights with arena fights off', () => {
  let off: Awaited<ReturnType<typeof storyServer>>;
  beforeAll(async () => {
    off = await storyServer({ arenaBattles: false });
  });
  afterAll(async () => {
    await off.close();
  });

  it('never offers the trainer quest or the challenge', async () => {
    const who = await off.player('Quiet Courier', beside(off.world.map, off.world.map.npcs['mehurka']!), { team: [newCreature('glowbun', 20, off.world.battle)] });
    await send(who, 'talk.start', { npc: 'mehurka' });
    expect(await who.box.take<TalkNode>('talk.node')).toMatchObject({ node: 'offer' });
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: 'test-walk', change: 'started' });
  });
});
