/**
 * Creature cries: each species' own `cry` recipe from species.json, or, for a species without one
 * (every placeholder now), a cry made from its weather type and id. Creatures of one type share a
 * wave and a tune, and each species has its own pitch and pace within it, so every creature has
 * a cry and the same creature always sounds the same.
 */
import type { Species } from './content.ts';
import { createRng } from './rng.ts';
import type { SoundRecipe, SoundWave } from './sound-content.ts';

/** Only the soft waves, so a made cry is never harsh. */
const CRY_WAVES: readonly SoundWave[] = ['triangle', 'sine'];
/** The tunes a type's made cries follow, each step in percent of the cry's pitch. */
const CRY_TUNES: readonly (readonly number[])[] = [
  [100, 130, 115],
  [125, 100, 85],
  [90, 120, 100, 125],
  [100, 115, 95, 110],
  [110, 140],
  [95, 125, 140, 110],
];
const CRY_VOLUME = 45;
/** The quieter layer an octave down, in percent of the cry's own, which makes it rounder. */
const UNDERTONE_VOLUME = 35;
const ATTACK_MS = 15;
/** The share of a made cry its fade out takes, in percent. */
const RELEASE_PERCENT = 40;

/** The cry of a species: its own `cry`, else one made from its weather `type` and `id`. */
export function speciesCry(species: Pick<Species, 'id' | 'type' | 'cry'>): SoundRecipe {
  if (species.cry) return species.cry;
  const kind = createRng(`cry-type:${species.type}`);
  const wave = kind.pick(CRY_WAVES);
  const tune = kind.pick(CRY_TUNES);
  const typeHz = kind.int(420, 620);
  const own = createRng(`cry:${species.id}`);
  const hz = Math.round((typeHz * own.int(85, 125)) / 100);
  const stepMs = own.int(70, 110);
  const steps = tune.map((percent) => ({ hz: Math.round((hz * percent) / 100), ms: stepMs }));
  const envelope = { attackMs: ATTACK_MS, releaseMs: Math.round((stepMs * tune.length * RELEASE_PERCENT) / 100) };
  return {
    volume: CRY_VOLUME,
    layers: [
      { kind: 'tone', startMs: 0, volume: 100, envelope, wave, steps, glide: true },
      { kind: 'tone', startMs: 0, volume: UNDERTONE_VOLUME, envelope, wave: 'sine', steps: steps.map(({ hz: high, ms }) => ({ hz: Math.round(high / 2), ms })), glide: true },
    ],
  };
}
