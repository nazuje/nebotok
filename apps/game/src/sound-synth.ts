import { layerMs, type SoundLayer, type SoundRecipe } from '@nebotok/core';
import { envelopePoints, layerGain, pitchTimes } from './sound-mix.ts';
import type { Synth } from './sound-player.ts';

/** Seconds of white noise kept to loop for noise layers. */
const NOISE_SECONDS = 1;
/** How long a change of the master gain takes, in seconds, so it never clicks. */
const MASTER_EASE_S = 0.05;

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } };

/**
 * Plays recipes with Web Audio: an oscillator or looped noise per layer, shaped by a gain envelope,
 * through one master gain. The AudioContext is made by `unlock`, which a tap calls, because browsers
 * let a page make sound only after one. With `silent`, the sounds are made but never reach the
 * speakers, for headless checks in browsers that cannot be muted.
 */
export function createWebAudioSynth(silent: boolean): Synth & { unlock(): boolean } {
  let context: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let gain = 1;

  const noiseBuffer = (audio: AudioContext): AudioBuffer => {
    if (noise) return noise;
    noise = audio.createBuffer(1, audio.sampleRate * NOISE_SECONDS, audio.sampleRate);
    const samples = noise.getChannelData(0);
    for (let at = 0; at < samples.length; at += 1) samples[at] = Math.random() * 2 - 1;
    return noise;
  };

  const source = (audio: AudioContext, layer: SoundLayer, begin: number): AudioScheduledSourceNode => {
    if (layer.kind === 'tone') {
      const tone = audio.createOscillator();
      tone.type = layer.wave;
      pitchTimes(layer.steps).forEach(({ ms, hz }, at) => {
        if (at === 0 || !layer.glide) tone.frequency.setValueAtTime(hz, begin + ms / 1_000);
        else tone.frequency.linearRampToValueAtTime(hz, begin + ms / 1_000);
      });
      return tone;
    }
    const hiss = audio.createBufferSource();
    hiss.buffer = noiseBuffer(audio);
    hiss.loop = true;
    return hiss;
  };

  const playLayer = (audio: AudioContext, out: AudioNode, sound: SoundRecipe, layer: SoundLayer) => {
    const begin = audio.currentTime + layer.startMs / 1_000;
    const envelope = audio.createGain();
    envelope.gain.setValueAtTime(0, begin);
    for (const point of envelopePoints(layer, layerGain(sound, layer))) envelope.gain.linearRampToValueAtTime(point.gain, begin + point.ms / 1_000);
    envelope.connect(out);
    const from = source(audio, layer, begin);
    if (layer.kind === 'noise') {
      const filter = audio.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = layer.filterHz;
      from.connect(filter).connect(envelope);
    } else {
      from.connect(envelope);
    }
    from.addEventListener('ended', () => envelope.disconnect());
    from.start(begin);
    from.stop(begin + layerMs(layer) / 1_000);
  };

  return {
    unlock: () => {
      if (!context) {
        // On iPhone and iPad, the ring/silent switch then mutes the game, and its sounds mix with other audio.
        const session = (navigator as AudioSessionNavigator).audioSession;
        if (session) session.type = 'ambient';
        context = new AudioContext();
        master = context.createGain();
        master.gain.value = gain;
        if (!silent) master.connect(context.destination);
      }
      if (context.state !== 'running') void context.resume().catch(() => {});
      return context.state === 'running';
    },
    ready: () => context?.state === 'running',
    // Only a running context: one still waking would save every sound for one burst once it runs.
    play: (sound) => {
      if (context?.state !== 'running' || !master) return;
      for (const layer of sound.layers) playLayer(context, master, sound, layer);
    },
    master: (next) => {
      gain = next;
      if (context && master) master.gain.setTargetAtTime(next, context.currentTime, MASTER_EASE_S / 3);
    },
  };
}
