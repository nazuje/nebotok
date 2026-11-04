import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lib/server-process.mjs';

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const images = (text) => [...text.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((match) => match[1]);
const litestream = (text) => images(text).filter((image) => image.startsWith('litestream/'));
/** The text of one top-level service, from its key to the next service or the volumes. */
const service = (text, name) => text.slice(text.indexOf(`\n  ${name}:\n`) + 1).split(/\n {2}(?=\w[\w-]*:\n)|\nvolumes:/)[0];
const COMPOSE_FILES = ['compose.yaml', 'compose.tailscale.yaml', 'compose.local.yaml'];

const hasDocker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
/** `docker compose config` as JSON, isolated from any real .env with an empty env file. */
function composeConfig(files) {
  const envFile = join(mkdtempSync(join(tmpdir(), 'nebotok-compose-test-')), 'empty');
  writeFileSync(envFile, '');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEBOTOK_DIGEST: `sha256:${'0'.repeat(64)}`, TS_AUTHKEY: 'tskey-auth-test' };
  const result = spawnSync('docker', ['compose', '--env-file', envFile, ...files.flatMap((file) => ['-f', file]), 'config', '--format', 'json'], { cwd: ROOT, env, encoding: 'utf8' });
  expect(result.stderr.replace(/.*level=warning.*\n?/g, '')).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

describe('compose files', () => {
  it('pin every third-party image by digest', () => {
    const thirdParty = COMPOSE_FILES.flatMap((file) => images(read(file))).filter((image) => !image.startsWith('ghcr.io/nazuje/') && image !== 'nebotok:local');
    expect(thirdParty.length).toBeGreaterThan(0);
    for (const image of thirdParty) expect(image).toMatch(/^[\w./-]+:[\w.-]+@sha256:[0-9a-f]{64}$/);
  });

  // Dependabot updates compose.yaml; this catches the local test falling behind.
  it('run the same Litestream image in production and in the local test', () => {
    const production = litestream(read('compose.yaml'));
    expect(production).toHaveLength(1);
    expect(litestream(read('compose.local.yaml'))).toEqual(production);
  });

  it('give no host folder to the game, and the backup folder only to Litestream', () => {
    for (const file of ['compose.yaml', 'compose.local.yaml']) {
      const text = read(file);
      const app = service(text, 'app');
      const volumes = /\n {4}volumes:\n((?: {6}- .*\n)+)/.exec(app)?.[1] ?? '';
      expect(volumes.trim().split('\n').map((line) => line.trim())).toEqual(['- nebotok-data:/data']);
      expect(app).not.toContain('type: bind');
      expect(service(text, 'litestream')).toMatch(/target: \/backups\n\s*bind:\n\s*create_host_path: false/);
    }
    expect(service(read('compose.tailscale.yaml'), 'app')).not.toContain('volumes:');
  });

  it('run no Tailscale in the default stack, and publish the game on 127.0.0.1 only', () => {
    const text = read('compose.yaml');
    expect(text).not.toMatch(/\n {2}ts:\n/);
    expect(text).not.toContain('TS_AUTHKEY');
    expect(service(text, 'app')).toMatch(/\n {4}ports:\n {6}- "127\.0\.0\.1:\$\{NEBOTOK_PORT:-8567\}:2567"\n(?! {6}-)/);
  });

  it('move the game into the Tailscale sidecar, without published ports, only in the override', () => {
    const app = service(read('compose.tailscale.yaml'), 'app');
    expect(app).toContain('network_mode: service:ts');
    expect(app).toContain('ports: !reset []');
  });

  it.skipIf(!hasDocker)('validate in host mode with every seal on the game', () => {
    const { services } = composeConfig(['compose.yaml']);
    expect(Object.keys(services).toSorted()).toEqual(['app', 'litestream']);
    const { app } = services;
    expect(app.ports).toEqual([expect.objectContaining({ host_ip: '127.0.0.1', published: '8567', target: 2567 })]);
    expect(app).toMatchObject({ read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], user: 'node', pids_limit: 200 });
    expect(app.volumes.map((volume) => `${volume.type}:${volume.source}`)).toEqual(['volume:nebotok-data']);
    expect(app.healthcheck.test.length).toBeGreaterThan(0);
    expect(services.litestream.network_mode).toBe('none');
  });

  it.skipIf(!hasDocker)('validate in sidecar mode with the game inside the Tailscale namespace', () => {
    const { services } = composeConfig(['compose.yaml', 'compose.tailscale.yaml']);
    expect(Object.keys(services).toSorted()).toEqual(['app', 'litestream', 'ts']);
    expect(services.app.network_mode).toBe('service:ts');
    expect(services.app.ports ?? []).toEqual([]);
    expect(services.app.environment.HOST).toBe('127.0.0.1');
    expect(services.ts).toMatchObject({ read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] });
  });
});
