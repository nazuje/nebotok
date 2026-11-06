import type { BattleEvent } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { EFFECT_LEAD_MS, LINE_MAX_MS, LINE_MIN_MS, LINE_MS_PER_CHARACTER, lineAt, nextLineAt, playback, playbackMs, readingMs, shownOf, stepAt, type Step } from '../src/battle-playback.ts';
import { turn, wildBattle } from './support/battle-messages.ts';

const move = (slot: number) => ({ kind: 'move', slot }) as const;
const TEN = () => 10;
const ID_LENGTH = (line: { id: string }) => line.id.length;

/** How long each line stays on screen: from its step to the next line's, or the end. */
function lineHolds(steps: readonly Step[]): { id: string; ms: number }[] {
  const holds: { id: string; ms: number }[] = [];
  for (const step of steps) {
    const last = holds.at(-1);
    if (step.line && step.ms > 0) holds.push({ id: step.line.id, ms: step.ms });
    else if (last) last.ms += step.ms;
  }
  return holds;
}

describe('battle playback', () => {
  it('sends both creatures out in order on a new battle, starting with nobody on the field', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 3 }, 'rain');
    const steps = playback(null, started.payload.battle, started.payload.events, TEN);
    expect(steps.map((step) => step.shown.active)).toEqual([
      ['a1', null],
      ['a1', 'b1'],
      ['a1', 'b1'],
    ]);
    expect(steps.map((step) => step.line?.id)).toEqual(['battle.go', 'battle.wildAppeared', 'battle.weather']);
    expect(steps.at(-1)?.shown).toEqual(shownOf(started.payload.battle));
  });

  it('lowers health hit by hit, in the order of the events, and ends on the view', () => {
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    const before = started.payload.battle;
    const { payload } = turn(battle, move(0), move(0));
    const steps = playback(before, payload.battle, payload.events, TEN);
    const hits = payload.events.filter((event): event is Extract<BattleEvent, { kind: 'hit' }> => event.kind === 'hit');
    expect(hits.length).toBeGreaterThan(0);
    for (const hit of hits) {
      const at = steps.findIndex((step) => step.event === hit);
      expect(steps[at]?.shown.hp[hit.target]).toBe(hit.hp);
      expect(steps[at - 1]?.shown.hp[hit.target]).toBe(hit.hp + hit.damage);
    }
    expect(steps.at(-1)?.shown.hp).toEqual(shownOf(payload.battle).hp);
    expect(steps.map((step) => step.effect?.kind).filter(Boolean)).toContain('hit');
  });

  it('gives a line a reading time from its length, from a minimum up to a cap', () => {
    expect(readingMs(0)).toBe(LINE_MIN_MS);
    expect(readingMs(25)).toBe(LINE_MIN_MS + 25 * LINE_MS_PER_CHARACTER);
    expect(readingMs(1_000)).toBe(LINE_MAX_MS);
    expect(LINE_MIN_MS).toBeGreaterThanOrEqual(1_200);
  });

  it('holds every line for its reading time, with the effects under it', () => {
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 }, 'sun');
    const { payload } = turn(battle, move(0), move(0));
    const steps = playback(started.payload.battle, payload.battle, payload.events, ID_LENGTH);
    const holds = lineHolds(steps);
    expect(holds.length).toBeGreaterThan(1);
    for (const hold of holds) expect(hold.ms).toBe(readingMs(hold.id.length));
    expect(playbackMs(steps)).toBe(holds.reduce((sum, hold) => sum + hold.ms, 0));
  });

  it('starts a hit soon after the attack that makes it, under the same line', () => {
    // A sun move on a gale creature is neither strong nor weak, so its hit has no line of its own.
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'pinwhirl', level: 20 });
    const { payload } = turn(battle, move(1));
    const steps = playback(started.payload.battle, payload.battle, payload.events, TEN);
    const used = steps.findIndex((step, at) => step.event.kind === 'used' && steps[at + 1]?.event.kind === 'hit' && !steps[at + 1]?.line);
    expect(used).toBeGreaterThan(-1);
    expect(steps[used]?.ms).toBe(EFFECT_LEAD_MS);
    expect((steps[used]?.ms ?? 0) + (steps[used + 1]?.ms ?? 0)).toBe(readingMs(10));
  });

  it('keeps no time for a line that asks for a choice, since it stays up with the menu', () => {
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 2 }, { species: 'puddlepip', level: 2 }], { species: 'boltkit', level: 60 });
    const { payload } = turn(battle, move(0), move(0));
    const steps = playback(started.payload.battle, payload.battle, payload.events, TEN);
    const prompt = steps.find((step) => step.line?.id === 'battle.chooseNext');
    expect(prompt?.ms).toBe(0);
  });

  it('leaves a wild creature that fainted without a line, since the battle is won', () => {
    const { battle } = wildBattle([{ species: 'boltkit', level: 100 }], { species: 'puddlepip', level: 3 });
    const fainted = turn(battle, move(0), move(0));
    expect(fainted.payload.battle.phase).toBe('befriend');
    const left = turn(battle, { kind: 'run' });
    expect(left.payload.battle.outcome).toMatchObject({ winner: 0 });
    const steps = playback(fainted.payload.battle, left.payload.battle, left.payload.events, TEN);
    expect(steps.some((step) => step.line?.id === 'battle.ranAway')).toBe(false);
    expect(playbackMs(steps)).toBe(0);
    const ran = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'puddlepip', level: 3 });
    const away = turn(ran.battle, { kind: 'run' });
    expect(playback(ran.started.payload.battle, away.payload.battle, away.payload.events, TEN).map((step) => step.line?.id)).toContain('battle.ranAway');
  });

  it('finds the step on screen at any moment, skipping steps that take no time, and ends after the last', () => {
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    const { payload } = turn(battle, move(0), move(0));
    const steps = playback(started.payload.battle, payload.battle, payload.events, TEN);
    expect(steps[0]?.event.kind).toBe('turnStarted');
    expect(stepAt(steps, 0)).toBe(1);
    expect(stepAt(steps, playbackMs(steps))).toBeNull();
    expect(lineAt(steps, stepAt(steps, 0) ?? 0)?.id).toBe('battle.used');
  });

  it('finds where the next line starts, and none after the last', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 3 }, 'rain');
    const steps = playback(null, started.payload.battle, started.payload.events, TEN);
    expect(nextLineAt(steps, 0)).toBe(readingMs(10));
    expect(nextLineAt(steps, readingMs(10))).toBe(2 * readingMs(10));
    expect(nextLineAt(steps, 2 * readingMs(10))).toBeNull();
  });
});
