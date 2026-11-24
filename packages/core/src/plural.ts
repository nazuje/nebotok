import type { Language } from './content.ts';

export type PluralForm = 'one' | 'two' | 'few' | 'other';

/** Which form a counted word takes: Slovenian has four (1 minuto, 2 minuti, 3 minute, 5 minut), by the last two digits; English two. */
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
