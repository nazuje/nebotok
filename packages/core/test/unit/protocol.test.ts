import { describe, expect, it } from 'vitest';
import {
  BattleMoveMessage,
  BattleRunMessage,
  BattleSwitchMessage,
  BattleTreatMessage,
  CLIENT_MESSAGES,
  MoveChooseMessage,
  PROTOCOL_VERSION,
  SERVER_MESSAGES,
  StarterChooseMessage,
  StorageSwapMessage,
  TalkEndMessage,
  TalkNextMessage,
  TalkStartMessage,
  TeamReorderMessage,
  WalkHoldMessage,
  WalkStopMessage,
  WalkToMessage,
  battleStep,
  battleView,
  createRng,
  emptyProgress,
  isCompatibleProtocol,
  progressMessage,
  startBattle,
  talkNodeMessage,
  walkMessage,
  welcome,
} from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';
import { storyContent } from '../support/story-content.ts';

describe('welcome', () => {
  const world = { name: 'sky' };

  it('greets the first player as alone', () => {
    expect(welcome(world, 1)).toEqual({ protocol: PROTOCOL_VERSION, world: 'sky', playerCount: 1, messageKey: 'welcome.alone' });
  });

  it('tells a later player that others are here', () => {
    expect(welcome(world, 3).messageKey).toBe('welcome.together');
  });

  it('refuses a world with nobody in it', () => {
    expect(() => welcome(world, 0)).toThrow(RangeError);
    expect(() => welcome(world, 1.5)).toThrow(RangeError);
  });

  it('accepts only the same protocol', () => {
    expect(isCompatibleProtocol(PROTOCOL_VERSION)).toBe(true);
    expect(isCompatibleProtocol(PROTOCOL_VERSION + 1)).toBe(false);
  });
});

describe('walk messages', () => {
  const from = { x: 4, y: 5 };

  it('carry the tile the client planned from, in shapes the server accepts', () => {
    const to = walkMessage({ kind: 'to', target: { x: 1, y: 2 } }, from);
    expect(to).toEqual({ type: CLIENT_MESSAGES.walkTo, payload: { x: 1, y: 2, from } });
    expect(WalkToMessage.parse(to.payload)).toEqual({ x: 1, y: 2, from });
    expect(WalkHoldMessage.parse(walkMessage({ kind: 'hold', direction: 'up' }, from).payload)).toEqual({ direction: 'up', from });
    expect(WalkStopMessage.parse(walkMessage({ kind: 'stop' }, from).payload)).toEqual({ from });
  });

  it('still accept a walk without a tile to plan from, and refuse anything else', () => {
    expect(WalkToMessage.parse({ x: 1, y: 2 })).toEqual({ x: 1, y: 2 });
    expect(WalkToMessage.safeParse({ x: 1, y: 2, from: { x: -1, y: 0 } }).success).toBe(false);
    expect(WalkStopMessage.safeParse({ from: { x: 1, y: 2, z: 3 } }).success).toBe(false);
  });
});

