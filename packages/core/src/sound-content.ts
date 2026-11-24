/**
 * Schema of `sounds.json`: every sound the game makes, as a recipe the page plays with Web Audio
 * (oscillators and noise shaped by an envelope). No sound is a file, so nothing is fetched to play
 * one. content/AGENTS.md, "Sounds", explains the format.
 */
import { z } from 'zod';
import { noRepeatedIds } from './content.ts';

/** The oscillator shapes Web Audio has built in. */
export const SOUND_WAVES = ['sine', 'triangle', 'square', 'sawtooth'] as const;
export type SoundWave = (typeof SOUND_WAVES)[number];

/** No sound lasts longer than this, from its first layer's start to its last layer's end. */
export const MAX_SOUND_MS = 3_000;
/** While a voice clip plays, effects play at most at this share of their volume, so the voice stays louder. */
export const MAX_DUCK_PERCENT = 50;

/** A sound's id: dotted lowercase words naming where it plays, such as `ui.tap` or `arena.hit`. */
export const SoundId = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*){1,3}$/, 'sound ids are dotted lowercase words, such as "ui.tap"').max(48);
export type SoundId = z.infer<typeof SoundId>;

const Hz = z.number().int().min(20).max(12_000);
const Percent = z.number().int().min(1).max(100);

/** One pitch held for `ms`; a tone plays its steps one after another. */
const PitchStep = z.strictObject({ hz: Hz, ms: z.number().int().min(10).max(MAX_SOUND_MS) });

/** How a layer fades in from silence and back out to it, inside its own length. */
const Envelope = z.strictObject({ attackMs: z.number().int().min(0).max(1_000), releaseMs: z.number().int().min(0).max(MAX_SOUND_MS) });

/** What every layer has: when it starts after the sound does, how loud it is and its envelope. */
const layerBase = { startMs: z.number().int().min(0).max(MAX_SOUND_MS), volume: Percent, envelope: Envelope };

/** An oscillator: its `wave` and pitch `steps`; with `glide` the pitch slides from step to step instead of jumping. */
const ToneLayer = z.strictObject({ kind: z.literal('tone'), ...layerBase, wave: z.enum(SOUND_WAVES), steps: z.array(PitchStep).min(1).max(16), glide: z.boolean() });

/** White noise for `ms`, through a low-pass filter at `filterHz` (a lower number sounds duller). */
const NoiseLayer = z.strictObject({ kind: z.literal('noise'), ...layerBase, ms: z.number().int().min(10).max(MAX_SOUND_MS), filterHz: Hz });

export const SoundLayer = z.discriminatedUnion('kind', [ToneLayer, NoiseLayer]);
export type SoundLayer = z.infer<typeof SoundLayer>;

/** How long a layer lasts, from its own start. */
export function layerMs(layer: SoundLayer): number {
  return layer.kind === 'tone' ? layer.steps.reduce((sum, step) => sum + step.ms, 0) : layer.ms;
}

/** How long a whole sound lasts, from its start to its last layer's end. */
export function soundMs(sound: { readonly layers: readonly SoundLayer[] }): number {
  return Math.max(...sound.layers.map((layer) => layer.startMs + layerMs(layer)));
}

/** One sound: its `id`, its `volume` and 1 to 4 `layers` that play together. */
export const Sound = z
  .strictObject({ id: SoundId, volume: Percent, layers: z.array(SoundLayer).min(1).max(4) })
  .superRefine((sound, ctx) => {
    const total = soundMs(sound);
    if (total > MAX_SOUND_MS) ctx.addIssue({ code: 'custom', message: `"${sound.id}" lasts ${total} ms, more than ${MAX_SOUND_MS}`, path: ['layers'] });
    sound.layers.forEach((layer, at) => {
      const { attackMs, releaseMs } = layer.envelope;
      if (attackMs + releaseMs > layerMs(layer)) ctx.addIssue({ code: 'custom', message: `the envelope (${attackMs + releaseMs} ms) is longer than its layer (${layerMs(layer)} ms)`, path: ['layers', at, 'envelope'] });
    });
  });
export type Sound = z.infer<typeof Sound>;

/**
 * `sounds.json`: the master `volume` of every effect, `duckPercent`, the share of it they keep while
 * a "Read to me" clip plays (at most `MAX_DUCK_PERCENT`), and the `sounds`, each id once.
 */
export const SoundsFile = z
  .strictObject({ volume: Percent, duckPercent: z.number().int().min(0).max(MAX_DUCK_PERCENT), sounds: z.array(Sound).min(1).max(300) })
  .superRefine(({ sounds }, ctx) => noRepeatedIds(sounds, 'sounds', ctx));
export type SoundsFile = z.infer<typeof SoundsFile>;
