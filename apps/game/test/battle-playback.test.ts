import type { BattleEvent } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { TURN_BUDGET_MS, lineAt, playback, playbackMs, shownOf, stepAt } from '../src/battle-playback.ts';
import { turn, wildBattle } from './support/battle-messages.ts';

const move = (slot: number) => ({ kind: 'move', slot }) as const;

describe('battle playback', () => {
  it('sends both creatures out in order on a new battle, starting with nobody on the field', () => {
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 3 }, 'rain');
    const steps = playback(null, started.payload.battle, started.payload.events);
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
    const steps = playback(before, payload.battle, payload.events);
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

  it('fits every turn in the budget, however many events it has', () => {
    const many: BattleEvent[] = Array.from({ length: 30 }, () => ({ kind: 'fainted', side: 1, creature: 'b1' }));
    const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 3 });
    const steps = playback(started.payload.battle, started.payload.battle, many);
    expect(playbackMs(steps)).toBeLessThanOrEqual(TURN_BUDGET_MS);
    expect(TURN_BUDGET_MS).toBeLessThan(1_500);
  });

  it('finds the step on screen at any moment, skipping steps that take no time, and ends after the last', () => {
    const { battle, started } = wildBattle([{ species: 'glowbun', level: 20 }], { species: 'puddlepip', level: 20 });
    const { payload } = turn(battle, move(0), move(0));
    const steps = playback(started.payload.battle, payload.battle, payload.events);
    expect(steps[0]?.event.kind).toBe('turnStarted');
    expect(stepAt(steps, 0)).toBe(1);
    expect(stepAt(steps, playbackMs(steps))).toBeNull();
    expect(lineAt(steps, stepAt(steps, 0) ?? 0)?.id).toBe('battle.used');
  });
});
