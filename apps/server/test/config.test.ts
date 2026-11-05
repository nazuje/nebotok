import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';
import { colyseusLogger, createLog } from '../src/log.ts';

describe('config', () => {
  it('has safe defaults', () => {
    const config = readConfig({});
    expect(config).toMatchObject({ port: 2567, host: '0.0.0.0', production: false, logLevel: 'info' });
    // Outside the container the database lives in a folder git ignores.
    expect(config.dataDir).toMatch(/[/\\]\.local-data[/\\]$/);
  });

  it('reads the environment', () => {
    const config = readConfig({ PORT: '8080', HOST: '127.0.0.1', DATA_DIR: '/data', NODE_ENV: 'production' });
    expect(config).toMatchObject({ port: 8080, host: '127.0.0.1', dataDir: '/data', production: true });
  });

  it('fails loudly on a bad port', () => {
    expect(() => readConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: '70000' })).toThrow(/PORT/);
  });

  it('trusts only a loopback proxy by default, and exactly the peers TRUST_PROXY names', () => {
    expect(readConfig({}).trustProxy).toEqual(['loopback']);
    expect(readConfig({ TRUST_PROXY: '10.231.67.1' }).trustProxy).toEqual(['10.231.67.1']);
    expect(readConfig({ TRUST_PROXY: 'loopback, 10.0.0.0/8,fd00::/8' }).trustProxy).toEqual(['loopback', '10.0.0.0/8', 'fd00::/8']);
  });

  it.each(['true', '*', 'false', '1', '', 'loopback,', 'uniquelocal', '0.0.0.0/0', '::/0', '10.0.0.0/33', '10.0.0.0/8/1', 'proxy.example', '10.0.0.0/255.0.0.0'])(
    'refuses TRUST_PROXY=%j, which would believe anyone or cannot be read',
    (value) => {
      expect(() => readConfig({ TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
    },
  );
});

describe('log', () => {
  it('writes one JSON object per line and respects the level', () => {
    const lines: string[] = [];
    const log = createLog('info', (line) => lines.push(line));
    log.debug('hidden');
    log.info('hello', { port: 1 });
    log.error('boom', { error: new Error('bad') });
    expect(lines).toHaveLength(2);
    const [first, second] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(first).toMatchObject({ level: 'info', msg: 'hello', port: 1 });
    expect(second).toMatchObject({ level: 'error', msg: 'boom', error: { name: 'Error', message: 'bad' } });
  });

  it('folds Colyseus console-style calls into JSON', () => {
    const lines: string[] = [];
    colyseusLogger(createLog('debug', (line) => lines.push(line))).warn('room %s full', 'sky');
    expect(JSON.parse(lines[0] ?? '{}')).toMatchObject({ level: 'warn', msg: 'room sky full', source: 'colyseus' });
  });
});
