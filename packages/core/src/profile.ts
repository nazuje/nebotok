import { z } from 'zod';

/** At most this many profiles share the family world. */
export const MAX_PROFILES = 20;
export const PROFILE_NAME_MAX = 16;
/** Wrong PINs in a row before a profile is locked, and for how long. */
export const PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 60_000;

const LETTER = '[A-Za-zČŠŽĆĐčšžćđ]';
const NAME_SHAPE = new RegExp(`^${LETTER}+(?: ${LETTER}+)*$`);

/** The form a name is stored and shown in: composed accents, no outer spaces, single inner spaces. */
export function normalizeName(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ');
}

/** Two names that differ only in capitals are the same name. */
export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

/** 1 to 16 letters (English and Slovenian, with č, š, ž, ć, đ) and single spaces, after normalizing. */
export const ProfileName = z
  .string()
  .max(64)
  .transform(normalizeName)
  .pipe(z.string().min(1).max(PROFILE_NAME_MAX).regex(NAME_SHAPE));

export const Pin = z.string().regex(/^\d{4}$/);

const AvatarId = z.string().min(1).max(20);
const ProfileId = z.number().int().min(1).max(2 ** 31);

/** POST /api/profiles */
export const CreateProfileRequest = z.strictObject({ name: ProfileName, avatar: AvatarId, pin: Pin.optional() });
export type CreateProfileRequest = z.infer<typeof CreateProfileRequest>;

/** POST /api/sessions */
export const LoginRequest = z.strictObject({ profileId: ProfileId, pin: Pin.optional() });
export type LoginRequest = z.infer<typeof LoginRequest>;

/** PUT /api/profiles/current/pin: a PIN for the signed-in profile, which has none yet. */
export const AddPinRequest = z.strictObject({ pin: Pin });
export type AddPinRequest = z.infer<typeof AddPinRequest>;

/** One entry of GET /api/profiles: what the profile picker shows. */
export const ProfileSummary = z.object({
  id: ProfileId,
  name: z.string().min(1).max(PROFILE_NAME_MAX),
  avatar: AvatarId,
  hasPin: z.boolean(),
  /** Seconds until a locked profile can be tried again; 0 when it is not locked. */
  lockedForSeconds: z.number().int().min(0),
});
export type ProfileSummary = Readonly<z.infer<typeof ProfileSummary>>;

/** The answer to a login: the session token to send as `Authorization: Bearer <token>`. */
export const LoginResponse = z.object({ token: z.string().min(1).max(100), expiresAt: z.iso.datetime(), profile: ProfileSummary });
export type LoginResponse = Readonly<z.infer<typeof LoginResponse>>;

/** Every error the profile API answers with. The client shows `profile.error.<code>`. */
export const PROFILE_ERRORS = ['nameInvalid', 'nameTaken', 'pinInvalid', 'pinWrong', 'locked', 'full', 'busy', 'signedOut', 'hasPin', 'unknown'] as const;
export type ProfileError = (typeof PROFILE_ERRORS)[number];
export type ApiError = { readonly error: ProfileError; readonly retryAfterSeconds?: number };
