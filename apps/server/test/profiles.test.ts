import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { MAX_PROFILES, PIN_ATTEMPTS, PIN_LOCK_MS, SAVE_VERSION, SaveError, createSave, emptyProgress } from '@nebotok/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PIN_LOCK_MAX_MS, SESSION_MS, sessionKey } from '../src/profiles.ts';
import { capturedLog, fakeClock, repeat, tempServices } from './helpers.ts';

let clock: ReturnType<typeof fakeClock>;
let temp: ReturnType<typeof tempServices>;
let logged: ReturnType<typeof capturedLog>['lines'];
beforeEach(() => {
  clock = fakeClock();
  const captured = capturedLog();
  logged = captured.lines;
  temp = tempServices(clock.now, captured.log);
});
afterEach(() => temp.dispose());

const profiles = () => temp.services.profiles;
async function created(name: string, pin?: string) {
  const result = await profiles().create(pin === undefined ? { name, avatar: 'blue' } : { name, avatar: 'blue', pin });
  if (!result.ok) throw new Error(`could not create ${name}: ${result.error}`);
  return result.value;
}
async function token(profileId: number, pin?: string) {
  const result = await profiles().login(pin === undefined ? { profileId } : { profileId, pin });
  if (!result.ok) throw new Error(`could not log in: ${result.error}`);
  return result.value.token;
}

