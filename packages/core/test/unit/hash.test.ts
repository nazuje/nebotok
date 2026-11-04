import { describe, expect, it } from 'vitest';
import { canonicalJson, stableHash } from '../../src/index.ts';

describe('stable hash', () => {
  it('ignores key order', () => {
    expect(canonicalJson({ b: 1, a: [true, null, 'x'] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(stableHash({ b: 1, a: 2 })).toBe(stableHash({ a: 2, b: 1 }));
  });

  it('changes when the data changes', () => {
    expect(stableHash([1, 2, 3])).not.toBe(stableHash([1, 2, 4]));
  });

  it('is pinned, so a change to the hash itself is noticed', () => {
    expect(stableHash({ hello: 'nebotok' })).toBe('0551e336140fb1');
  });

  it('refuses numbers JSON cannot carry', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
  });
});
