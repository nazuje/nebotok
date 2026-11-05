import { LoginResponse, PROFILE_ERRORS, ProfileSummary, type ProfileError } from '@nebotok/core';
import { z } from 'zod';
import { SERVER_BASE } from './session.ts';

/** `unreachable` is the client's own: no answer at all, or one from something other than the game. */
export type ApiProblem = ProfileError | 'unreachable';
export type ApiResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ApiProblem; readonly retryAfterSeconds?: number };

const ErrorBody = z.object({ error: z.enum(PROFILE_ERRORS), retryAfterSeconds: z.number().int().min(0).optional() });

async function call<T>(schema: z.ZodType<T>, path: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  let response: Response;
  try {
    response = await fetch(`${SERVER_BASE}/api${path}`, { ...init, cache: 'no-store' });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) {
    const parsed = schema.safeParse(body);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: 'unknown' };
  }
  const failed = ErrorBody.safeParse(body);
  // A proxy answering for a stopped server sends its own page, not the API's JSON.
  if (!failed.success) return { ok: false, error: response.status >= 500 ? 'unreachable' : 'unknown' };
  const { error, retryAfterSeconds } = failed.data;
  return retryAfterSeconds === undefined ? { ok: false, error } : { ok: false, error, retryAfterSeconds };
}

const postJson = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export function listProfiles(): Promise<ApiResult<ProfileSummary[]>> {
  return call(z.array(ProfileSummary), '/profiles');
}

export function createProfile(name: string, avatar: string, pin: string | undefined): Promise<ApiResult<ProfileSummary>> {
  return call(ProfileSummary, '/profiles', postJson(pin === undefined ? { name, avatar } : { name, avatar, pin }));
}

export function login(profileId: number, pin: string | undefined): Promise<ApiResult<LoginResponse>> {
  return call(LoginResponse, '/sessions', postJson(pin === undefined ? { profileId } : { profileId, pin }));
}

/** Gives the signed-in profile its first PIN. */
export function addPin(token: string, pin: string): Promise<ApiResult<ProfileSummary>> {
  return call(ProfileSummary, '/profiles/current/pin', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ pin }) });
}

/** Ends the session on the server. Signing out locally goes ahead whatever the answer. */
export async function logout(token: string): Promise<void> {
  try {
    await fetch(`${SERVER_BASE}/api/sessions/current`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  } catch {
    // The server is away; the token is forgotten on this device anyway.
  }
}
