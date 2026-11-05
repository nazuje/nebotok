import { describe, expect, it } from 'vitest';
import { cidrRange, livePorts, localStack, pickNetwork } from './local-stack.mjs';

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

  it('refuses the live game\'s port, 8567 or NEBOTOK_PORT', async () => {
    const network = { NEBOTOK_LOCAL_NETWORK: '10.231.150' };
    await expect(localStack('/work/one', { ...network, NEBOTOK_LOCAL_PORT: '8567' })).rejects.toThrow(/NEBOTOK_LOCAL_PORT 8567/);
    await expect(localStack('/work/one', { ...network, NEBOTOK_LOCAL_PORT: '9100', NEBOTOK_PORT: '9100' })).rejects.toThrow(/NEBOTOK_LOCAL_PORT 9100/);
    await expect(localStack('/work/one', { ...network, NEBOTOK_LOCAL_PORT: '8567x' })).rejects.toThrow(/NEBOTOK_LOCAL_PORT/);
    await expect(localStack('/work/one', { ...network, NEBOTOK_LOCAL_PORT: '9100', NEBOTOK_PORT: '9200' })).resolves.toMatchObject({ port: '9100' });
  });

  it('takes only a network from 10.231.100 to 10.231.199', async () => {
    const port = { NEBOTOK_LOCAL_PORT: '41000' };
    const refused = ['10.231.67', '10.231.99', '10.231.200', '10.231.1000', '10.231.150.0', '192.168.150', '10.231.1x0'];
    await Promise.all(refused.map((network) => expect(localStack('/work/one', { ...port, NEBOTOK_LOCAL_NETWORK: network })).rejects.toThrow(/NEBOTOK_LOCAL_NETWORK/)));
    await expect(localStack('/work/one', { ...port, NEBOTOK_LOCAL_NETWORK: '10.231.100' })).resolves.toMatchObject({ network: '10.231.100' });
    await expect(localStack('/work/one', { ...port, NEBOTOK_LOCAL_NETWORK: '10.231.199' })).resolves.toMatchObject({ network: '10.231.199' });
  });
});

describe('livePorts', () => {
  it('is 8567, and NEBOTOK_PORT when it is set', () => {
    expect(livePorts({})).toEqual([8567]);
    expect(livePorts({ NEBOTOK_PORT: '9100' })).toEqual([8567, 9100]);
  });
});
