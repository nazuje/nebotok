import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProfile, listProfiles, login } from '../src/api.ts';
import { noticeFor } from '../src/profile-screen.ts';

const answer = (status: number, body: unknown) => vi.fn<typeof fetch>(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
const profile = { id: 3, name: 'Kro Tel Abc', avatar: 'green', hasPin: true, lockedForSeconds: 0 };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('profile API client', () => {
  it('reads a profile list', async () => {
    vi.stubGlobal('fetch', answer(200, [profile]));
    expect(await listProfiles()).toEqual({ ok: true, value: [profile] });
  });

  it('sends the PIN only when there is one', async () => {
    const fetch = answer(201, profile);
    vi.stubGlobal('fetch', fetch);
    await createProfile('Kro Tel Abc', 'green', undefined);
    await createProfile('Kro Tel Abc', 'green', '2580');
    const bodies = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)));
    expect(bodies).toEqual([{ name: 'Kro Tel Abc', avatar: 'green' }, { name: 'Kro Tel Abc', avatar: 'green', pin: '2580' }]);
  });

  it('passes on the server’s error and how long to wait', async () => {
    vi.stubGlobal('fetch', answer(401, { error: 'pinWrong' }));
    expect(await login(3, '1111')).toEqual({ ok: false, error: 'pinWrong' });
    vi.stubGlobal('fetch', answer(423, { error: 'locked', retryAfterSeconds: 42 }));
    expect(await login(3, '1111')).toEqual({ ok: false, error: 'locked', retryAfterSeconds: 42 });
  });

  it('calls a network failure or a proxy page unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await listProfiles()).toEqual({ ok: false, error: 'unreachable' });
    vi.stubGlobal('fetch', answer(502, '<html>Bad gateway</html>'));
    expect(await listProfiles()).toEqual({ ok: false, error: 'unreachable' });
  });

  it('treats an answer of the wrong shape as unknown', async () => {
    vi.stubGlobal('fetch', answer(200, [{ id: 'nope' }]));
    expect(await listProfiles()).toEqual({ ok: false, error: 'unknown' });
  });
});

describe('profile notices', () => {
  it('shows each API problem with its own string', () => {
    expect(noticeFor('pinWrong')).toBe('profile.error.pinWrong');
    expect(noticeFor('unreachable')).toBe('connection.unreachable');
  });
});
