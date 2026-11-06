import type { Mood, Npc, TalkCue } from '@nebotok/core';

/** A character's voice from npcs.json: `pitch` 1 (low) to 5 (high), `pace` 1 (slow) to 3 (quick). */
export type Voice = Npc['voice'];

/**
 * The sound of a talk: each line's babble in its speaker's voice, and each cue's sound. The talk
 * box calls it as a line starts and as a node with a cue opens. It makes no sound yet: the game
 * plays nothing until sound is designed in.
 */
export type Speech = {
  /** A line starts typing. `voice` is null for the narrator. */
  onLine(voice: Voice | null, text: string, mood: Mood | null): void;
  onCue(cue: TalkCue): void;
};

export function createSpeech(): Speech {
  return {
    onLine: () => undefined,
    onCue: () => undefined,
  };
}
