import { createHash, randomBytes, randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { DatabaseSync } from 'node:sqlite';
import {
  MAX_PROFILES,
  PIN_ATTEMPTS,
  PIN_LOCK_MS,
  nameKey,
  type CreateProfileRequest,
  type LoginRequest,
  type LoginResponse,
  type ProfileError,
  type ProfileSummary,
} from '@nebotok/core';
import { hashPin, verifyPin } from './pin.ts';

/** How long a login lasts on a device before the player picks their profile again. */
export const SESSION_MS = 180 * 24 * 60 * 60 * 1_000;
const TOKEN_BYTES = 32;
const MAX_TOKEN_LENGTH = 100;

type Row = {
  id: number;
  name: string;
  avatar: string;
  pin_hash: Uint8Array | null;
  pin_salt: Uint8Array | null;
  failed_pins: number;
  locked_until: number;
  created_at: number;
};

export type Profile = { readonly id: number; readonly name: string; readonly avatar: string; readonly hasPin: boolean; readonly createdAt: number };

export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ProfileError; readonly retryAfterSeconds?: number };

export type ProfileStore = {
  list(): ProfileSummary[];
  get(id: number): Profile | undefined;
  findByName(name: string): Profile | undefined;
  create(request: CreateProfileRequest): Promise<Result<ProfileSummary>>;
  login(request: LoginRequest): Promise<Result<LoginResponse>>;
  /** The player a session token belongs to, or null when it is unknown or expired. */
  authenticate(token: unknown): number | null;
  /** Ends the session; true when there was one. */
  logout(token: unknown): boolean;
  /** Sets a new random PIN, ends every session of the profile and returns the PIN to tell its owner. */
  resetPin(id: number): Promise<string>;
  removePin(id: number): void;
  remove(id: number): void;
  /** Called when a player's sessions end here (logout, PIN reset, deletion), so the room can let them go. */
  onSignedOut(listener: (playerId: number) => void): () => void;
};

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest();

const fail = (error: ProfileError, retryAfterSeconds?: number): Result<never> =>
  retryAfterSeconds === undefined ? { ok: false, error } : { ok: false, error, retryAfterSeconds };

function profileOf(row: Row): Profile {
  return { id: row.id, name: row.name, avatar: row.avatar, hasPin: row.pin_hash !== null, createdAt: row.created_at };
}

function summaryOf(row: Row, now: number): ProfileSummary {
  const lockedForSeconds = row.locked_until > now ? Math.ceil((row.locked_until - now) / 1_000) : 0;
  return { id: row.id, name: row.name, avatar: row.avatar, hasPin: row.pin_hash !== null, lockedForSeconds };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}

