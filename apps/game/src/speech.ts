import type { Language, Mood, Npc, TalkCue } from '@nebotok/core';
import { voiceClip, type VoiceClips } from './voice-clips.ts';

/** A character's voice from npcs.json: `pitch` 1 (low) to 5 (high), `pace` 1 (slow) to 3 (quick). */
export type Voice = Npc['voice'];

/** Plays one clip at a time: a new one cuts off the one before. */
export type ClipPlayer = {
  /** `ended` runs once the clip has played through, or failed to; never when another clip or `stop` cut it off. */
  play(url: string, ended?: () => void): void;
  stop(): void;
};

/** Something said aloud: its words and the voice they are said in, null for the narrator. */
export type Spoken = { readonly voice: Voice | null; readonly text: string };

/**
 * The sound of the game's words: each talk line in its speaker's voice, then its choices in the
 * narrator's, and each new quest hint, read aloud while the player has "Read to me" on, and any of
 * them again when a speaker button is tapped, whatever the setting. A line without a clip is
 * silent, and the next one is read.
 */
export type Speech = {
  /** A talk line starts typing. `voice` is null for the narrator. It cuts off any clip still playing; its `choices` are read after it. */
  onLine(voice: Voice | null, text: string, mood: Mood | null, choices?: readonly string[]): void;
  onCue(cue: TalkCue): void;
  /** A quest banner with this hint shows: read in the narrator's voice while "Read to me" is on. */
  onHint(text: string): void;
  /** A speaker button was tapped: plays `text`, then any `choices`, now, setting or not. */
  say(voice: Voice | null, text: string, choices?: readonly string[]): void;
  /** Whether `text` has a clip in `voice`, so a speaker button for it would play something. */
  has(voice: Voice | null, text: string): boolean;
  /** Whether "Read to me" reads `text` by itself as it starts: the setting is on and it has a clip in `voice`. */
  reads(voice: Voice | null, text: string): boolean;
  /** What is being read aloud now, or null between clips and once all are read. */
  speaking(): Spoken | null;
  /** The talk closed, a choice was tapped or the player left: whatever plays stops. */
  stop(): void;
};

export type SpeechOptions = {
  language(): Language;
  /** The player's "Read to me" setting, as the server last sent it; off until it has. */
  readToMe(): boolean;
  player: ClipPlayer;
  clips?: VoiceClips;
};

/** A line and then its choices, which are always in the narrator's voice. */
const lineAndChoices = (voice: Voice | null, text: string, choices: readonly string[]): Spoken[] => [{ voice, text }, ...choices.map((choice) => ({ voice: null, text: choice }))];

export function createSpeech(options: SpeechOptions): Speech {
  const clip = (voice: Voice | null, text: string) => voiceClip(options.language(), voice, text, options.clips);
  /** Counts the readings started, so a clip of one cut off never goes on to the next of its own. */
  let reading = 0;
  let now: Spoken | null = null;

  const stop = () => {
    reading += 1;
    now = null;
    options.player.stop();
  };
  /** Reads each of `said` that has a clip, one after another; with none, stops whatever plays. */
  const sayAll = (said: readonly Spoken[]) => {
    reading += 1;
    const mine = reading;
    const queue = said.flatMap((each) => {
      const url = clip(each.voice, each.text);
      return url === null ? [] : [{ ...each, url }];
    });
    if (queue.length === 0) {
      stop();
      return;
    }
    const next = () => {
      if (mine !== reading) return;
      const item = queue.shift();
      now = item ? { voice: item.voice, text: item.text } : null;
      if (item) options.player.play(item.url, next);
    };
    next();
  };
  const read = (said: readonly Spoken[]) => {
    if (options.readToMe()) sayAll(said);
    else stop();
  };
  return {
    onLine: (voice, text, _mood, choices = []) => read(lineAndChoices(voice, text, choices)),
    onCue: () => undefined,
    onHint: (text) => {
      if (options.readToMe()) sayAll([{ voice: null, text }]);
    },
    say: (voice, text, choices = []) => sayAll(lineAndChoices(voice, text, choices)),
    has: (voice, text) => clip(voice, text) !== null,
    reads: (voice, text) => options.readToMe() && clip(voice, text) !== null,
    speaking: () => now,
    stop,
  };
}
