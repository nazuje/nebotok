import type { FightEvent } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/battle-content.ts';
import { BUZZ, HIT_STOP_MS, badgeTone, buzzFor, hitStopMs, popupFor, shakeFor, shakeOf, shakeOffset, stopFor } from '../src/arena/arena-juice.ts';

const moveOfShape = (shape: string): string => [...CONTENT.moves.values()].find((move) => move.arena?.shape === shape)!.id;
const hit = (shape: string, extra: Partial<Extract<FightEvent, { kind: 'hit' }>> = {}): FightEvent => ({ kind: 'hit', side: 0, by: 1, move: moveOfShape(shape), damage: 12, health: 50, effectiveness: 'normal', knock: 300, x: 0, y: 0, ...extra });

/** One of every event that the juice reacts to, and some it does not. */
const EVENTS: readonly FightEvent[] = [
  hit('bolt'),
  hit('lunge'),
  hit('bolt', { knock: 900 }),
  hit('zone'),
  { kind: 'blocked', side: 0, by: 1 },
  { kind: 'bumped', side: 1, knock: 700, x: 0, y: 0 },
  { kind: 'status', side: 1, status: 'root', ticks: 48 },
  { kind: 'status', side: 1, status: 'slow', ticks: 48 },
  { kind: 'befriended', species: 'glowbun', level: 3 },
  { kind: 'fainted', side: 1 },
  { kind: 'ringOut', side: 1 },
  { kind: 'stormShrank', step: 1, radius: 120_000 },
  { kind: 'dashed', side: 0, dir: 0 },
  { kind: 'cast', side: 0, button: 0, move: moveOfShape('bolt'), shape: 'bolt' },
];

describe('the level badge', () => {
  it('is red for the higher creature, green for the lower and blue when even', () => {
    expect(badgeTone(12, 9)).toBe('higher');
    expect(badgeTone(9, 12)).toBe('lower');
    expect(badgeTone(9, 9)).toBe('even');
    expect(badgeTone(9, null)).toBe('even');
  });
});

describe('the hit-stop', () => {
  it('holds a big hit longer than a small one, and a zone pulse not at all', () => {
    expect(hitStopMs(hit('bolt'), true)).toBe(HIT_STOP_MS.hit);
    expect(hitStopMs(hit('lunge'), true)).toBe(HIT_STOP_MS.bigHit);
    expect(hitStopMs(hit('bolt', { knock: 900 }), true)).toBe(HIT_STOP_MS.bigHit);
    expect(hitStopMs(hit('zone'), true)).toBe(0);
  });

  it('stops for a block, a bump, a root, a befriending and a faint, from 60 to 160 ms', () => {
    expect(hitStopMs({ kind: 'blocked', side: 0, by: 1 }, true)).toBe(HIT_STOP_MS.blocked);
    expect(hitStopMs({ kind: 'bumped', side: 1, knock: 700, x: 0, y: 0 }, true)).toBe(HIT_STOP_MS.bumped);
    expect(hitStopMs({ kind: 'status', side: 1, status: 'root', ticks: 48 }, true)).toBe(HIT_STOP_MS.rooted);
    expect(hitStopMs({ kind: 'status', side: 1, status: 'slow', ticks: 48 }, true)).toBe(0);
    expect(hitStopMs({ kind: 'befriended', species: 'glowbun', level: 3 }, true)).toBe(HIT_STOP_MS.befriended);
    expect(hitStopMs({ kind: 'fainted', side: 1 }, true)).toBe(HIT_STOP_MS.fainted);
    expect(hitStopMs({ kind: 'dashed', side: 0, dir: 0 }, true)).toBe(0);
    for (const ms of Object.values(HIT_STOP_MS)) {
      expect(ms).toBeGreaterThanOrEqual(60);
      expect(ms).toBeLessThanOrEqual(160);
    }
    expect(stopFor(EVENTS, true)).toBe(HIT_STOP_MS.fainted);
  });
});

describe('the shake', () => {
  it('lasts 150 to 350 ms, up to 14 px, and eases out to nothing', () => {
    for (const event of EVENTS) {
      const shake = shakeFor(event, true);
      if (!shake) continue;
      expect(shake.ms).toBeGreaterThanOrEqual(150);
      expect(shake.ms).toBeLessThanOrEqual(350);
      expect(shake.px).toBeLessThanOrEqual(14);
    }
    expect(shakeFor(hit('bolt', { knock: 5_000 }), true)?.px).toBe(14);
    expect(shakeFor(hit('zone'), true)).toBeNull();
    const shake = shakeOf(EVENTS, true);
    expect(shake).toEqual(shakeFor(hit('bolt', { knock: 900 }), true));
    expect(shakeOffset(shake, shake!.ms)).toEqual({ x: 0, y: 0 });
  });
});

describe('reduced motion', () => {
  it('gives no shake and no hit-stop for any event', () => {
    for (const event of EVENTS) {
      expect(hitStopMs(event, false)).toBe(0);
      expect(shakeFor(event, false)).toBeNull();
    }
    expect(stopFor(EVENTS, false)).toBe(0);
    expect(shakeOf(EVENTS, false)).toBeNull();
    expect(shakeOffset(null, 10)).toEqual({ x: 0, y: 0 });
  });

  it('never buzzes, while numbers still pop', () => {
    for (const event of EVENTS) expect(buzzFor(event, 0, false)).toBeNull();
    expect(popupFor(hit('bolt'))).toEqual({ side: 0, amount: 12, tone: 'normal' });
  });
});

describe('haptics', () => {
  it('buzz only for a hit to your creature, a ring-out and a befriending', () => {
    expect(buzzFor(hit('bolt'), 0, true)).toEqual(BUZZ.hit);
    expect(buzzFor(hit('lunge'), 0, true)).toEqual(BUZZ.bigHit);
    expect(buzzFor(hit('bolt'), 1, true)).toBeNull();
    expect(buzzFor(hit('weather', { damage: 0 }), 0, true)).toBeNull();
    expect(buzzFor({ kind: 'ringOut', side: 1 }, 0, true)).toEqual(BUZZ.ringOut);
    expect(buzzFor({ kind: 'befriended', species: 'glowbun', level: 3 }, 0, true)).toEqual(BUZZ.befriended);
    const others = EVENTS.filter((event) => event.kind !== 'hit' && event.kind !== 'ringOut' && event.kind !== 'befriended');
    for (const event of others) expect(buzzFor(event, 0, true)).toBeNull();
  });
});

describe('damage numbers', () => {
  it('show strong hits as strong, health back as a heal, and nothing for no damage', () => {
    expect(popupFor(hit('bolt', { effectiveness: 'strong', damage: 30 }))).toEqual({ side: 0, amount: 30, tone: 'strong' });
    expect(popupFor({ kind: 'healed', side: 1, amount: 4, health: 40 })).toEqual({ side: 1, amount: 4, tone: 'heal' });
    expect(popupFor(hit('weather', { damage: 0 }))).toBeNull();
  });
});
