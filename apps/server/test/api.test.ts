import type { AddressInfo } from 'node:net';
import { PIN_ATTEMPTS, type LoginResponse, type ProfileSummary } from '@nebotok/core';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { API_LIMITS } from '../src/api.ts';
import { mountHttp } from '../src/http.ts';
import { createLog } from '../src/log.ts';
import { fakeClock, repeat, tempServices } from './helpers.ts';

const clock = fakeClock();
let temp: ReturnType<typeof tempServices>;
let base: string;
let close: () => void;

beforeAll(async () => {
  temp = tempServices(clock.now);
  const app = express();
  mountHttp(app, temp.config, createLog('silent'), temp.services);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
afterAll(() => {
  close();
  temp.dispose();
});
beforeEach(() => {
  temp.services.db.exec('DELETE FROM players');
  // Each test starts with fresh rate limits.
  clock.advance(60_000);
});

type Sent = { status: number; body: unknown; headers: Headers };

async function send(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Sent> {
  const init: RequestInit = { method, headers: { origin: base, 'content-type': 'application/json', ...headers } };
  if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const response = await fetch(`${base}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text === '' ? null : JSON.parse(text), headers: response.headers };
}

async function create(name: string, pin?: string): Promise<ProfileSummary> {
  const response = await send('POST', '/api/profiles', pin === undefined ? { name, avatar: 'red' } : { name, avatar: 'red', pin });
  expect(response.status).toBe(201);
  return response.body as ProfileSummary;
}

describe('profile API', () => {
  it('creates a profile and lists it, never with a PIN', async () => {
    const made = await create('Čmrljček Šumež', '1234');
    expect(made).toEqual({ id: made.id, name: 'Čmrljček Šumež', avatar: 'red', hasPin: true, lockedForSeconds: 0 });
    const listed = await send('GET', '/api/profiles');
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([made]);
    expect(listed.headers.get('cache-control')).toBe('no-store');
    expect(listed.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('refuses a duplicate name, a bad name and a bad PIN', async () => {
    await create('Test Courier');
    expect(await send('POST', '/api/profiles', { name: 'test courier', avatar: 'red' })).toMatchObject({ status: 409, body: { error: 'nameTaken' } });
    expect(await send('POST', '/api/profiles', { name: 'R2D2', avatar: 'red' })).toMatchObject({ status: 400, body: { error: 'nameInvalid' } });
    expect(await send('POST', '/api/profiles', { name: 'Fine', avatar: 'red', pin: '12' })).toMatchObject({ status: 400, body: { error: 'pinInvalid' } });
    expect(await send('POST', '/api/profiles', { name: 'Fine', avatar: 'red', admin: true })).toMatchObject({ status: 400 });
  });

  it('logs in with the right PIN and refuses a wrong one', async () => {
    const { id } = await create('Test Courier', '2468');
    expect(await send('POST', '/api/sessions', { profileId: id, pin: '1357' })).toMatchObject({ status: 401, body: { error: 'pinWrong' } });
    const login = await send('POST', '/api/sessions', { profileId: id, pin: '2468' });
    expect(login.status).toBe(200);
    const { token, profile } = login.body as LoginResponse;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(profile).toMatchObject({ id, hasPin: true });
    expect(temp.services.profiles.authenticate(token)).toBe(id);
  });

  it(`locks a profile after ${PIN_ATTEMPTS} wrong PINs and says for how long`, async () => {
    const { id } = await create('Test Courier', '2468');
    const wrong = await repeat(PIN_ATTEMPTS - 1, async () => (await send('POST', '/api/sessions', { profileId: id, pin: '0000' })).status);
    expect(wrong).toEqual(Array.from({ length: PIN_ATTEMPTS - 1 }, () => 401));
    const locked = await send('POST', '/api/sessions', { profileId: id, pin: '0000' });
    expect(locked).toMatchObject({ status: 423, body: { error: 'locked', retryAfterSeconds: 60 } });
    expect(locked.headers.get('retry-after')).toBe('60');
    expect((await send('POST', '/api/sessions', { profileId: id, pin: '2468' })).status).toBe(423);
  });

  it('gives a new token at each login, so an old one stops working', async () => {
    const { id } = await create('Test Courier');
    const first = (await send('POST', '/api/sessions', { profileId: id })).body as LoginResponse;
    const second = (await send('POST', '/api/sessions', { profileId: id })).body as LoginResponse;
    expect(first.token).not.toBe(second.token);
    expect(temp.services.profiles.authenticate(first.token)).toBeNull();
    expect(temp.services.profiles.authenticate(second.token)).toBe(id);
  });

  it('logs out, after which the token no longer works', async () => {
    const { id } = await create('Test Courier');
    const { token } = (await send('POST', '/api/sessions', { profileId: id })).body as LoginResponse;
    expect((await send('DELETE', '/api/sessions/current', undefined, { authorization: `Bearer ${token}` })).status).toBe(204);
    expect(temp.services.profiles.authenticate(token)).toBeNull();
    expect((await send('DELETE', '/api/sessions/current', undefined, { authorization: `Bearer ${token}` })).status).toBe(204);
  });

  it('answers an unknown profile with 404', async () => {
    expect(await send('POST', '/api/sessions', { profileId: 99_999 })).toMatchObject({ status: 404, body: { error: 'unknown' } });
  });
});

describe('API guards', () => {
  it('refuses a change from another origin or without one', async () => {
    expect((await send('POST', '/api/profiles', { name: 'Test Courier', avatar: 'red' }, { origin: 'https://elsewhere.example' })).status).toBe(403);
    const bare = await fetch(`${base}/api/profiles`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(bare.status).toBe(403);
    expect(temp.services.profiles.list()).toEqual([]);
  });

  it('believes the forwarded host only from the proxy on this machine', async () => {
    const response = await send('POST', '/api/profiles', { name: 'Test Courier', avatar: 'red' }, { origin: 'https://nebotok.example', 'x-forwarded-host': 'nebotok.example' });
    // The test client is on loopback, which is where Tailscale Serve connects from.
    expect(response.status).toBe(201);
  });

  it('refuses a body that is not JSON, malformed or too big, without a stack trace', async () => {
    expect((await send('POST', '/api/profiles', 'name=x', { 'content-type': 'application/x-www-form-urlencoded' })).status).toBe(415);
    const malformed = await send('POST', '/api/profiles', '{"name":');
    expect(malformed).toMatchObject({ status: 400, body: { error: 'unknown' } });
    const big = await send('POST', '/api/profiles', { name: 'x'.repeat(2_000), avatar: 'red' });
    expect(big).toMatchObject({ status: 413, body: { error: 'unknown' } });
    expect(JSON.stringify([malformed.body, big.body])).not.toMatch(/at |\.ts|node_modules/);
  });

  it('answers an unknown API path with 404 JSON', async () => {
    expect(await send('GET', '/api/nope')).toMatchObject({ status: 404, body: { error: 'unknown' } });
  });

  it(`slows down more than ${API_LIMITS.logins} logins a minute from one address`, async () => {
    const { id } = await create('Test Courier');
    const statuses = await Promise.all(Array.from({ length: API_LIMITS.logins }, () => send('POST', '/api/sessions', { profileId: id }).then((sent) => sent.status)));
    expect(statuses.filter((status) => status === 200).length + statuses.filter((status) => status === 429).length).toBe(API_LIMITS.logins);
    const last = await send('POST', '/api/sessions', { profileId: id });
    expect(last).toMatchObject({ status: 429, body: { error: 'busy' } });
    expect(Number(last.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('maps', () => {
  it('serves the start map and its tileset', async () => {
    const mapResponse = await fetch(`${base}/maps/${temp.services.world.map.id}.tmj`);
    expect(mapResponse.status).toBe(200);
    expect(mapResponse.headers.get('content-type')).toContain('application/json');
    expect(((await mapResponse.json()) as { width: number }).width).toBe(temp.services.world.map.width);
    const tiles = await fetch(`${base}/maps/sky-tiles.png`);
    expect(tiles.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${base}/maps/..%2Fworld.json`)).status).toBe(404);
  });
});
