import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  addFix,
  audioFilter,
  buildManifest,
  chunksIn,
  clipFile,
  fixesUsed,
  fixFor,
  hasPlaceholder,
  joinParts,
  markStress,
  spokenText,
  splitLine,
  staleClips,
  uniqueWords,
  voiceKey,
  voiceSettings,
} from './lib.mjs';

const FIXES = { tukaj: 'tˈuːkaj', domov: 'dɔmˈɔːw' };

// Stands in for espeak, so each piece of a line is easy to spot.
const fakeIpa = (chunk) => `<${chunk}>`;
const toIpa = (line, fixes = FIXES) => joinParts(splitLine(line, fixes), fakeIpa);

const settings = { language: 'sl', text: 'Bravo!', fixes: [], model: 'm', espeak: 'sl', lengthScale: 1.12, filter: 'f', mp3Args: ['a'] };

describe('splitLine and joinParts', () => {
  it('leaves a line with no fixes as one piece', () => {
    expect(splitLine('Kaj je to?', FIXES)).toEqual([{ text: 'Kaj je to?' }]);
    expect(toIpa('Kaj je to?')).toBe('<Kaj je to?>');
  });

  it('swaps in a fix mid-line', () => {
    expect(toIpa('Kuku, tukaj sem!')).toBe('<Kuku,> tˈuːkaj <sem!>');
  });

  it('keeps punctuation tight against a fixed word', () => {
    expect(toIpa('Kdo živi tukaj?')).toBe('<Kdo živi> tˈuːkaj<?>');
    expect(toIpa('Tukaj, ne!')).toBe('tˈuːkaj<, ne!>');
  });

  it('handles a line that is only a fixed word', () => {
    expect(toIpa('Tukaj')).toBe('tˈuːkaj');
  });

  it('keeps a space between two fixed words', () => {
    expect(toIpa('tukaj domov')).toBe('tˈuːkaj dɔmˈɔːw');
  });

  it('matches whatever the capitals', () => {
    expect(toIpa('TUKAJ')).toBe('tˈuːkaj');
    expect(toIpa('Tukaj je.')).toBe('tˈuːkaj <je.>');
  });

  it('matches whole words only, never part of a longer word', () => {
    expect(toIpa('Tukajle je.')).toBe('<Tukajle je.>');
    expect(toIpa('podomov')).toBe('<podomov>');
  });

  it('treats a letter with a caron as part of the word', () => {
    expect(toIpa('tukajš')).toBe('<tukajš>');
  });

  it('matches a word written with a separate combining caron', () => {
    expect(toIpa('šola', { šola: 'ʃˈoːla' })).toBe('ʃˈoːla');
  });

  it('sends espeak only pieces with something in them', () => {
    expect(chunksIn(splitLine('Kdo živi tukaj?', FIXES))).toEqual(['Kdo živi', '?']);
    expect(chunksIn(splitLine('tukaj domov', FIXES))).toEqual([]);
  });
});

describe('fixFor and fixesUsed', () => {
  it('is not fooled by words that are object built-ins', () => {
    expect(fixFor('constructor', FIXES)).toBeUndefined();
  });

  it('lists the fixes a line uses once each, sorted', () => {
    expect(fixesUsed('Tukaj, domov, tukaj!', FIXES)).toEqual([['domov', 'dɔmˈɔːw'], ['tukaj', 'tˈuːkaj']]);
    expect(fixesUsed('Kaj je to?', FIXES)).toEqual([]);
  });
});

describe('the pronunciation tables', () => {
  it('keep their fixes as lowercase written words mapped to stressed sounds', () => {
    for (const language of ['en', 'sl']) {
      const table = JSON.parse(readFileSync(new URL(`./pronunciation/${language}.json`, import.meta.url), 'utf8'));
      const words = Object.keys(table);
      expect(words).toEqual(words.map((word) => word.toLowerCase()));
      expect(Object.entries(table).filter(([, sounds]) => !sounds.includes('ˈ'))).toEqual([]);
    }
  });
});

describe('spokenText', () => {
  it('drops quotation marks and plain-writes apostrophes and ellipses', () => {
    expect(spokenText('»Oblaki nad otoki utihujejo.«')).toBe('Oblaki nad otoki utihujejo.');
    expect(spokenText('"The clouds are going quiet."')).toBe('The clouds are going quiet.');
    expect(spokenText('Storms don’t eat… or do they?')).toBe("Storms don't eat... or do they?");
  });
});

describe('hasPlaceholder', () => {
  it('finds a {placeholder} and nothing else', () => {
    expect(hasPlaceholder('Hello, {name}!')).toBe(true);
    expect(hasPlaceholder('Hello!')).toBe(false);
    expect(hasPlaceholder('A { lone brace')).toBe(false);
  });
});

