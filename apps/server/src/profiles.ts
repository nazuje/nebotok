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
import type { Log } from './log.ts';
import { hashPin, verifyPin } from './pin.ts';

/** How long a login lasts on a device before the player picks their profile again. */
export const SESSION_MS = 180 * 24 * 60 * 60 * 1_000;
/** The longest a PIN lock lasts: each lock in a row doubles PIN_LOCK_MS up to this. */
export const PIN_LOCK_MAX_MS = 60 * 60 * 1_000;
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
  lock_count: number;
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
  /** Whether the player has a session that has not ended. The database is the truth: admin.ts runs as its own process. */
  hasSession(playerId: number): boolean;
  /** Whether the session with this `sessionKey` has not ended. */
  isSessionLive(key: string): boolean;
  /** Ends the session; true when there was one. */
  logout(token: unknown): boolean;
  /** Sets a new random PIN, ends every session of the profile and returns the PIN to tell its owner. */
  resetPin(id: number): Promise<string>;
  removePin(id: number): void;
  /**
   * Gives the profile signed in with `token` the PIN, only while it has none, and ends its other
   * sessions, so another device holding the profile has to type the PIN. This session goes on.
   */
  addPin(token: unknown, pin: string): Promise<Result<ProfileSummary>>;
  remove(id: number): void;
  /** Called when some of a player's sessions end here (logout, PIN reset or added, deletion), so the room can let them go. */
  onSignedOut(listener: (playerId: number) => void): () => void;
};

const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest();

/** Names a session without its token, so a seat can ask later whether the session it joined with still holds. */
export const sessionKey = (token: string): string => tokenHash(token).toString('hex');

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

/** PIN_LOCK_MS for the first lock in a row, doubling with each one after, up to PIN_LOCK_MAX_MS. */
function lockMs(earlierLocks: number): number {
  return Math.min(PIN_LOCK_MS * 2 ** earlierLocks, PIN_LOCK_MAX_MS);
}

export function createProfileStore({ db, now, avatars, log }: { db: DatabaseSync; now: () => number; avatars: ReadonlySet<string>; log: Log }): ProfileStore {
  const events = new EventEmitter<{ signedOut: [number] }>();
  const verifying = new Set<number>();
  const sql = {
    list: db.prepare('SELECT * FROM players ORDER BY created_at, id'),
    byId: db.prepare('SELECT * FROM players WHERE id = ?'),
    byKey: db.prepare('SELECT * FROM players WHERE name_key = ?'),
    count: db.prepare('SELECT count(*) AS n FROM players'),
    insert: db.prepare('INSERT INTO players (name, name_key, avatar, pin_hash, pin_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    setFailures: db.prepare('UPDATE players SET failed_pins = ?, locked_until = ?, lock_count = ? WHERE id = ?'),
    setPin: db.prepare('UPDATE players SET pin_hash = ?, pin_salt = ?, failed_pins = 0, locked_until = 0, lock_count = 0 WHERE id = ?'),
    remove: db.prepare('DELETE FROM players WHERE id = ?'),
    endSessions: db.prepare('DELETE FROM sessions WHERE player_id = ? OR expires_at <= ?'),
    endSessionsOf: db.prepare('DELETE FROM sessions WHERE player_id = ?'),
    endOtherSessions: db.prepare('DELETE FROM sessions WHERE player_id = ? AND token_hash != ?'),
    startSession: db.prepare('INSERT INTO sessions (token_hash, player_id, expires_at, created_at) VALUES (?, ?, ?, ?)'),
    session: db.prepare('SELECT player_id FROM sessions WHERE token_hash = ? AND expires_at > ?'),
    hasSession: db.prepare('SELECT 1 FROM sessions WHERE player_id = ? AND expires_at > ? LIMIT 1'),
    endSession: db.prepare('DELETE FROM sessions WHERE token_hash = ? RETURNING player_id'),
  };
  const row = (id: number) => sql.byId.get(id) as Row | undefined;
  const signedOut = (playerId: number) => events.emit('signedOut', playerId);

  function inTransaction<T>(run: () => T): T {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = run();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  /** The live session a token names, by the hash the database keeps. */
  function liveSession(token: unknown): { playerId: number; hash: Buffer } | null {
    if (typeof token !== 'string' || token.length === 0 || token.length > MAX_TOKEN_LENGTH) return null;
    const hash = tokenHash(token);
    const found = sql.session.get(hash, now()) as { player_id: number } | undefined;
    return found ? { playerId: found.player_id, hash } : null;
  }

  /** One active session per profile: a new login replaces the old one, and expired sessions go too. */
  function startSession(playerId: number): { token: string; expiresAt: number } {
    const token = randomBytes(TOKEN_BYTES).toString('base64url');
    const at = now();
    const expiresAt = at + SESSION_MS;
    inTransaction(() => {
      sql.endSessions.run(playerId, at);
      sql.startSession.run(tokenHash(token), playerId, expiresAt, at);
    });
    return { token, expiresAt };
  }

  /** Checks the PIN and counts failures. Several wrong PINs in a row lock the profile, longer each time. */
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
      sql.setFailures.run(0, 0, 0, current.id);
      return { ok: true, value: current };
    }
    const failures = current.failed_pins + 1;
    if (failures < PIN_ATTEMPTS) {
      sql.setFailures.run(failures, current.locked_until, current.lock_count, current.id);
      return fail('pinWrong');
    }
    const lockedFor = lockMs(current.lock_count);
    sql.setFailures.run(0, now() + lockedFor, current.lock_count + 1, current.id);
    log.warn('profile locked', { profileId: current.id });
    return fail('locked', Math.ceil(lockedFor / 1_000));
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

    authenticate: (token) => liveSession(token)?.playerId ?? null,

    hasSession: (playerId) => sql.hasSession.get(playerId, now()) !== undefined,
    isSessionLive: (key) => /^[0-9a-f]{64}$/.test(key) && sql.session.get(Buffer.from(key, 'hex'), now()) !== undefined,

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
    async addPin(token, pin) {
      const session = liveSession(token);
      if (!session) return fail('signedOut');
      const found = row(session.playerId);
      if (!found) return fail('signedOut');
      if (found.pin_hash !== null) return fail('hasPin');
      const secret = await hashPin(pin);
      // Checked again inside the write: while the PIN was hashed, the session may have ended or
      // another request may have set a PIN first.
      const added = inTransaction((): Result<Row> => {
        const current = row(session.playerId);
        if (!current || sql.session.get(session.hash, now()) === undefined) return fail('signedOut');
        if (current.pin_hash !== null) return fail('hasPin');
        sql.setPin.run(secret.hash, secret.salt, current.id);
        sql.endOtherSessions.run(current.id, session.hash);
        return { ok: true, value: { ...current, pin_hash: secret.hash, pin_salt: secret.salt } };
      });
      if (!added.ok) return added;
      signedOut(added.value.id);
      return { ok: true, value: summaryOf(added.value, now()) };
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
