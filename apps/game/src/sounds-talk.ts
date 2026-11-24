import { BABBLE_SOUND, NARRATOR, babbleStarts, babbleSyllable, type BabbleVoice } from '@nebotok/core';
import type { SoundPlayer } from './sound-player.ts';

/** A talk line as its babble needs it, this frame. */
export type BabbleLine = {
  /** Another key is another line, which babbles from its start. */
  readonly key: string;
  /** The character who says it, or null for the narrator. */
  readonly speaker: string | null;
  /** The speaker's voice from npcs.json, or null for the narrator's soft one. */
  readonly voice: BabbleVoice | null;
  readonly say: string;
  /** How quickly the line types, 1 to 3. */
  readonly pace: number;
  /** How many of its characters are shown; all of them once it has typed or a tap showed it whole. */
  readonly typed: number;
  /** A "Read to me" clip reads this line, so the real voice is heard instead. */
  readonly voiced: boolean;
};

export type Babble = {
  /** Called every frame with the line on screen, or null when no talk is. */
  frame(line: BabbleLine | null): void;
  /** How many syllables the line on screen has babbled. */
  played(): number;
};

/** What the test hook records a syllable as: `talk.babble:<speaker>`, the narrator's `talk.babble:narrator`. */
export const babbleLabel = (speaker: string | null): string => `${BABBLE_SOUND}:${speaker ?? NARRATOR}`;

/**
 * Characters "talk" in babble while their line types: a syllable (core `babbleSyllable`) as each
 * word, and each few letters of a long one, appear. It stops the moment the line is shown whole,
 * by typing or by a tap, and is silent while "Read to me" reads the line.
 */
export function createBabble(sound: Pick<SoundPlayer, 'recipe' | 'playRecipe'>): Babble {
  let key: string | null = null;
  let starts: readonly number[] = [];
  /** How many syllables of the line have come due, played or not. */
  let begun = 0;
  let played = 0;

  return {
    frame: (line) => {
      if (line === null) {
        key = null;
        return;
      }
      if (line.key !== key) {
        key = line.key;
        starts = babbleStarts(line.say, line.pace);
        begun = 0;
        played = 0;
      }
      const base = sound.recipe(BABBLE_SOUND);
      if (base === null || line.voiced || line.typed >= line.say.length) return;
      let due = begun;
      while (due < starts.length && starts[due]! < line.typed) due += 1;
      if (due === begun) return;
      begun = due;
      // One syllable a frame: those a slow frame skipped past are dropped, never played late in a burst.
      if (sound.playRecipe(babbleLabel(line.speaker), babbleSyllable(base, line.voice, `${line.speaker ?? NARRATOR}|${line.say}`, due - 1))) played += 1;
    },
    played: () => played,
  };
}
