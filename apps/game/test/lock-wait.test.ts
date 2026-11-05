import { describe, expect, it } from 'vitest';
import { lockedNotice, lockedTag, pluralForm, roundWait, waitPhrase } from '../src/lock-wait.ts';

describe('rounding a lock for a player', () => {
  it('rounds every lock the server gives (1, 2, 4, 8, 16, 32 and 60 minutes) up, never down', () => {
    expect([60, 120, 240, 480, 960, 1920, 3600].map(roundWait)).toEqual([
      { kind: 'minute' },
      { kind: 'minutes', minutes: 2, about: false },
      { kind: 'minutes', minutes: 4, about: false },
      { kind: 'minutes', minutes: 10, about: true },
      { kind: 'minutes', minutes: 20, about: true },
      { kind: 'minutes', minutes: 35, about: true },
      { kind: 'hour' },
    ]);
  });

  it('counts down through the edges', () => {
    expect(roundWait(1)).toEqual({ kind: 'minute' });
    expect(roundWait(61)).toEqual({ kind: 'minutes', minutes: 2, about: false });
    expect(roundWait(300)).toEqual({ kind: 'minutes', minutes: 5, about: false });
    expect(roundWait(301)).toEqual({ kind: 'minutes', minutes: 10, about: true });
    expect(roundWait(3300)).toEqual({ kind: 'minutes', minutes: 55, about: true });
    expect(roundWait(3301)).toEqual({ kind: 'hour' });
  });
});

describe('Slovenian number agreement', () => {
  it('has four forms that follow the last two digits', () => {
    expect([1, 2, 3, 4, 5, 11, 21, 101, 102, 103, 105].map((n) => pluralForm(n, 'sl'))).toEqual(['one', 'two', 'few', 'few', 'other', 'other', 'other', 'one', 'two', 'few', 'other']);
  });

  it('English has two', () => {
    expect([1, 2, 5].map((n) => pluralForm(n, 'en'))).toEqual(['one', 'other', 'other']);
  });

  it('puts minutes in the form a Slovenian sentence needs', () => {
    expect([60, 120, 180, 240, 300, 1800, 3600].map((s) => waitPhrase(s, 'sl'))).toEqual(['minuto', '2 minuti', '3 minute', '4 minute', '5 minut', 'približno 30 minut', 'eno uro']);
  });
});

describe('lock messages', () => {
  it('says the real wait in English', () => {
    expect(lockedNotice(60, 'en')).toBe('Too many tries. Wait a minute, then try again.');
    expect(lockedNotice(120, 'en')).toBe('Too many tries. Wait 2 minutes, then try again.');
    expect(lockedNotice(480, 'en')).toBe('Too many tries. Wait about 10 minutes, then try again.');
    expect(lockedNotice(3600, 'en')).toBe('Too many tries. Wait an hour, then try again.');
    expect(lockedTag(45, 'en')).toBe('Locked for a minute');
    expect(lockedTag(240, 'en')).toBe('Locked for 4 minutes');
  });

  it('says the real wait in Slovenian', () => {
    expect(lockedNotice(60, 'sl')).toBe('Preveč poskusov. Počakaj minuto in poskusi znova.');
    expect(lockedNotice(120, 'sl')).toBe('Preveč poskusov. Počakaj 2 minuti in poskusi znova.');
    expect(lockedNotice(960, 'sl')).toBe('Preveč poskusov. Počakaj približno 20 minut in poskusi znova.');
    expect(lockedNotice(3600, 'sl')).toBe('Preveč poskusov. Počakaj eno uro in poskusi znova.');
    expect(lockedTag(200, 'sl')).toBe('Zaklenjeno za 4 minute');
    expect(lockedTag(3600, 'sl')).toBe('Zaklenjeno za eno uro');
  });
});
