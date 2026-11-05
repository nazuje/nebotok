import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lib/server-process.mjs';

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const images = (text) => [...text.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((match) => match[1]);
const litestream = (text) => images(text).filter((image) => image.startsWith('litestream/'));
/** The text of one top-level service, from its key to the next service, the networks or the volumes. */
const service = (text, name) => text.slice(text.indexOf(`\n  ${name}:\n`) + 1).split(/\n {2}(?=\w[\w-]*:\n)|\n(?:networks|volumes):/)[0];
/** An IPv4 CIDR range as its first and last address, as numbers. */
function range(cidr) {
  const [address, bits] = cidr.split('/');
  const start = address.split('.').reduce((total, octet) => total * 256 + Number(octet), 0);
  return [start, start + 2 ** (32 - Number(bits)) - 1];
}
const COMPOSE_FILES = ['compose.yaml', 'compose.tailscale.yaml', 'compose.local.yaml'];

const hasDocker = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' }).status === 0;
/** `docker compose config` as JSON, isolated from any real .env with an empty env file. */
function composeConfig(files, settings = {}) {
  const envFile = join(mkdtempSync(join(tmpdir(), 'nebotok-compose-test-')), 'empty');
  writeFileSync(envFile, '');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, NEBOTOK_DIGEST: `sha256:${'0'.repeat(64)}`, TS_AUTHKEY: 'tskey-auth-test', NEBOTOK_LOCAL_BACKUP_DIR: tmpdir(), ...settings };
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

  it('never let the game believe forwarded addresses from just anyone', () => {
    for (const file of COMPOSE_FILES) {
      for (const [, value] of read(file).matchAll(/TRUST_PROXY:\s*(.*)/g)) expect(value.trim()).not.toMatch(/^["']?(true|\*|\d+)["']?$|\/0\b/);
    }
  });

  it.skipIf(!hasDocker)('trust in host mode exactly the gateway Docker forwards the published port from', () => {
    const subnets = ['compose.yaml', 'compose.local.yaml'].map((file) => {
      const { services, networks } = composeConfig([file]);
      const [ipam, ...more] = networks.default.ipam.config;
      expect(more).toEqual([]);
      expect(services.app.environment.TRUST_PROXY).toBe(ipam.gateway);
      expect(Object.keys(services.app.networks ?? { default: null })).toEqual(['default']);
      const [first, last] = range(ipam.subnet);
      const [gateway] = range(`${ipam.gateway}/32`);
      expect(gateway > first && gateway < last).toBe(true);
      return [first, last];
    });
    // Both stacks may run on one Mac, and Docker refuses overlapping networks.
    const [[productionFirst, productionLast], [localFirst, localLast]] = subnets;
    expect(localLast < productionFirst || localFirst > productionLast).toBe(true);
  });

  it.skipIf(!hasDocker)('move the network and the trusted gateway together with NEBOTOK_NETWORK', () => {
    const { services, networks } = composeConfig(['compose.yaml'], { NEBOTOK_NETWORK: '10.231.68' });
    expect(networks.default.ipam.config).toEqual([{ subnet: '10.231.68.0/28', gateway: '10.231.68.1' }]);
    expect(services.app.environment.TRUST_PROXY).toBe('10.231.68.1');
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
    expect(services.app.environment.TRUST_PROXY).toBe('loopback');
    expect(services.ts).toMatchObject({ read_only: true, cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'] });
  });
});
