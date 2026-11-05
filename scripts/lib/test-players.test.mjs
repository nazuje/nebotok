import { describe, expect, it } from 'vitest';
import { ProfileName } from '../../packages/core/src/profile.ts';
import { botName, deviceName, isTestPlayer, lockedName, runTag } from './test-players.mjs';

const BROWSER_NAMES = ['chromium', 'webkit'];
const DEVICE_NAMES = ['iphone-portrait', 'ipad-landscape'];
const namesFor = (tag) => [
  botName(tag),
  ...BROWSER_NAMES.flatMap((browser) => ['Zaklep', 'Dvakrat'].map((lock) => lockedName(lock, browser, tag))),
  ...BROWSER_NAMES.flatMap((browser) => DEVICE_NAMES.flatMap((device) => ['en', 'sl'].map((language) => deviceName(browser, device, language, tag)))),
];

describe('test players', () => {
  it('tags a run with three letters, capital first', () => {
    expect(runTag(() => 0)).toBe('Aaa');
    expect(runTag(() => 25)).toBe('Zzz');
    for (let run = 0; run < 50; run += 1) expect(runTag()).toMatch(/^[A-Z][a-z]{2}$/);
  });

  it('makes names the server takes, all different, and recognises them', () => {
    const names = namesFor('Qeb');
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(names.length);
    for (const name of names) {
      expect(ProfileName.safeParse(name)).toEqual({ success: true, data: name });
      expect(isTestPlayer(name)).toBe(true);
    }
  });

  it('gives two runs different names', () => {
    const one = new Set(namesFor('Qeb'));
    expect(namesFor('Lum').some((name) => one.has(name))).toBe(false);
  });

  it('recognises the bare names of runs before tags', () => {
    for (const name of ['Bot Oblak', 'Kro Tel Abc', 'Web Tab Čšž', 'Zaklep Web', 'Dvakrat Kro']) expect(isTestPlayer(name)).toBe(true);
  });

  it('leaves every other player alone', () => {
    for (const name of ['Ana', 'Bot', 'Bot Oblak Qeb Lum', 'Kro Tel Abc QEB', 'Kro Tel Abc Qe', 'Scena Lan', 'Zaklep', 'kro tel abc', 'Oblak Bot Qeb']) {
      expect(isTestPlayer(name)).toBe(false);
    }
  });
});