describe('profiles', () => {
  it('lists profiles in the order they were made, without secrets', async () => {
    await created('Test Courier', '1234');
    clock.advance(1);
    await created('Čmrljček');
    expect(profiles().list()).toEqual([
      { id: 1, name: 'Test Courier', avatar: 'blue', hasPin: true, lockedForSeconds: 0 },
      { id: 2, name: 'Čmrljček', avatar: 'blue', hasPin: false, lockedForSeconds: 0 },
    ]);
  });

  it('stores only a salted hash of the PIN', async () => {
    await created('Test Courier', '1234');
    await created('Other Courier', '1234');
    const rows = temp.services.db.prepare('SELECT pin_hash, pin_salt FROM players').all() as { pin_hash: Uint8Array; pin_salt: Uint8Array }[];
    expect(rows).toHaveLength(2);
    expect(Buffer.from(rows[0]!.pin_hash).equals(Buffer.from(rows[1]!.pin_hash))).toBe(false);
    expect(Buffer.from(rows[0]!.pin_hash).toString('latin1')).not.toContain('1234');
  });

  it('refuses a name that differs only in capitals, an unknown avatar and a 21st profile', async () => {
    await created('Test Courier');
    expect(await profiles().create({ name: 'TEST COURIER', avatar: 'blue' })).toEqual({ ok: false, error: 'nameTaken' });
    expect(await profiles().create({ name: 'Another', avatar: 'rainbow' })).toEqual({ ok: false, error: 'unknown' });
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    await repeat(MAX_PROFILES - 1, (at) => created(`Courier ${letters[at]}`));
    expect(await profiles().create({ name: 'One Too Many', avatar: 'blue' })).toEqual({ ok: false, error: 'full' });
  });

  it('logs in a profile without a PIN, and checks the PIN of one with', async () => {
    const open = await created('Open');
    const closed = await created('Closed', '2468');
    expect((await profiles().login({ profileId: open.id })).ok).toBe(true);
    expect(await profiles().login({ profileId: closed.id })).toEqual({ ok: false, error: 'pinInvalid' });
    expect(await profiles().login({ profileId: closed.id, pin: '1111' })).toEqual({ ok: false, error: 'pinWrong' });
    expect((await profiles().login({ profileId: closed.id, pin: '2468' })).ok).toBe(true);
    expect(await profiles().login({ profileId: 99 })).toEqual({ ok: false, error: 'unknown' });
  });

  it(`locks a profile for a minute after ${PIN_ATTEMPTS} wrong PINs, even against the right one`, async () => {
    const { id } = await created('Closed', '2468');
    const wrong = await repeat(PIN_ATTEMPTS - 1, () => profiles().login({ profileId: id, pin: '0000' }));
    expect(wrong.map((result) => result.ok)).toEqual(Array.from({ length: PIN_ATTEMPTS - 1 }, () => false));
    expect(await profiles().login({ profileId: id, pin: '0000' })).toEqual({ ok: false, error: 'locked', retryAfterSeconds: 60 });
    expect(await profiles().login({ profileId: id, pin: '2468' })).toEqual({ ok: false, error: 'locked', retryAfterSeconds: 60 });
    expect(profiles().list()[0]?.lockedForSeconds).toBe(60);
    clock.advance(PIN_LOCK_MS);
    expect((await profiles().login({ profileId: id, pin: '2468' })).ok).toBe(true);
    expect(profiles().list()[0]?.lockedForSeconds).toBe(0);
  });

  it('doubles the lock each time it comes back, up to an hour, until a right PIN', async () => {
    const { id } = await created('Closed', '2468');
    const lockOnce = async () => (await repeat(PIN_ATTEMPTS, () => profiles().login({ profileId: id, pin: '0000' }))).at(-1);
    const locks = await repeat(8, async () => {
      const locked = await lockOnce();
      clock.advance((locked?.ok === false ? (locked.retryAfterSeconds ?? 0) : 0) * 1_000);
      return locked;
    });
    const seconds = [60, 120, 240, 480, 960, 1_920, PIN_LOCK_MAX_MS / 1_000, PIN_LOCK_MAX_MS / 1_000];
    expect(locks).toEqual(seconds.map((retryAfterSeconds) => ({ ok: false, error: 'locked', retryAfterSeconds })));
    await token(id, '2468');
    expect(await lockOnce()).toEqual({ ok: false, error: 'locked', retryAfterSeconds: 60 });
  });

  it('logs each lock as a warning with only the profile id', async () => {
    const { id } = await created('Closed', '2468');
    await repeat(PIN_ATTEMPTS, () => profiles().login({ profileId: id, pin: '0000' }));
    const locks = logged.filter((line) => line['msg'] === 'profile locked');
    expect(locks).toHaveLength(1);
    expect(locks[0]).toEqual({ time: expect.any(String), level: 'warn', msg: 'profile locked', profileId: id });
  });

  it('resets the count of wrong PINs after a right one', async () => {
    const { id } = await created('Closed', '2468');
    await repeat(PIN_ATTEMPTS - 1, () => profiles().login({ profileId: id, pin: '0000' }));
    await token(id, '2468');
    expect(await profiles().login({ profileId: id, pin: '0000' })).toEqual({ ok: false, error: 'pinWrong' });
  });

  it('checks one PIN at a time per profile', async () => {
    const { id } = await created('Closed', '2468');
    const [first, second] = await Promise.all([profiles().login({ profileId: id, pin: '0000' }), profiles().login({ profileId: id, pin: '1111' })]);
    expect(first).toEqual({ ok: false, error: 'pinWrong' });
    expect(second).toEqual({ ok: false, error: 'busy', retryAfterSeconds: 1 });
  });
});

describe('sessions', () => {
  it('stores only a hash of the token and recognises the token', async () => {
    const { id } = await created('Open');
    const issued = await token(id);
    expect(issued).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(profiles().authenticate(issued)).toBe(id);
    const stored = temp.services.db.prepare('SELECT token_hash FROM sessions').get() as { token_hash: Uint8Array };
    expect(Buffer.from(stored.token_hash).toString('base64url')).not.toBe(issued);
    for (const junk of [undefined, '', 'nope', 42, 'x'.repeat(500)]) expect(profiles().authenticate(junk)).toBeNull();
  });

  it('replaces the old session at each login', async () => {
    const { id } = await created('Open');
    const first = await token(id);
    const second = await token(id);
    expect(profiles().authenticate(first)).toBeNull();
    expect(profiles().authenticate(second)).toBe(id);
  });

  it('expires a session after 180 days', async () => {
    const { id } = await created('Open');
    const issued = await token(id);
    clock.advance(SESSION_MS - 1);
    expect(profiles().authenticate(issued)).toBe(id);
    clock.advance(1);
    expect(profiles().authenticate(issued)).toBeNull();
  });

  it('says whether a profile has a session that has not ended', async () => {
    const { id } = await created('Open');
    expect(profiles().hasSession(id)).toBe(false);
    const issued = await token(id);
    expect(profiles().hasSession(id)).toBe(true);
    profiles().logout(issued);
    expect(profiles().hasSession(id)).toBe(false);
    await token(id);
    clock.advance(SESSION_MS);
    expect(profiles().hasSession(id)).toBe(false);
  });

  it('ends a session at logout and tells the room', async () => {
    const { id } = await created('Open');
    const issued = await token(id);
    const told: number[] = [];
    profiles().onSignedOut((playerId) => told.push(playerId));
    expect(profiles().logout(issued)).toBe(true);
    expect(profiles().logout(issued)).toBe(false);
    expect(profiles().authenticate(issued)).toBeNull();
    expect(told).toEqual([id]);
  });
});

