import { describe, expect, it } from 'vitest';
import npcs from '../../../../content/npcs.json' with { type: 'json' };
import sounds from '../../../../content/sounds.json' with { type: 'json' };
import species from '../../../../content/creatures/species.json' with { type: 'json' };
import { BABBLE_SOUND, SoundRecipe, SoundsFile, SpeciesFile, babbleStarts, babbleSyllable, checkContentFile, speciesCry } from '../../src/index.ts';

const BASE = SoundsFile.parse(sounds).sounds.find((sound) => sound.id === BABBLE_SOUND)!;
const VOICES = [null, ...npcs.npcs.map((npc) => npc.voice)];
const SPECIES = SpeciesFile.parse(species).species;
const LINE = 'Welcome to the Sky Post! Bring this letter to Mehurka.';
const pitchOf = (recipe: SoundRecipe) => (recipe.layers[0]?.kind === 'tone' ? recipe.layers[0].steps[0]!.hz : 0);

/** The mean first pitch of the line's syllables at a voice's `pitch`. */
function meanPitch(pitch: number): number {
  const pitches = babbleStarts(LINE, 2).map((_, at) => pitchOf(babbleSyllable(BASE, { pitch, pace: 2 }, LINE, at)));
  return pitches.reduce((sum, hz) => sum + hz, 0) / pitches.length;
}

describe('babble', () => {
  it('has its recipe in sounds.json', () => {
    expect(BASE).toBeDefined();
  });

  it('starts a syllable at every word and every few letters of a long one, none on spaces or punctuation', () => {
    expect(babbleStarts('Hi, Sky-Post friend!', 2)).toEqual([0, 4, 8, 13, 17]);
    expect(babbleStarts('...', 2)).toEqual([]);
    expect(babbleStarts('Poštar Bavko', 1)).toEqual([0, 3, 7, 10]);
    expect(babbleStarts(LINE, 3).length).toBeLessThan(babbleStarts(LINE, 1).length);
  });

  it('makes the same syllables for the same line every time, and other ones for another line', () => {
    const voice = { pitch: 2, pace: 2 };
    const syllables = (line: string) => babbleStarts(line, 2).map((_, at) => babbleSyllable(BASE, voice, `bavko|${line}`, at));
    expect(syllables(LINE)).toEqual(syllables(LINE));
    expect(syllables(LINE).map(pitchOf)).not.toEqual(syllables('Rain again, and the mail bags are soaked through.').map(pitchOf));
  });

  it('sounds higher for a higher voice', () => {
    for (let pitch = 1; pitch < 5; pitch += 1) expect(meanPitch(pitch + 1)).toBeGreaterThan(meanPitch(pitch));
  });

  it('keeps every syllable of every voice within the sound schema, the narrator\'s the quietest', () => {
    for (const voice of VOICES) {
      for (let at = 0; at < 40; at += 1) expect(SoundRecipe.safeParse(babbleSyllable(BASE, voice, LINE, at)).success).toBe(true);
    }
    for (let at = 0; at < 40; at += 1) expect(babbleSyllable(BASE, null, LINE, at).volume).toBeLessThan(BASE.volume);
  });
});

describe('creature cries', () => {
  it('gives every species in species.json a cry within the sound schema', () => {
    expect(SPECIES.filter((each) => !SoundRecipe.safeParse(speciesCry(each)).success).map((each) => each.id)).toEqual([]);
  });

  it('makes the same cry for a species every time, and a different one for each species', () => {
    const cries = SPECIES.map((each) => JSON.stringify(speciesCry(each)));
    expect(SPECIES.map((each) => JSON.stringify(speciesCry({ ...each })))).toEqual(cries);
    expect(new Set(cries).size).toBe(SPECIES.length);
  });

  it('plays a species\' own cry from species.json instead of a made one', () => {
    const cry = { volume: 40, layers: [{ kind: 'tone' as const, startMs: 0, volume: 100, envelope: { attackMs: 10, releaseMs: 100 }, wave: 'sine' as const, steps: [{ hz: 600, ms: 120 }, { hz: 800, ms: 120 }], glide: true }] };
    const file = { species: [{ ...species.species[0], cry }] };
    expect(checkContentFile('creatures/species.json', file)).toEqual({ ok: true });
    expect(speciesCry(SpeciesFile.parse(file).species[0]!)).toEqual(cry);
  });

  it('refuses a cry that breaks the sound schema', () => {
    const tooLong = { volume: 40, layers: [{ kind: 'tone', startMs: 0, volume: 100, envelope: { attackMs: 10, releaseMs: 10 }, wave: 'sine', steps: [{ hz: 600, ms: 3_000 }, { hz: 800, ms: 100 }], glide: true }] };
    for (const cry of [tooLong, { ...tooLong, id: 'cry.glowbun' }, { volume: 40, layers: [] }]) {
      expect(checkContentFile('creatures/species.json', { species: [{ ...species.species[0], cry }] }).ok).toBe(false);
    }
  });
});
