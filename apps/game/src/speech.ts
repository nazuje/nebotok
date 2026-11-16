import type { Language, Mood, Npc, TalkCue } from '@nebotok/core';
import { voiceClip, type VoiceClips } from './voice-clips.ts';

/** A character's voice from npcs.json: `pitch` 1 (low) to 5 (high), `pace` 1 (slow) to 3 (quick). */
export type Voice = Npc['voice'];

/** Plays one clip at a time: a new one cuts off the one before. */
export type ClipPlayer = {
  play(url: string): void;
  stop(): void;
};

/**
 * The sound of the game's words: each talk line in its speaker's voice and each new quest hint,
 * read aloud while the player has "Read to me" on, and any of them again when a speaker button is
 * tapped, whatever the setting. A line without a clip is silent.
 */
export type Speech = {
  /** A talk line starts typing. `voice` is null for the narrator. It cuts off any clip still playing. */
  onLine(voice: Voice | null, text: string, mood: Mood | null): void;
  onCue(cue: TalkCue): void;
  /** A quest banner with this hint shows: read in the narrator's voice while "Read to me" is on. */
  onHint(text: string): void;
  /** A speaker button was tapped: plays `text` now, setting or not. */
  say(voice: Voice | null, text: string): void;
  /** Whether `text` has a clip in `voice`, so a speaker button for it would play something. */
  has(voice: Voice | null, text: string): boolean;
  /** The talk closed or the player left: whatever plays stops. */
  stop(): void;
};

export type SpeechOptions = {
  language(): Language;
  /** The player's "Read to me" setting, as the server last sent it; off until it has. */
  readToMe(): boolean;
  player: ClipPlayer;
  clips?: VoiceClips;
};

export function createSpeech(options: SpeechOptions): Speech {
  const clip = (voice: Voice | null, text: string) => voiceClip(options.language(), voice, text, options.clips);
  const say = (voice: Voice | null, text: string) => {
    const url = clip(voice, text);
    if (url === null) options.player.stop();
    else options.player.play(url);
  };
  const read = (voice: Voice | null, text: string) => {
    if (options.readToMe()) say(voice, text);
    else options.player.stop();
  };
  return {
    onLine: (voice, text) => read(voice, text),
    onCue: () => undefined,
    onHint: (text) => {
      if (options.readToMe()) say(null, text);
    },
    say,
    has: (voice, text) => clip(voice, text) !== null,
    stop: () => options.player.stop(),
  };
}
