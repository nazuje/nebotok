/**
 * Babble: the short syllable blips a character "talks" in while their line types (docs/design.md).
 * Every syllable is the `talk.babble` recipe from sounds.json, moved to the speaker's voice and
 * varied a little by a seed made from the line, so a line babbles the same way every time. The
 * narrator's babble is soft and level.
 */
import { createRng } from './rng.ts';
import type { SoundLayer, SoundRecipe } from './sound-content.ts';

/** A voice as npcs.json gives it: `pitch` 1 (low) to 5 (high), `pace` 1 (slow) to 3 (quick). */
export type BabbleVoice = { readonly pitch: number; readonly pace: number };

/** The id in sounds.json of the recipe every syllable is made from. */
export const BABBLE_SOUND = 'talk.babble';

/** Letters typed per syllable within a word, at each pace: every word starts one, and a long word has more. */
export const LETTERS_PER_SYLLABLE: Readonly<Record<number, number>> = { 1: 3, 2: 4, 3: 5 };

/** A syllable's pitch, in percent of the recipe's, at `voice.pitch` 1 to 5. */
const PITCH_PERCENT: readonly number[] = [70, 85, 100, 120, 145];
/** A syllable's length, in percent of the recipe's, at each pace: slow talkers draw theirs out. */
const PACE_PERCENT: Readonly<Record<number, number>> = { 1: 115, 2: 100, 3: 85 };
/** The middle pitch and pace, which the narrator speaks at. */
const MIDDLE = { pitch: 3, pace: 2 };

/**
 * How far a syllable may stray, in percent: its pitch, its length, and its later pitch steps from
 * its first; and its volume, in percent of the recipe's. The narrator's babble strays less and is quieter.
 */
const SPREAD = {
  speaker: { pitch: 10, length: 15, contour: 8, volume: 100 },
  narrator: { pitch: 4, length: 8, contour: 3, volume: 60 },
} as const;

const LETTER = /[\p{L}\p{N}]/u;
const MIN_HZ = 20;
const MAX_HZ = 12_000;
const MIN_MS = 10;
const MAX_ATTACK_MS = 1_000;

/**
 * Where each syllable of `say` starts, as a count of the line's characters typed before it: at the
 * first letter of every word, and every `LETTERS_PER_SYLLABLE[pace]` letters after it in a long word.
 * Spaces and punctuation start none, so the babble pauses between words.
 */
export function babbleStarts(say: string, pace: number): number[] {
  const per = LETTERS_PER_SYLLABLE[pace] ?? LETTERS_PER_SYLLABLE[MIDDLE.pace]!;
  const starts: number[] = [];
  let letters = 0;
  for (let at = 0; at < say.length; at += 1) {
    if (!LETTER.test(say.charAt(at))) {
      letters = 0;
      continue;
    }
    if (letters % per === 0) starts.push(at);
    letters += 1;
  }
  return starts;
}

const hzAt = (hz: number, percentSquared: number): number => Math.min(MAX_HZ, Math.max(MIN_HZ, Math.round((hz * percentSquared) / 10_000)));
const msAt = (ms: number, percentSquared: number): number => Math.max(MIN_MS, Math.round((ms * percentSquared) / 10_000));

/** The envelope scaled with its layer, kept inside the layer's new length. */
function fitted(envelope: SoundLayer['envelope'], length: number, layerMs: number): SoundLayer['envelope'] {
  const attackMs = Math.min(MAX_ATTACK_MS, layerMs, Math.round((envelope.attackMs * length) / 10_000));
  return { attackMs, releaseMs: Math.min(layerMs - attackMs, Math.round((envelope.releaseMs * length) / 10_000)) };
}

function varied(layer: SoundLayer, pitch: number, length: number, contour: number): SoundLayer {
  const startMs = Math.round((layer.startMs * length) / 10_000);
  if (layer.kind === 'noise') {
    const ms = msAt(layer.ms, length);
    return { ...layer, startMs, ms, filterHz: hzAt(layer.filterHz, pitch), envelope: fitted(layer.envelope, length, ms) };
  }
  const steps = layer.steps.map((step, at) => ({ hz: hzAt(step.hz, at === 0 ? pitch : (pitch * (100 + contour)) / 100), ms: msAt(step.ms, length) }));
  return { ...layer, startMs, steps, envelope: fitted(layer.envelope, length, steps.reduce((sum, step) => sum + step.ms, 0)) };
}

/**
 * The syllable number `index` of a line, from the `base` recipe (sounds.json's `talk.babble`), in
 * `voice`, or the narrator's when null. `seed` names the line, so the same line in the same voice
 * always makes the same syllables; no two lines need be alike.
 */
export function babbleSyllable(base: SoundRecipe, voice: BabbleVoice | null, seed: string, index: number): SoundRecipe {
  const spread = voice ? SPREAD.speaker : SPREAD.narrator;
  const { pitch, pace } = voice ?? MIDDLE;
  const rng = createRng(`${seed}#${index}`);
  const pitchPercent = (PITCH_PERCENT[pitch - 1] ?? 100) * (100 + rng.int(-spread.pitch, spread.pitch));
  const lengthPercent = (PACE_PERCENT[pace] ?? 100) * (100 + rng.int(-spread.length, spread.length));
  const contour = rng.int(-spread.contour, spread.contour);
  return {
    volume: Math.max(1, Math.round((base.volume * spread.volume) / 100)),
    layers: base.layers.map((layer) => varied(layer, pitchPercent, lengthPercent, contour)),
  };
}
