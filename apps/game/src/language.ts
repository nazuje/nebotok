import { LanguageSchema, type Language } from '@nebotok/core';

const STORAGE_KEY = 'nebotok:language';

function stored(): Language | undefined {
  try {
    const parsed = LanguageSchema.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** The saved choice, else Slovenian for a Slovenian device, else English. */
export function initialLanguage(): Language {
  return stored() ?? (navigator.language.toLowerCase().startsWith('sl') ? 'sl' : 'en');
}

export function saveLanguage(language: Language): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(language));
  } catch {
    // Private browsing can refuse storage; the choice then lasts until the page closes.
  }
}

export function otherLanguage(language: Language): Language {
  return language === 'en' ? 'sl' : 'en';
}
