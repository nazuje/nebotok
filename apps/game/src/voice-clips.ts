import type { Language } from '@nebotok/core';
import type { Voice } from './speech.ts';
import manifest from './voice-clips.json';

/**
 * The pre-made clips, by language, then voice (`voiceKey`), then the exact line, to a file in
 * public/voice/<language>/. `npm run voice` writes it from content/; content:validate checks it.
 */
export type VoiceClips = Readonly<Record<Language, Readonly<Record<string, Readonly<Record<string, string>>>>>>;

const CLIPS: VoiceClips = manifest;

/** The manifest's name for a voice: `narrator`, or a character's npcs.json pitch and pace. */
export const voiceKey = (voice: Voice | null): string => (voice === null ? 'narrator' : `pitch${voice.pitch}-pace${voice.pace}`);

/**
 * Where the game's own server has the clip of `text` said in `voice`: the speaker's voice for a
 * talk line (as `Speech.onLine` gets it), null for the narrator, choices and quest text. Null when
 * there is no clip, as for a line with a {placeholder}.
 */
export function voiceClip(language: Language, voice: Voice | null, text: string, clips: VoiceClips = CLIPS): string | null {
  const lines = clips[language];
  const key = voiceKey(voice);
  if (!Object.hasOwn(lines, key)) return null;
  const files = lines[key]!;
  return Object.hasOwn(files, text) ? `/voice/${language}/${files[text]}` : null;
}
