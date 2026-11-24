import { BABBLE_SOUND, SoundsFile, babbleStarts, type SoundRecipe, type Species } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import sounds from '../../../content/sounds.json' with { type: 'json' };
import species from '../../../content/creatures/species.json' with { type: 'json' };
import { createSoundPlayer } from '../src/sound-player.ts';
import { CRY_GAP_MS, createCries } from '../src/sounds-creatures.ts';
import { createBabble, type BabbleLine } from '../src/sounds-talk.ts';

const FILE = SoundsFile.parse(sounds);
const SAY = 'Welcome to the Sky Post! Bring this letter to Mehurka.';
const STARTS = babbleStarts(SAY, 2);

/** A sound player whose synth keeps the recipes it was asked to play. */
function player() {
  const heard: SoundRecipe[] = [];
  const sound = createSoundPlayer({ file: FILE, synth: { ready: () => true, play: (recipe) => heard.push(recipe), master: () => {} }, now: () => 0, vibrate: null });
  return { sound, heard, labels: () => sound.state().played.map((each) => each.id) };
}

const line = (typed: number, more: Partial<BabbleLine> = {}): BabbleLine => ({ key: '1:start:en', speaker: 'bavko', voice: { pitch: 2, pace: 2 }, say: SAY, pace: 2, typed, voiced: false, ...more });

/** Types the line letter by letter, a frame each, up to `upTo` letters. */
function typeOut(babble: ReturnType<typeof createBabble>, upTo = SAY.length, more: Partial<BabbleLine> = {}) {
  for (let typed = 0; typed <= upTo; typed += 1) babble.frame(line(typed, more));
}

describe('babble', () => {
  it('plays a syllable in the speaker\'s voice for every syllable of the line as it types, recorded by speaker', () => {
    const { sound, heard, labels } = player();
    const babble = createBabble(sound);
    typeOut(babble);
    expect(heard).toHaveLength(STARTS.length);
    expect(babble.played()).toBe(STARTS.length);
    expect(new Set(labels())).toEqual(new Set([`${BABBLE_SOUND}:bavko`]));
  });

  it('is the same for the same line every time', () => {
    const first = player();
    typeOut(createBabble(first.sound));
    const again = player();
    typeOut(createBabble(again.sound));
    expect(again.heard).toEqual(first.heard);
  });

  it('records the narrator\'s babble as the narrator\'s', () => {
    const { sound, labels } = player();
    typeOut(createBabble(sound), SAY.length, { speaker: null, voice: null });
    expect(new Set(labels())).toEqual(new Set([`${BABBLE_SOUND}:narrator`]));
  });

  it('stops the moment a tap shows the line whole', () => {
    const { sound, heard } = player();
    const babble = createBabble(sound);
    typeOut(babble, 10);
    const before = heard.length;
    expect(before).toBeGreaterThan(0);
    for (let frame = 0; frame < 20; frame += 1) babble.frame(line(SAY.length));
    expect(heard).toHaveLength(before);
  });

  it('is silent while a "Read to me" clip reads the line, and babbles the next line that has none', () => {
    const { sound, heard } = player();
    const babble = createBabble(sound);
    typeOut(babble, SAY.length, { voiced: true });
    expect(heard).toEqual([]);
    expect(babble.played()).toBe(0);
    typeOut(babble, SAY.length, { key: '1:next:en' });
    expect(heard).toHaveLength(STARTS.length);
  });

  it('plays one syllable for a slow frame that skips several, never a burst', () => {
    const { sound, heard } = player();
    const babble = createBabble(sound);
    babble.frame(line(0));
    babble.frame(line(30));
    expect(heard).toHaveLength(1);
  });

  it('plays and records nothing while sounds are off', () => {
    const { sound, heard } = player();
    sound.setOn(false);
    typeOut(createBabble(sound));
    expect(heard).toEqual([]);
    expect(sound.state().played).toEqual([]);
  });
});

describe('creature cries', () => {
  const all = new Map((species.species as Species[]).map((each) => [each.id, each]));
  const cries = () => {
    const made = player();
    return { ...made, cries: createCries(made.sound, (id) => all.get(id)) };
  };

  it('plays a species\' cry recorded as cry:<species>, and nothing for a species the page does not know', () => {
    const { cries: creatures, labels } = cries();
    creatures.cry('glowbun', 0);
    creatures.cry('no-such-creature', 2_000);
    expect(labels()).toEqual(['cry:glowbun']);
  });

  it('plays two cries asked for together one after the other', () => {
    const { cries: creatures, labels } = cries();
    creatures.cry('glowbun', 0);
    creatures.cry('baskit', 0);
    expect(labels()).toEqual(['cry:glowbun']);
    creatures.frame(CRY_GAP_MS - 1);
    expect(labels()).toEqual(['cry:glowbun']);
    creatures.frame(CRY_GAP_MS);
    expect(labels()).toEqual(['cry:glowbun', 'cry:baskit']);
  });

  it('cries once as a creature enters, again only in another fight', () => {
    const { cries: creatures, labels } = cries();
    for (let frame = 0; frame < 5; frame += 1) creatures.entered('fight-1', '1:a', 'glowbun', frame * CRY_GAP_MS);
    creatures.entered('fight-2', '1:a', 'glowbun', 10 * CRY_GAP_MS);
    expect(labels()).toEqual(['cry:glowbun', 'cry:glowbun']);
  });
});
