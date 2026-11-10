import { describe, expect, it } from 'vitest';
import { beatAt, beatsMs, type StormBeat, createCueGate, flagsSetWith, MOVING_BEATS, outward, questCueKey, STILL_BEATS, talkCueKey } from '../src/storm-plan.ts';
import { STORY } from '../src/talk-content.ts';

describe('the storm glimpse', () => {
  it('lasts under 6 seconds, moving or still', () => {
    expect(beatsMs(MOVING_BEATS)).toBeLessThan(6_000);
    expect(beatsMs(STILL_BEATS)).toBeLessThan(6_000);
  });

  it('goes through its beats in order and then ends', () => {
    const seen: (StormBeat | null)[] = [];
    for (let at = 0; at < beatsMs(MOVING_BEATS) + 100; at += 50) {
      const beat = beatAt(MOVING_BEATS, at);
      if (seen.at(-1) !== beat) seen.push(beat);
    }
    expect(seen).toEqual(['look', 'drift', 'bite', 'shake', 'back', null]);
    expect(beatAt(STILL_BEATS, 0)).toBe('still');
  });

  it('looks out over the nearer side of the map', () => {
    expect(outward(600, 640)).toBe(1);
    expect(outward(40, 640)).toBe(-1);
  });

  it('draws the storm band from the flag the lookout step sets with the cue', () => {
    expect([...flagsSetWith('storm-glimpse', STORY)]).toEqual(['storm-seen']);
  });
});

describe('cue keys', () => {
  it('lets each cue through once, so a talk.node sent again after a reconnection plays nothing', () => {
    const gate = createCueGate();
    const node = { conversation: 4, node: 'look' };
    expect(gate.first(talkCueKey(node))).toBe(true);
    expect(gate.first(talkCueKey({ ...node }))).toBe(false);
    expect(gate.first(talkCueKey({ ...node, conversation: 5 }))).toBe(true);
    const change = { quest: 'the-grey-letter', change: 'step', step: 2 } as const;
    expect(gate.first(questCueKey(change))).toBe(true);
    expect(gate.first(questCueKey(change))).toBe(false);
    gate.clear();
    expect(gate.first(questCueKey(change))).toBe(true);
  });
});