describe('battle and team messages', () => {
  it('have one type each', () => {
    for (const types of [Object.values(CLIENT_MESSAGES), Object.values(SERVER_MESSAGES)]) expect(new Set(types).size).toBe(types.length);
  });

  it('accept what a client should send and refuse the rest', () => {
    expect(BattleMoveMessage.parse({ slot: 3 })).toEqual({ slot: 3 });
    expect(BattleMoveMessage.safeParse({ slot: 4 }).success).toBe(false);
    expect(BattleSwitchMessage.safeParse({ index: 6 }).success).toBe(false);
    expect(BattleTreatMessage.safeParse({ itemId: 'Plain Treat' }).success).toBe(false);
    expect(BattleRunMessage.safeParse({ now: true }).success).toBe(false);
    expect(TeamReorderMessage.safeParse({ order: [1, 0, 2] }).success).toBe(true);
    expect(TeamReorderMessage.safeParse({ order: [1, 1, 2] }).success).toBe(false);
    expect(TeamReorderMessage.safeParse({ order: [1, 2] }).success).toBe(false);
    expect(StorageSwapMessage.safeParse({ team: 0, storage: null }).success).toBe(true);
    expect(StorageSwapMessage.safeParse({ team: null, storage: null }).success).toBe(false);
    expect(StorageSwapMessage.safeParse({ team: 0, storage: 200 }).success).toBe(false);
    expect(StarterChooseMessage.safeParse({ species: 'puddlepip' }).success).toBe(true);
    expect(MoveChooseMessage.parse({ offer: 1, forget: 3 })).toEqual({ offer: 1, forget: 3 });
    expect(MoveChooseMessage.parse({ offer: 2, forget: null })).toEqual({ offer: 2, forget: null });
    expect(MoveChooseMessage.safeParse({ offer: 1, forget: 4 }).success).toBe(false);
    expect(MoveChooseMessage.safeParse({ offer: 0, forget: 0 }).success).toBe(false);
    expect(MoveChooseMessage.safeParse({ offer: 1 }).success).toBe(false);
    expect(MoveChooseMessage.safeParse({ offer: 1, forget: 0, index: 2 }).success).toBe(false);
  });

  it('show the player their battle without anything the opponent hides', () => {
    const { state } = startBattle({ sides: [{ creatures: [{ species: 'boltkit', level: 50 }] }, { creatures: [{ species: 'puddlepip', level: 3 }] }], weather: null, wild: true }, battleContent);
    const view = battleView('battle-1', state);
    expect(view).toMatchObject({ id: 'battle-1', phase: 'choose', mustSwap: false, canTreat: false, canRun: true, outcome: null });
    expect(view.team.creatures[0]!.moves).toHaveLength(4);
    expect(Object.keys(view.opponent.creatures[0]!).toSorted()).toEqual(['hp', 'id', 'level', 'maxHp', 'species', 'type']);
    const beaten = battleView('battle-1', battleStep(state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], createRng(1), battleContent).state);
    expect(beaten).toMatchObject({ phase: 'befriend', canTreat: true, canRun: true });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });

  it('tell a new player to choose a starter, without their storage', () => {
    const message = progressMessage(emptyProgress());
    expect(message.needsStarter).toBe(true);
    expect('storage' in message).toBe(false);
  });
});

describe('talk messages', () => {
  it('accept what a client should send and refuse the rest', () => {
    expect(TalkStartMessage.parse({ npc: 'bavko' })).toEqual({ npc: 'bavko' });
    expect(TalkStartMessage.safeParse({ npc: 'Bavko' }).success).toBe(false);
    expect(TalkStartMessage.safeParse({ npc: 'bavko', node: 'welcome' }).success).toBe(false);
    expect(TalkNextMessage.parse({ conversation: 3, choice: 2 })).toEqual({ conversation: 3, choice: 2 });
    expect(TalkNextMessage.parse({ conversation: 3, choice: null })).toEqual({ conversation: 3, choice: null });
    for (const bad of [{ conversation: 3, choice: 3 }, { conversation: 0, choice: null }, { conversation: 3 }, { conversation: 1.5, choice: 0 }]) expect(TalkNextMessage.safeParse(bad).success).toBe(false);
    expect(TalkEndMessage.safeParse({ conversation: 3 }).success).toBe(true);
    expect(TalkEndMessage.safeParse({}).success).toBe(false);
  });

  it('show the node a player is at, with the choices they may pick, and keep the story out of progress', () => {
    expect(talkNodeMessage(7, { npc: 'bavko', node: 'first-friend' }, emptyProgress(), storyContent)).toEqual({ conversation: 7, npc: 'bavko', node: 'first-friend', choices: [], cue: 'offerStarter' });
    expect(talkNodeMessage(7, { npc: 'bavko', node: 'offer' }, emptyProgress(), storyContent)).toMatchObject({ choices: [0, 1], cue: null });
    expect(talkNodeMessage(7, { npc: 'bavko', node: 'nowhere' }, emptyProgress(), storyContent)).toBeNull();
    expect('story' in progressMessage(emptyProgress())).toBe(false);
  });
});
