import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readConfig } from '../src/config.ts';
import { cacheControlFor, mountHttp } from '../src/http.ts';
import { createLog } from '../src/log.ts';
import { tempServices } from './helpers.ts';

describe('cache rules', () => {
  it('long-caches hashed assets and re-checks everything else', () => {
    expect(cacheControlFor('assets/index-3f9a1c.js')).toBe('public, max-age=31536000, immutable');
    expect(cacheControlFor('index.html')).toBe('no-cache');
    expect(cacheControlFor('sw.js')).toBe('no-cache');
    expect(cacheControlFor('manifest.webmanifest')).toBe('no-cache');
  });
});

describe('serving the built game', () => {
  const temp = tempServices();
  let dist: string;
  let base: string;
  let close: () => void;

  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), 'nebotok-dist-'));
    mkdirSync(join(dist, 'assets'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Nebotok</title>');
    writeFileSync(join(dist, 'sw.js'), 'self.addEventListener("fetch", () => {});');
    writeFileSync(join(dist, 'assets', 'index-abc123.js'), 'console.log(1);');
    const app = express();
    mountHttp(app, readConfig({ NODE_ENV: 'production', GAME_DIST: dist }), createLog('silent'), temp.services);
    const server = app.listen(0);
    await new Promise((resolve) => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    close = () => server.close();
  });
  afterAll(() => {
    close();
    rmSync(dist, { recursive: true, force: true });
    temp.dispose();
  });

  it('serves index.html at / and asks the browser to re-check it', async () => {
    const response = await fetch(`${base}/`);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('never long-caches the service worker', async () => {
    expect((await fetch(`${base}/sw.js`)).headers.get('cache-control')).toBe('no-cache');
  });

  it('long-caches hashed assets', async () => {
    const response = await fetch(`${base}/assets/index-abc123.js`);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
  });

  it('answers a missing file with 404', async () => {
    expect((await fetch(`${base}/nope.js`)).status).toBe(404);
  });

  it('refuses to start in production without a build', () => {
    const app = express();
    const config = readConfig({ NODE_ENV: 'production', GAME_DIST: join(dist, 'missing') });
    expect(() => mountHttp(app, config, createLog('silent'), temp.services)).toThrow(/npm run build/);
  });
});
