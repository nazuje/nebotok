import type { Language, StringId } from '@nebotok/core';
import { text } from './strings.ts';

/**
 * A wait as a player is told it: "a minute" up to a minute, whole minutes up to five, then "about"
 * a multiple of five minutes, and "an hour" from 56 minutes. Always rounded up, so a player who
 * comes back when told finds the profile open.
 */
export type Wait = { readonly kind: 'minute' } | { readonly kind: 'minutes'; readonly minutes: number; readonly about: boolean } | { readonly kind: 'hour' };

const EXACT_UP_TO_MINUTES = 5;
const ROUND_TO_MINUTES = 5;
const HOUR_MINUTES = 60;

export function roundWait(seconds: number): Wait {
  const minutes = Math.ceil(seconds / 60);
  if (minutes <= 1) return { kind: 'minute' };
  if (minutes <= EXACT_UP_TO_MINUTES) return { kind: 'minutes', minutes, about: false };
  const rounded = Math.ceil(minutes / ROUND_TO_MINUTES) * ROUND_TO_MINUTES;
  return rounded >= HOUR_MINUTES ? { kind: 'hour' } : { kind: 'minutes', minutes: rounded, about: true };
}

export type PluralForm = 'one' | 'two' | 'few' | 'other';

/** Which form a counted word takes: Slovenian has four (1 minuto, 2 minuti, 3 minute, 5 minut). */
const PLURAL_RULES: Readonly<Record<Language, (count: number) => PluralForm>> = {
  en: (count) => (count === 1 ? 'one' : 'other'),
  sl: (count) => {
    const last = count % 100;
    if (last === 1) return 'one';
    if (last === 2) return 'two';
    return last === 3 || last === 4 ? 'few' : 'other';
  },
};

export function pluralForm(count: number, language: Language): PluralForm {
  return PLURAL_RULES[language](count);
}

const MINUTES: Readonly<Record<PluralForm, StringId>> = {
  one: 'profile.time.minutes.one',
  two: 'profile.time.minutes.two',
  few: 'profile.time.minutes.few',
  other: 'profile.time.minutes.other',
};

const fill = (template: string, slot: string, value: string) => template.replace(`{${slot}}`, () => value);

/** "2 minutes", "about 10 minutes", "an hour", in the form that fits "Wait …" and "Locked for …". */
export function waitPhrase(seconds: number, language: Language): string {
  const wait = roundWait(seconds);
  if (wait.kind === 'minute') return text('profile.time.minute', language);
  if (wait.kind === 'hour') return text('profile.time.hour', language);
  const count = fill(text(MINUTES[pluralForm(wait.minutes, language)], language), 'n', String(wait.minutes));
  return wait.about ? fill(text('profile.time.about', language), 'time', count) : count;
}

/** The tag on a locked profile's card. */
export function lockedTag(seconds: number, language: Language): string {
  return fill(text('profile.locked', language), 'time', waitPhrase(seconds, language));
}

/** The message after tapping a locked profile or getting locked out on the number pad. */
export function lockedNotice(seconds: number, language: Language): string {
  return fill(text('profile.error.locked', language), 'time', waitPhrase(seconds, language));
}
