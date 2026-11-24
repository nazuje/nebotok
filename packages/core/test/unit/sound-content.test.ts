import { describe, expect, it } from 'vitest';
import sounds from '../../../../content/sounds.json' with { type: 'json' };
import { MAX_DUCK_PERCENT, MAX_SOUND_MS, SoundsFile, checkContentFile, soundMs } from '../../src/index.ts';

const tap = { id: 'ui.tap', volume: 40, layers: [{ kind: 'tone', startMs: 0, volume: 100, envelope: { attackMs: 2, releaseMs: 30 }, wave: 'triangle', steps: [{ hz: 740, ms: 40 }], glide: false }] };
const noise = { kind: 'noise', startMs: 20, volume: 50, envelope: { attackMs: 1, releaseMs: 50 }, ms: 60, filterHz: 1_500 };
const file = (sound: unknown, more: object = {}) => ({ volume: 70, duckPercent: 30, sounds: [sound], ...more });

describe('sound recipes', () => {
  it('accepts the real sounds.json and a tone with a noise layer', () => {
    expect(checkContentFile('sounds.json', sounds)).toEqual({ ok: true });
    expect(checkContentFile('sounds.json', file({ ...tap, layers: [...tap.layers, noise] }))).toEqual({ ok: true });
  });

  it('measures a sound from its start to its last layer\'s end', () => {
    expect(soundMs(SoundsFile.parse(file({ ...tap, layers: [...tap.layers, noise] })).sounds[0]!)).toBe(80);
  });

  it('refuses a repeated id, a bad id, an unknown wave, a url and a sound too long or too quiet to hear', () => {
    const [layer] = tap.layers;
    for (const bad of [
      { ...file(tap), sounds: [tap, tap] },
      file({ ...tap, id: 'tap' }),
      file({ ...tap, id: 'UI.Tap' }),
      file({ ...tap, layers: [{ ...layer, wave: 'organ' }] }),
      file({ ...tap, layers: [{ ...layer, url: '/sounds/tap.mp3' }] }),
      file({ ...tap, layers: [layer, { ...noise, startMs: MAX_SOUND_MS - 50 }] }),
      file({ ...tap, layers: [{ ...layer, envelope: { attackMs: 30, releaseMs: 30 } }] }),
      file({ ...tap, layers: [] }),
      file({ ...tap, volume: 0 }),
      file(tap, { duckPercent: MAX_DUCK_PERCENT + 1 }),
    ]) {
      expect(checkContentFile('sounds.json', bad).ok).toBe(false);
    }
  });
});
