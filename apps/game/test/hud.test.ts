import { describe, expect, it } from 'vitest';
import { welcomeLine } from '../src/hud.ts';

describe('the welcome line', () => {
  it('says what the server said while nothing has changed', () => {
    expect(welcomeLine('welcome.alone', false)).toBe('welcome.alone');
    expect(welcomeLine('welcome.together', true)).toBe('welcome.together');
    expect(welcomeLine('welcome.alone', null)).toBe('welcome.alone');
  });

  it('says others are here as soon as someone arrives', () => {
    expect(welcomeLine('welcome.alone', true)).toBe('welcome.together');
  });

  it('goes away once the others it spoke of have left', () => {
    expect(welcomeLine('welcome.together', false)).toBeNull();
  });

  it('stays hidden once hidden', () => {
    expect(welcomeLine(null, true)).toBeNull();
    expect(welcomeLine(null, false)).toBeNull();
  });
});
