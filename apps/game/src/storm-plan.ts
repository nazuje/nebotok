import type { Effect, QuestChanged, StepEffect, StoryContent, StoryCue, TalkNode } from '@nebotok/core';

/** A part of the storm glimpse. Reduced motion shows one still beat instead of the others. */
export type StormBeat = 'look' | 'drift' | 'bite' | 'shake' | 'back' | 'still';

export type Beats = readonly { readonly beat: StormBeat; readonly ms: number }[];

/**
 * The storm glimpse, beat by beat: the camera eases out over the sky as the screen dims, the storm
 * drifts in beside a little cloud, bites it and swallows it, the screen shakes, and the storm fades
 * as the camera eases back. Kept under 6 seconds in all.
 */
export const MOVING_BEATS: Beats = [
  { beat: 'look', ms: 1_100 },
  { beat: 'drift', ms: 1_000 },
  { beat: 'bite', ms: 700 },
  { beat: 'shake', ms: 350 },
  { beat: 'back', ms: 1_100 },
];

/** With reduced motion: one still picture and a caption, long enough to read. */
export const STILL_BEATS: Beats = [{ beat: 'still', ms: 3_500 }];

export const beatsMs = (beats: Beats): number => beats.reduce((total, { ms }) => total + ms, 0);

/** The beat `elapsedMs` into `beats`, or null once they are over. */
export function beatAt(beats: Beats, elapsedMs: number): StormBeat | null {
  let end = 0;
  for (const { beat, ms } of beats) {
    end += ms;
    if (elapsedMs < end) return beat;
  }
  return null;
}

/** Which way the open sky is from `x` on a map `width` wide: out over the nearer side edge. */
export const outward = (x: number, width: number): -1 | 1 => (x < width / 2 ? -1 : 1);

const flagsBeside = (cue: StoryCue, effects: readonly (Effect | StepEffect)[] | undefined, own?: StoryCue): string[] => {
  const list = effects ?? [];
  const plays = own === cue || list.some((effect) => 'cue' in effect && effect.cue === cue);
  return plays ? list.flatMap((effect) => ('setFlag' in effect ? [effect.setFlag] : [])) : [];
};

/**
 * The story flags set together with `cue`, by the quest step, finished quest or dialogue node that
 * plays it: a player's story has one of them once they have seen the cue.
 */
export function flagsSetWith(cue: StoryCue, content: StoryContent): ReadonlySet<string> {
  const quests = [...content.quests.values()];
  const fromSteps = quests.flatMap((quest) => quest.steps).flatMap((step) => flagsBeside(cue, step.effects));
  const fromQuests = quests.flatMap((quest) => flagsBeside(cue, quest.effects));
  const fromTalks = [...content.dialogue.values()].flatMap((dialogue) => Object.values(dialogue.nodes)).flatMap((node) => flagsBeside(cue, node.effects, node.cue));
  return new Set([...fromSteps, ...fromQuests, ...fromTalks]);
}

/** The same cue sent again (a `talk.node` resent after a reconnection) has the same key. */
export const questCueKey = (change: Pick<QuestChanged, 'quest' | 'change' | 'step'>): string => `quest:${change.quest}:${change.change}:${change.step}`;
export const talkCueKey = (talk: Pick<TalkNode, 'conversation' | 'node'>): string => `talk:${talk.conversation}:${talk.node}`;

export type CueGate = {
  /** True the first time a key is seen since the last clear. */
  first(key: string): boolean;
  clear(): void;
};

export function createCueGate(): CueGate {
  const seen = new Set<string>();
  return {
    first: (key) => {
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    },
    clear: () => seen.clear(),
  };
}
