import { SoundsFile, type Sound } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import sounds from '../../../content/sounds.json' with { type: 'json' };
import { envelopePoints, layerGain, masterGain, pitchTimes, PLAYED_KEPT } from '../src/sound-mix.ts';
import { createSoundPlayer, type Synth } from '../src/sound-player.ts';

const FILE = SoundsFile.parse(sounds);

/** A synth that keeps what it was asked instead of making sound. */
function fakeSynth(ready = true) {
  const heard: string[] = [];
  const masters: number[] = [];
  const synth: Synth = {
    ready: () => ready,
    play: (sound: Sound) => heard.push(sound.id),
    master: (gain) => masters.push(gain),
  };
  return { synth, heard, masters };
}

/** A player on a clock that moves on `stepMs` each time it is read. */
function player(ready = true, stepMs = 10) {
  const fake = fakeSynth(ready);
  const buzzes: number[][] = [];
  let now = 1_000;
  const sound = createSoundPlayer({ file: FILE, synth: fake.synth, now: () => (now += stepMs), vibrate: (pattern) => buzzes.push(pattern) });
  return { sound, buzzes, ...fake };
}

describe('the sound player', () => {
  it('plays the recipes sounds.json names and records each with its time', () => {
    const { sound, heard } = player();
    expect(sound.play('ui.tap')).toBe(true);
    expect(sound.play('quest.done')).toBe(true);
    expect(heard).toEqual(['ui.tap', 'quest.done']);
    expect(sound.state()).toEqual({ on: true, unlocked: true, played: [{ id: 'ui.tap', at: 1_010 }, { id: 'quest.done', at: 1_020 }] });
  });

  it('refuses an id that is not in sounds.json, and records nothing for it', () => {
    const { sound, heard } = player();
    for (const id of ['ui.boom', 'UI.TAP', '', 'https://example.com/tap.mp3']) expect(sound.play(id)).toBe(false);
    expect(heard).toEqual([]);
    expect(sound.state().played).toEqual([]);
  });

  it('plays, records and buzzes nothing while sounds are off, and again once they are on', () => {
    const { sound, heard, buzzes, masters } = player();
    sound.setOn(false);
    expect(sound.play('ui.tap')).toBe(false);
    expect(sound.vibrate([20])).toBe(false);
    expect(heard).toEqual([]);
    expect(buzzes).toEqual([]);
    expect(sound.state()).toMatchObject({ on: false, played: [] });
    expect(masters.at(-1)).toBe(0);
    sound.setOn(true);
    expect(sound.vibrate([20, 40])).toBe(true);
    expect(sound.play('arena.hit')).toBe(true);
    expect(buzzes).toEqual([[20, 40]]);
    expect(masters.at(-1)).toBe(masterGain(FILE, false));
  });

  it('records a sound asked for before a tap has unlocked the page, and leaves it to the synth', () => {
    const { sound, heard } = player(false);
    expect(sound.play('ui.tap')).toBe(true);
    expect(heard).toEqual(['ui.tap']);
    expect(sound.state()).toMatchObject({ unlocked: false, played: [{ id: 'ui.tap' }] });
  });

  it('keeps the last 30 sounds played', () => {
    const { sound } = player(true, 50);
    for (let at = 0; at < PLAYED_KEPT + 5; at += 1) sound.play(at % 2 === 0 ? 'ui.tap' : 'arena.hit');
    const { played } = sound.state();
    expect(played).toHaveLength(PLAYED_KEPT);
    expect(played[0]!.at).toBe(1_300);
  });

  it('drops the sounds of a burst past the cap, keeping room for one that must be heard, and records only those played', () => {
    const { sound, heard } = player(true, 1);
    const hits = Array.from({ length: 8 }, () => sound.play('arena.hit'));
    expect(hits.filter(Boolean)).toHaveLength(4);
    expect(sound.play('quest.done', 'keep')).toBe(true);
    expect(heard).toHaveLength(5);
    expect(sound.state().played.map((each) => each.id)).toEqual([...Array.from({ length: 4 }, () => 'arena.hit'), 'quest.done']);
  });

  it('counts cries and babble in the same burst, as ordinary sounds', () => {
    const { sound } = player(true, 1);
    const cry = FILE.sounds.find((each) => each.id === 'arena.hit')!;
    const cries = Array.from({ length: 3 }, () => sound.playRecipe('cry:glowbun', cry));
    expect(cries.every(Boolean)).toBe(true);
    expect(sound.play('arena.hit')).toBe(true);
    expect(sound.playRecipe('talk.babble:bavko', cry)).toBe(false);
    expect(sound.play('arena.fight.won', 'keep')).toBe(true);
  });

  it('says nothing can buzz on a device without vibration', () => {
    const sound = createSoundPlayer({ file: FILE, synth: fakeSynth().synth, now: () => 0, vibrate: null });
    expect(sound.vibrate([20])).toBe(false);
  });
});

describe('ducking under a voice clip', () => {
  it('lowers every effect to duckPercent of the master volume while a clip plays, and back after', () => {
    const { sound, masters } = player();
    expect(masters).toEqual([0.7]);
    sound.setDucked(true);
    expect(masters.at(-1)).toBeCloseTo(0.7 * 0.35);
    sound.setDucked(false);
    expect(masters.at(-1)).toBe(0.7);
  });

  it('keeps a ducked effect at most half as loud as it plays otherwise, so the voice always wins', () => {
    for (const duckPercent of [0, 20, 50]) {
      const file = { volume: 100, duckPercent };
      expect(masterGain(file, true)).toBeLessThanOrEqual(masterGain(file, false) / 2);
    }
    for (const recipe of FILE.sounds) {
      const loudest = Math.max(...recipe.layers.map((layer) => layerGain(recipe, layer) * masterGain(FILE, true)));
      expect(loudest).toBeLessThan(0.5);
    }
  });
});

describe('a recipe on the clock', () => {
  const tone = FILE.sounds.find((sound) => sound.id === 'quest.done')!.layers[0]!;

  it('starts each pitch step after the ones before it', () => {
    expect(pitchTimes([{ hz: 523, ms: 110 }, { hz: 659, ms: 110 }, { hz: 784, ms: 50 }])).toEqual([
      { ms: 0, hz: 523 },
      { ms: 110, hz: 659 },
      { ms: 220, hz: 784 },
    ]);
  });

  it('rises from silence over the attack, holds and falls back to silence by the layer\'s end', () => {
    expect(tone.kind).toBe('tone');
    expect(envelopePoints(tone, 0.5)).toEqual([
      { ms: 0, gain: 0 },
      { ms: 5, gain: 0.5 },
      { ms: 690 - 260, gain: 0.5 },
      { ms: 690, gain: 0 },
    ]);
    expect(layerGain({ volume: 60 }, { volume: 50 })).toBeCloseTo(0.3);
  });
});
