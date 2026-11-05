import { describe, expect, it } from 'vitest';
import { cidrRange, localStack, pickNetwork } from './local-stack.mjs';

describe('pickNetwork', () => {
  it('starts where it is told and skips subnets already in use', () => {
    expect(pickNetwork([], 5)).toBe('10.231.105');
    expect(pickNetwork(['10.231.105.0/24', 'fd00::/64'], 5)).toBe('10.231.106');
    expect(pickNetwork(['10.231.105.16/28', '10.231.106.0/28'], 5)).toBe('10.231.106');
  });

  it('wraps round, and gives up when a wide range covers every choice', () => {
    expect(pickNetwork(['10.231.199.0/24'], 99)).toBe('10.231.100');
    expect(pickNetwork(['10.231.0.0/16'], 0)).toBeNull();
  });

  it('never picks production\'s default network', () => {
    const production = cidrRange('10.231.67.0/28');
    for (let start = 0; start < 100; start += 1) {
      const [first, last] = cidrRange(`${pickNetwork([], start)}.16/28`);
      expect(last < production[0] || first > production[1]).toBe(true);
    }
  });
});

describe('localStack', () => {
  it('names the project and image after the worktree, and keeps settings it is given', async () => {
    const env = { NEBOTOK_LOCAL_NETWORK: '10.231.150', NEBOTOK_LOCAL_PORT: '41000', COMPOSE_PROJECT_NAME: 'nebotok' };
    const one = await localStack('/work/one', env);
    const again = await localStack('/work/one', env);
    const two = await localStack('/work/two', env);
    expect(one).toEqual(again);
    expect(one.project).toMatch(/^nebotok-local-[0-9a-f]{8}$/);
    expect(one.image).toBe(`nebotok:local-${one.project.slice('nebotok-local-'.length)}`);
    expect(two.project).not.toBe(one.project);
    expect(one).toMatchObject({ network: '10.231.150', port: '41000' });
  });
});