describe('voices', () => {
  it('names the narrator and each pitch and pace', () => {
    expect(voiceKey(null)).toBe('narrator');
    expect(voiceKey({ pitch: 2, pace: 3 })).toBe('pitch2-pace3');
  });

  it('gives the narrator the language voice as it is', () => {
    const narrator = voiceSettings('sl', null);
    expect(narrator).toEqual(voiceSettings('sl', { pitch: 3, pace: 2 }));
    expect(narrator.filter.startsWith('asetrate')).toBe(false);
  });

  it('moves pitch without changing speed, and pace with the length scale', () => {
    const high = voiceSettings('en', { pitch: 5, pace: 2 });
    const [rate, tempo] = /^asetrate=(\d+),aresample=22050,atempo=([\d.]+),/.exec(high.filter).slice(1);
    expect(Number(rate)).toBeGreaterThan(22050);
    expect(Number(rate) * Number(tempo)).toBeCloseTo(22050, -1);
    expect(audioFilter(-3)).toMatch(/^asetrate=(\d+)/);
    expect(voiceSettings('en', { pitch: 3, pace: 1 }).lengthScale).toBeGreaterThan(voiceSettings('en', null).lengthScale);
    expect(voiceSettings('en', { pitch: 3, pace: 3 }).lengthScale).toBeLessThan(voiceSettings('en', null).lengthScale);
  });
});

describe('clipFile', () => {
  it('stays the same for the same input', () => {
    expect(clipFile(settings)).toBe(clipFile({ ...settings }));
    expect(clipFile(settings)).toMatch(/^[0-9a-f]{16}\.mp3$/);
  });

  it('changes with the text, the language, the fixes and every setting', () => {
    const name = clipFile(settings);
    const changes = [{ text: 'bravo!' }, { language: 'en' }, { fixes: [['bravo', 'x']] }, { model: 'n' }, { espeak: 'en-gb' }, { lengthScale: 1.3 }, { filter: 'g' }, { mp3Args: ['b'] }];
    const names = changes.map((change) => clipFile({ ...settings, ...change }));
    expect(names).not.toContain(name);
    expect(new Set(names).size).toBe(changes.length);
  });
});

describe('buildManifest', () => {
  it('sorts languages, voices and lines, and lists every language', () => {
    const manifest = buildManifest(
      [
        { language: 'en', voiceKey: 'pitch2-pace2', text: 'b', file: '2.mp3' },
        { language: 'en', voiceKey: 'narrator', text: 'b', file: '3.mp3' },
        { language: 'en', voiceKey: 'narrator', text: 'a', file: '1.mp3' },
      ],
      ['en', 'sl'],
    );
    expect(manifest).toEqual({ en: { narrator: { a: '1.mp3', b: '3.mp3' }, 'pitch2-pace2': { b: '2.mp3' } }, sl: {} });
    expect(Object.keys(manifest.en.narrator)).toEqual(['a', 'b']);
  });
});

describe('staleClips', () => {
  it('finds clips no line uses, and leaves other files alone', () => {
    expect(staleClips(['keep.mp3', 'old.mp3', '.DS_Store'], [{ file: 'keep.mp3' }])).toEqual(['old.mp3']);
  });
});

describe('addFix', () => {
  it('stores the word in lower case and keeps the table sorted', () => {
    expect(Object.keys(addFix(FIXES, 'Miza', 'mˈiːza'))).toEqual(['domov', 'miza', 'tukaj']);
  });

  it('replaces an earlier fix', () => {
    expect(addFix(FIXES, 'tukaj', 'x').tukaj).toBe('x');
  });

  it('refuses anything but one word', () => {
    expect(() => addFix(FIXES, 'dve jabolki', 'x')).toThrow(/one word/);
    expect(() => addFix(FIXES, 'bravo!', 'x')).toThrow(/one word/);
  });
});

describe('uniqueWords', () => {
  it('lists each word once in Slovenian order, without punctuation', () => {
    expect(uniqueWords(['Čebela, cvet!', 'cvet zebra', 'Žaba'])).toEqual(['cvet', 'čebela', 'zebra', 'žaba']);
  });
});

describe('markStress', () => {
  it('capitalizes the stressed vowel', () => {
    expect(markStress('tukaj', 'tukˈaːj')).toBe('tukAj');
    expect(markStress('tukaj', 'tˈuːkaj')).toBe('tUkaj');
    expect(markStress('domov', 'dɔmˈɔːw')).toBe('domOv');
    expect(markStress('jabolki', 'jabˈoːwki')).toBe('jabOlki');
  });

  it('skips the vowel espeak sounds before a syllabic r', () => {
    expect(markStress('rdečega', 'ərdɛtʃˈeːɡa')).toBe('rdečEga');
  });

  it('leaves a word alone when there is only one place the stress can go', () => {
    expect(markStress('dve', 'dʋˈeː')).toBe('dve');
  });

  it('leaves a word alone when espeak marked no stress', () => {
    expect(markStress('jabolki', 'jabowki')).toBe('jabolki');
  });
});
