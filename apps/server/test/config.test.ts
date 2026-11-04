import { describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';
import { colyseusLogger, createLog } from '../src/log.ts';

describe('config', () => {
  it('has safe defaults', () => {
    const config = readConfig({});
    expect(config).toMatchObject({ port: 2567, host: '0.0.0.0', dataDir: undefined, production: false, logLevel: 'info' });
  });

  it('reads the environment', () => {
    const config = readConfig({ PORT: '8080', HOST: '127.0.0.1', DATA_DIR: '/data', NODE_ENV: 'production' });
    expect(config).toMatchObject({ port: 8080, host: '127.0.0.1', dataDir: '/data', production: true });
  });

  it('fails loudly on a bad port', () => {
    expect(() => readConfig({ PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => readConfig({ PORT: '70000' })).toThrow(/PORT/);
  });
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
