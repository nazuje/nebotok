import { describe, expect, it } from 'vitest';
import { CLIENT_MESSAGES, PROTOCOL_VERSION, WalkHoldMessage, WalkStopMessage, WalkToMessage, isCompatibleProtocol, walkMessage, welcome } from '../../src/index.ts';

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
