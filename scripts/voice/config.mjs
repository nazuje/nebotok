// How the voices sound, in one place. Every setting here is part of each clip's name, so changing
// one makes the next `npm run voice` remake every clip it touches.
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Where `npm run voice:setup` keeps the Python environment and the models, shared by every worktree. */
export const VOICE_HOME = process.env.NEBOTOK_VOICE_HOME ?? join(homedir(), '.cache', 'nebotok-voice');

/**
 * One Piper voice per language, with the espeak-ng language that turns its text into sounds (the
 * one its model was trained with) and its speed `lengthScale`: bigger is slower.
 */
export const VOICES = {
  en: { model: 'en_GB-cori-medium', espeak: 'en-gb', lengthScale: 1.1 },
  sl: { model: 'sl_SI-artur-medium', espeak: 'sl', lengthScale: 1.12 },
};

/** Both models speak at this rate; the pitch shift is worked out from it. */
export const SAMPLE_RATE = 22050;

/** A character's `voice.pitch` in npcs.json (1 low to 5 high), in semitones from the voice's own. */
export const PITCH_SEMITONES = { 1: -3, 2: -1.5, 3: 0, 4: 1.5, 5: 3 };

/** A character's `voice.pace` (1 slow to 3 quick), as a factor on the language's `lengthScale`. */
export const PACE_SCALE = { 1: 1.15, 2: 1, 3: 0.88 };

/** The narrator, the player's choices and quest text: the language's voice as it is. */
export const NARRATOR_VOICE = { pitch: 3, pace: 2 };

const TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB';

/** Trims silence at both ends (the second trim runs on the reversed audio), then evens out the loudness. */
export const AUDIO_FILTER = `${TRIM},areverse,${TRIM},areverse,loudnorm=I=-16:TP=-1.5`;

export const MP3_ARGS = ['-ar', '22050', '-ac', '1', '-b:a', '48k'];
