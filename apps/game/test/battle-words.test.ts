import { describe, expect, it } from 'vitest';
import { lineText } from '../src/battle-screen.ts';
import { swappedOrder } from '../src/team-screen.ts';
import { wildBattle } from './support/battle-messages.ts';

describe('the words of a battle', () => {
  const { started } = wildBattle([{ species: 'glowbun', level: 5 }], { species: 'pinwhirl', level: 3 }, 'rain');
  const view = started.payload.battle;

  it('names creatures by species, and moves and weather by their own names, in each language', () => {
    expect(lineText({ id: 'battle.used', creature: 'a1', move: 'sun-tap' }, view, 'en')).toBe('Glowbun uses Sun Tap!');
    expect(lineText({ id: 'battle.weather', weather: 'rain' }, view, 'sl')).toBe('Vreme: Dež');
    expect(lineText({ id: 'battle.befriended', species: 'pinwhirl' }, view, 'en')).toBe('Pinwhirl joins your team!');
    expect(lineText({ id: 'battle.xp', creature: 'a1', xp: 18 }, view, 'sl')).toBe('Sončni zajček dobi 18 točk izkušenj.');
  });
});

describe('reordering the team', () => {
  it('swaps two places and keeps the rest', () => {
    expect(swappedOrder(4, 0, 2)).toEqual([2, 1, 0, 3]);
    expect(swappedOrder(2, 1, 0)).toEqual([1, 0]);
  });
});
