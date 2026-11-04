import { MAX_PROFILES, PIN_ATTEMPTS, PIN_LOCK_MS, SaveError, createSave } from '@nebotok/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SESSION_MS } from '../src/profiles.ts';
import { fakeClock, repeat, tempServices } from './helpers.ts';

let clock: ReturnType<typeof fakeClock>;
let temp: ReturnType<typeof tempServices>;
beforeEach(() => {
  clock = fakeClock();
  temp = tempServices(clock.now);
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
    temp.services.progress.save(id, createSave({ name: 'Gone', language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position: null }));
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
    const save = createSave({ name: 'Čmrljček Šumež', language: 'sl', createdAt: '2026-05-01T09:00:00.000Z', position: { map: 'post-island', x: 12, y: 9, facing: 'left' } });
    expect(temp.services.progress.load(id)).toBeNull();
    temp.services.progress.save(id, save);
    expect(temp.services.progress.load(id)).toEqual(save);
  });

  it('upgrades an old save it finds in the database', async () => {
    const { id } = await created('Old Courier');
    temp.services.db
      .prepare('INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, 1, ?, 0)')
      .run(id, JSON.stringify({ name: 'Old Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z' }));
    expect(temp.services.progress.load(id)).toEqual({ v: 2, data: { name: 'Old Courier', language: 'en', createdAt: '2026-01-01T09:00:00Z', position: null } });
  });

  it('refuses a save from a newer game rather than guessing', async () => {
    const { id } = await created('Future Courier');
    temp.services.db.prepare("INSERT INTO player_progress (player_id, save_version, data, updated_at) VALUES (?, 99, '{}', 0)").run(id);
    expect(() => temp.services.progress.load(id)).toThrow(SaveError);
  });
});
