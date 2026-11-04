import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, isCompatibleProtocol, welcome } from '../../src/index.ts';

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
