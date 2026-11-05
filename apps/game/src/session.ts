import type { LoginResponse } from '@nebotok/core';
import { z } from 'zod';

const STORAGE_KEY = 'nebotok:session';

/** The token, plus enough of the profile to show who is playing before the world answers. */
const StoredSession = z.object({
  token: z.string().min(1).max(100),
  profile: z.object({ id: z.number().int().min(1), name: z.string().min(1).max(16), avatar: z.string().min(1).max(20) }).optional(),
});
export type StoredSession = z.infer<typeof StoredSession>;

/** In dev, Vite proxies /colyseus to the server and strips the prefix. */
export const SERVER_BASE = import.meta.env.DEV ? '/colyseus' : '';

/** The session this device last signed in with, if any. */
export function storedSession(): StoredSession | null {
  try {
    const parsed = StoredSession.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function saveSession({ token, profile }: LoginResponse): void {
  const stored: StoredSession = { token, profile: { id: profile.id, name: profile.name, avatar: profile.avatar } };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private browsing can refuse storage; the session then lasts until the page closes.
  }
}

export function forgetSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing stored, nothing to forget.
  }
}
