import { LoginResponse, ProfileSummary } from '@nebotok/core';
import { z } from 'zod';

const STORAGE_KEY = 'nebotok:session';
const StoredSession = z.object({ token: z.string().min(1).max(100) });

/** In dev, Vite proxies /colyseus to the server and strips the prefix. */
export const SERVER_BASE = import.meta.env.DEV ? '/colyseus' : '';

/** The session token this device logged in with, if any. The profile screen will write it. */
export function storedToken(): string | null {
  try {
    const parsed = StoredSession.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data.token : null;
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token }));
  } catch {
    // Private browsing can refuse storage; the session then lasts until the page closes.
  }
}

export function forgetToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to forget.
  }
}

const DEV_PROFILE = { name: 'Dev Courier', avatar: 'blue' } as const;

async function api(path: string, body?: unknown): Promise<unknown> {
  const init: RequestInit = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(`${SERVER_BASE}/api${path}`, init);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  return response.json();
}

/**
 * Development only, until the profile screen exists: signs this browser in as a shared dev profile,
 * creating it on first use. Production builds leave this out.
 */
export async function devSignIn(): Promise<string> {
  const profiles = z.array(ProfileSummary).parse(await api('/profiles'));
  const profile = profiles.find((found) => found.name === DEV_PROFILE.name) ?? ProfileSummary.parse(await api('/profiles', DEV_PROFILE));
  const { token } = LoginResponse.parse(await api('/sessions', { profileId: profile.id }));
  saveToken(token);
  return token;
}
