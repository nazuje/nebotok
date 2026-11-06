import type { ProgressMessage, Refused, TalkEnded, TalkNode } from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { beside, send, storyServer } from './story-server.ts';

// The rule STARTER_NEEDS_TALK turns on: talk-room.test.ts plays the server's default.
let server: Awaited<ReturnType<typeof storyServer>>;
beforeAll(async () => {
  server = await storyServer(true);
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});

describe('the starter, once it needs a talk', () => {
  it('refuses starter.choose until the player is at the node that offers it', async () => {
    const who = await server.player('Patient Courier', beside(server.world.map, server.world.map.npcs['bavko']!));
    await send(who, 'starter.choose', { species: 'puddlepip' });
    expect(await who.box.take<Refused>('refused')).toEqual({ request: 'starter.choose', reason: 'notTalking' });
    await send(who, 'talk.start', { npc: 'bavko' });
    const welcome = await who.box.take<TalkNode>('talk.node');
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