describe('adding a PIN', () => {
  it('sets the PIN, keeps this session, ends the others and tells the room', async () => {
    const { id } = await created('Open');
    const issued = await token(id);
    // A login already ends the sessions before it, so a second live one is written here directly.
    const elsewhere = 'another-device-token';
    temp.services.db
      .prepare('INSERT INTO sessions (token_hash, player_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .run(createHash('sha256').update(elsewhere).digest(), id, clock.now() + SESSION_MS, clock.now());
    const told: number[] = [];
    profiles().onSignedOut((playerId) => told.push(playerId));
    expect(await profiles().addPin(issued, '2468')).toEqual({ ok: true, value: { id, name: 'Open', avatar: 'blue', hasPin: true, lockedForSeconds: 0 } });
    expect(profiles().authenticate(issued)).toBe(id);
    expect(profiles().isSessionLive(sessionKey(issued))).toBe(true);
    expect(profiles().authenticate(elsewhere)).toBeNull();
    expect(profiles().isSessionLive(sessionKey(elsewhere))).toBe(false);
    expect(told).toEqual([id]);
    expect(await profiles().login({ profileId: id })).toEqual({ ok: false, error: 'pinInvalid' });
    expect((await profiles().login({ profileId: id, pin: '2468' })).ok).toBe(true);
  });

  it('adds a PIN once, even when asked twice at the same time', async () => {
    const { id } = await created('Open');
    const issued = await token(id);
    const answers = await Promise.all([profiles().addPin(issued, '1111'), profiles().addPin(issued, '2222')]);
    expect(answers.map((answer) => (answer.ok ? 'ok' : answer.error)).toSorted()).toEqual(['hasPin', 'ok']);
    const kept = answers[0]?.ok ? '1111' : '2222';
    expect((await profiles().login({ profileId: id, pin: kept })).ok).toBe(true);
  });

  it('refuses a profile that has a PIN, and a session that has ended', async () => {
    const { id } = await created('Closed', '2468');
    const issued = await token(id, '2468');
    expect(await profiles().addPin(issued, '1357')).toEqual({ ok: false, error: 'hasPin' });
    expect((await profiles().login({ profileId: id, pin: '2468' })).ok).toBe(true);
    expect(await profiles().addPin(issued, '1357')).toEqual({ ok: false, error: 'signedOut' });
    expect(await profiles().addPin(undefined, '1357')).toEqual({ ok: false, error: 'signedOut' });
    expect(profiles().isSessionLive('not a key')).toBe(false);
  });
});

describe('admin actions', () => {
  it('resets a PIN to a new one, unlocks the profile and ends its sessions', async () => {
    const { id } = await created('Closed', '2468');
    const issued = await token(id, '2468');
    await repeat(PIN_ATTEMPTS, () => profiles().login({ profileId: id, pin: '0000' }));
    const pin = await profiles().resetPin(id);
    expect(pin).toMatch(/^\d{4}$/);
    expect(profiles().authenticate(issued)).toBeNull();
    expect((await profiles().login({ profileId: id, pin })).ok).toBe(true);
  });

  it('removes a PIN', async () => {
    const { id } = await created('Closed', '2468');
    profiles().removePin(id);
    expect(profiles().get(id)?.hasPin).toBe(false);
    expect((await profiles().login({ profileId: id })).ok).toBe(true);
  });

  it('deletes a profile with its sessions and progress', async () => {
    const { id } = await created('Gone');
    const issued = await token(id);
    temp.services.progress.save(id, createSave({ name: 'Gone', language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position: null, ...emptyProgress() }));
    profiles().remove(id);
    expect(profiles().get(id)).toBeUndefined();
    expect(profiles().authenticate(issued)).toBeNull();
    expect(temp.services.progress.load(id)).toBeNull();
  });

  it('finds a profile by name in any capitals', async () => {
    const { id } = await created('Čmrljček Šumež');
    expect(profiles().findByName('  čmrljček   ŠUMEŽ')?.id).toBe(id);
    expect(profiles().findByName('nobody')).toBeUndefined();
  });
});

describe('progress', () => {
  it('round-trips a save through the database', async () => {
    const { id } = await created('Čmrljček Šumež');
    const save = createSave({ name: 'Čmrljček Šumež', language: 'sl', createdAt: '2026-05-01T09:00:00.000Z', position: { map: 'post-island', x: 12, y: 9, facing: 'left' }, ...emptyProgress() });
    expect(temp.services.progress.load(id)).toBeNull();
    temp.services.progress.save(id, save);
    expect(temp.services.progress.load(id)).toEqual(save);
  });

  it('upgrades an old save it finds in the database', async () => {
    const { id } = await created('Old Courier');
    temp.services.db
      .prepare('INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, 1, ?, 0)')
      .run(id, JSON.stringify({ name: 'Old Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z' }));
    expect(temp.services.progress.load(id)).toEqual({ v: SAVE_VERSION, data: { name: 'Old Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z', position: null, ...emptyProgress() } });
  });

  it('loads a save naming a species that was renamed as the species that replaced it', async () => {
    const { id } = await created('Blob Courier');
    const creature = { species: 'sun-blob', level: 7, xp: 40, hp: 26, moves: ['sun-tap', 'sun-wallop', 'sun-call', 'storm-tap'] };
    const { story: _v4Only, ...v3Progress } = emptyProgress();
    const data = { name: 'Blob Courier', language: 'en', createdAt: '2026-05-02T10:00:00.000Z', position: null, ...v3Progress, team: [creature], seen: ['sun-blob'], befriended: ['sun-blob'] };
    temp.services.db.prepare('INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, 3, ?, 0)').run(id, JSON.stringify(data));
    expect(temp.services.progress.load(id)?.data).toMatchObject({ team: [{ species: 'glowbun', level: 7, xp: 40, hp: 26, moves: ['heat-shimmer', 'sun-ray', 'storm-tap', 'sun-call'] }], seen: ['glowbun'], befriended: ['glowbun'] });
  });

  it('keeps a saved story through the repair and drops the quests and flags the story no longer has', async () => {
    const { id } = await created('Forgetful Courier');
    const fixture = JSON.parse(readFileSync(new URL('../../../packages/core/fixtures/saves/v4/old-content.json', import.meta.url), 'utf8')) as { v: number; data: unknown };
    temp.services.db.prepare('INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, ?, ?, 0)').run(id, fixture.v, JSON.stringify(fixture.data));
    expect(temp.services.progress.load(id)?.data).toMatchObject({
      team: [{ species: 'glowbun' }],
      inventory: [{ item: 'hello-note', count: 1 }],
      story: { active: [{ quest: 'first-round', step: 0, count: 0 }], done: [], flags: [] },
    });
    expect(logged.find((line) => line['msg'] === 'save repaired')).toMatchObject({ playerId: id, droppedCreatures: ['gone-species'], droppedQuests: ['gone-quest', 'old-round'], droppedFlags: ['gone-flag'] });
  });

  it('refuses a save from a newer game rather than guessing', async () => {
    const { id } = await created('Future Courier');
    temp.services.db.prepare("INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, 99, '{}', 0)").run(id);
    expect(() => temp.services.progress.load(id)).toThrow(SaveError);
  });
});
