import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './lib/server-process.mjs';

const read = (file) => readFileSync(join(ROOT, file), 'utf8');
const images = (text) => [...text.matchAll(/^\s*image:\s*(\S+)\s*$/gm)].map((match) => match[1]);
const litestream = (text) => images(text).filter((image) => image.startsWith('litestream/'));

describe('compose files', () => {
  it('pin every third-party image by digest', () => {
    const thirdParty = [...images(read('compose.yaml')), ...images(read('compose.local.yaml'))].filter((image) => !image.startsWith('ghcr.io/nazuje/') && image !== 'nebotok:local');
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
      const app = text.slice(text.indexOf('\n  app:'), text.indexOf('\n  litestream:'));
      const volumes = /\n {4}volumes:\n((?: {6}- .*\n)+)/.exec(app)?.[1] ?? '';
      expect(volumes.trim().split('\n').map((line) => line.trim())).toEqual(['- nebotok-data:/data']);
      expect(app).not.toContain('type: bind');
      expect(text.slice(text.indexOf('\n  litestream:'))).toMatch(/target: \/backups\n\s*bind:\n\s*create_host_path: false/);
    }
  });
});