export function createProfileStore({ db, now, avatars }: { db: DatabaseSync; now: () => number; avatars: ReadonlySet<string> }): ProfileStore {
  const events = new EventEmitter<{ signedOut: [number] }>();
  const verifying = new Set<number>();
  const sql = {
    list: db.prepare('SELECT * FROM players ORDER BY created_at, id'),
    byId: db.prepare('SELECT * FROM players WHERE id = ?'),
    byKey: db.prepare('SELECT * FROM players WHERE name_key = ?'),
    count: db.prepare('SELECT count(*) AS n FROM players'),
    insert: db.prepare('INSERT INTO players (name, name_key, avatar, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    setFailures: db.prepare('UPDATE players SET failed_pins = ?, locked_until = ? WHERE id = ?'),
    setPin: db.prepare('UPDATE players SET pin_hash = ?, pin_salt = ?, failed_pins = 0, locked_until = 0 WHERE id = ?'),
    remove: db.prepare('DELETE FROM players WHERE id = ?'),
    endSessions: db.prepare('DELETE FROM sessions WHERE player_id = ? OR expires_at <= ?'),
    endSessionsOf: db.prepare('DELETE FROM sessions WHERE player_id = ?'),
    startSession: db.prepare('INSERT INTO sessions (token_hash, player_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT player_id FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    endSession: db.prepare('DELETE FROM sessions WHERE token_hash = ? RETURNING player_id'),
  };
  const row = (id: number) => sql.byId.get(id) as Row | undefined;
  const signedOut = (playerId: number) => events.emit('signedOut', playerId);

  /** One active session per profile: a new login replaces the old one, and expired sessions go too. */
  function startSession(playerId: number): { token: string; expiresAt: number } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const at = now();
    const expiresAt = at + SESSION_MS;
    db.exec('BEGIN IMMEDIATE');
    try {
      sql.endSessions.run(playerId, at);
      sql.startSession.run(tokenHash(token), playerId, expiresAt, at);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { token, expiresAt };
  }

  /** Checks the PIN and counts failures. Several wrong PINs in a row lock the profile for a while. */
  async function checkPin(found: Row, pin: string | undefined): Promise<Result<Row>> {
    if (found.pin_hash === null || found.pin_salt === null) return { ok: true, value: found };
    if (pin === undefined) return fail('pinInvalid');
    // One check at a time per profile, so parallel guesses cannot slip past the failure count.
    if (verifying.has(found.id)) return fail('busy', 1);
    verifying.add(found.id);
    let right: boolean;
    try {
      right = await verifyPin(pin, { hash: found.pin_hash, salt: found.pin_salt });
    } finally {
      verifying.delete(found.id);
    }
    const current = row(found.id);
    if (!current) return fail('unknown');
    if (right) {
      sql.setFailures.run(0, 0, current.id);
      return { ok: true, value: current };
    }
    const failures = current.failed_pins + 1;
    if (failures < PIN_ATTEMPTS) {
      sql.setFailures.run(failures, current.locked_until, current.id);
      return fail('pinWrong');
    }
    sql.setFailures.run(0, now() + PIN_LOCK_MS, current.id);
    return fail('locked', Math.ceil(PIN_LOCK_MS / 1_000));
  }

  return {
    list: () => (sql.list.all() as Row[]).map((found) => summaryOf(found, now())),
    get: (id) => {
      const found = row(id);
      return found && profileOf(found);
    },
    findByName: (name) => {
      const found = sql.byKey.get(nameKey(name)) as Row | undefined;
      return found && profileOf(found);
    },

    async create({ name, avatar, pin }) {
      if (!avatars.has(avatar)) return fail('unknown');
      const full = () => (sql.count.get() as { n: number }).n >= MAX_PROFILES;
      if (full()) return fail('full');
      if (sql.byKey.get(nameKey(name))) return fail('nameTaken');
      const secret = pin === undefined ? null : await hashPin(pin);
      // Checked again: another request may have filled the last place while the PIN was hashed.
      if (full()) return fail('full');
      try {
        const { lastInsertRowid } = sql.insert.run(name, nameKey(name), avatar, secret?.hash ?? null, secret?.salt ?? null, now());
        const created = row(Number(lastInsertRowid));
        if (!created) return fail('unknown');
        return { ok: true, value: summaryOf(created, now()) };
      } catch (error) {
        if (isUniqueViolation(error)) return fail('nameTaken');
        throw error;
      }
    },

    async login({ profileId, pin }) {
      const found = row(profileId);
      if (!found) return fail('unknown');
      if (found.locked_until > now()) return fail('locked', Math.ceil((found.locked_until - now()) / 1_000));
      const checked = await checkPin(found, pin);
      if (!checked.ok) return checked;
      const { token, expiresAt } = startSession(checked.value.id);
      return { ok: true, value: { token, expiresAt: new Date(expiresAt).toISOString(), profile: summaryOf(checked.value, now()) } };
    },

    authenticate(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
      const found = sql.session.get(tokenHash(token), now()) as { player_id: number } | undefined;
      return found?.player_id ?? null;
    },

    logout(token) {
      if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return false;
      const ended = sql.endSession.get(tokenHash(token)) as { player_id: number } | undefined;
      if (ended) signedOut(ended.player_id);
      return ended !== undefined;
    },

    async resetPin(id) {
      const pin = String(randomInt(0, 10_000)).padStart(4, '0');
      const secret = await hashPin(pin);
      sql.setPin.run(secret.hash, secret.salt, id);
      sql.endSessionsOf.run(id);
      signedOut(id);
      return pin;
    },
    removePin(id) {
      sql.setPin.run(null, null, id);
    },
    remove(id) {
      sql.remove.run(id);
      signedOut(id);
    },

    onSignedOut(listener) {
      events.on('signedOut', listener);
      return () => events.off('signedOut', listener);
    },
  };
}
