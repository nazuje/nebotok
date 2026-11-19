import { ARENA_NONE, type ArenaStartedMessage, type ProgressMessage } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT, favouriteTreat } from '../src/battle-content.ts';
import { buttonLabel, buttonStates, levelBadge, treatUsable } from '../src/arena/arena-buttons.ts';
import { ARENA } from '../src/arena/arena-content.ts';
import { createLatch, stickDirection, wireInput } from '../src/arena/arena-input.ts';
import { fightBook } from '../src/arena/fight-book.ts';

describe('the arena stick', () => {
  it('sends the nearest of 8 ways as the wire direction', () => {
    expect(stickDirection(10, 0)).toBe(0);
    expect(stickDirection(0, 10)).toBe(4);
    expect(stickDirection(-10, 0)).toBe(8);
    expect(stickDirection(0, -10)).toBe(12);
    expect(stickDirection(10, 10)).toBe(2);
    expect(stickDirection(10, 3)).toBe(0);
    expect(stickDirection(-10, -9)).toBe(10);
  });

  it('steers nowhere inside the dead zone or with no push', () => {
    expect(stickDirection(0, 0)).toBeNull();
    expect(stickDirection(17, 0, 60)).toBeNull();
    expect(stickDirection(19, 0, 60)).toBe(0);
  });
});

describe('the arena buttons latch', () => {
  it('keeps a quick tap for the next send and a held button until it is let go', () => {
    const latch = createLatch();
    latch.down(1);
    latch.up(1);
    expect(latch.take()).toEqual({ press: 1, dash: false, treat: false, swap: false });
    expect(latch.take().press).toBeNull();
    latch.down('dash');
    expect(latch.take().dash).toBe(true);
    expect(latch.take().dash).toBe(true);
    latch.up('dash');
    expect(latch.take().dash).toBe(false);
  });

  it('sends a second ability tapped before a send on the send after', () => {
    const latch = createLatch();
    latch.down(0);
    latch.up(0);
    latch.down(2);
    latch.up(2);
    expect(latch.take().press).toBe(0);
    expect(latch.take().press).toBe(2);
    expect(latch.take().press).toBeNull();
  });

  it('presses Treat and Swap once a tap, and lets go of everything on release', () => {
    const latch = createLatch();
    latch.down('treat');
    latch.down('swap');
    expect(latch.take()).toMatchObject({ treat: true, swap: true });
    expect(latch.take()).toMatchObject({ treat: false, swap: false });
    latch.down(0);
    latch.release();
    expect(latch.holding()).toBe(false);
    expect(latch.take().press).toBeNull();
  });

  it('turns none into ARENA_NONE on the wire', () => {
    expect(wireInput(null, { press: null, dash: false, treat: false, swap: false }, false)).toEqual({ dir: ARENA_NONE, press: ARENA_NONE, dash: false, treat: false, swap: false, leave: false });
    expect(wireInput(6, { press: 2, dash: true, treat: false, swap: false }, true)).toMatchObject({ dir: 6, press: 2, dash: true, leave: true });
  });
});

describe('the arena buttons', () => {
  const [, second, third] = ARENA.arena.buttons;
  const loadout = [...CONTENT.moves.values()].filter((move) => move.arena).map((move) => move.id).slice(0, 3);

  it('locks the buttons a level has not reached, showing the level that unlocks them', () => {
    const states = buttonStates({ level: second, loadout, cooldowns: [0, 0, 0, 0, 0], treat: false, swap: false });
    expect(states.map((state) => state.locked)).toEqual([false, false, true, false, false, false]);
    expect(states[2]).toMatchObject({ unlock: third, move: null });
    expect(buttonLabel(states[2]!, 'en')).toBe(`Unlocks at level ${third}`);
  });

  it('fills the cooldown ring by the share of the cooldown left', () => {
    const dash = ARENA.arena.dash.cooldownTicks;
    const states = buttonStates({ level: 99, loadout, cooldowns: [0, 0, 0, dash / 2, 0], treat: true, swap: false });
    expect(states[3]).toMatchObject({ action: 'dash', ring: 0.5 });
    expect(states[0]?.ring).toBe(0);
    expect(states.find((state) => state.action === 'treat')?.shown).toBe(true);
    expect(states.find((state) => state.action === 'swap')?.shown).toBe(false);
  });

  it('names each button for screen readers in both languages', () => {
    const [first] = buttonStates({ level: 99, loadout: [null, null, null], cooldowns: [], treat: false, swap: false });
    expect(buttonLabel(first!, 'en')).toBe('Button 1: no move yet');
    expect(buttonLabel(first!, 'sl')).toBe('Gumb 1: še brez poteze');
    expect(levelBadge(7, 'en')).toBe('Lv 7');
    expect(levelBadge(7, 'sl')).toBe('St. 7');
  });

  it('shows Treat only for a weak enough wild creature, a treat in the bag and none out', () => {
    const species = [...CONTENT.species.keys()].find((id) => favouriteTreat(id) !== null)!;
    const bag = [{ item: favouriteTreat(species)!, count: 1 }];
    const weak = { species, health: 1, max: 100 };
    expect(treatUsable(weak, bag, false)).toBe(true);
    expect(treatUsable(weak, bag, true)).toBe(false);
    expect(treatUsable(weak, [], false)).toBe(false);
    expect(treatUsable({ species, health: 100, max: 100 }, bag, false)).toBe(false);
  });
});

const creature = (hp: number, loadout: (string | null)[]) => ({ species: 's', level: 5, xp: 0, hp, moves: [], loadout, learned: [] });

describe('the fight book', () => {
  const started: ArenaStartedMessage = {
    fightId: 'f',
    mode: 'wild',
    side: 0,
    sides: [
      [
        { id: 'a1', species: 's', level: 5, place: 0 },
        { id: 'a2', species: 's', level: 5, place: 1 },
      ],
      [{ id: 'b1', species: 'w', level: 5, place: null }],
    ],
  };
  const progress = { team: [creature(10, ['m1', null, null]), creature(10, ['m2', null, null])], inventory: [{ item: 'berry', count: 2 }] } as unknown as ProgressMessage;

  it('offers Swap until every other creature has fallen', () => {
    const book = fightBook(started, progress);
    expect(book.canSwap('a1')).toBe(true);
    book.saw([{ kind: 'swapped', from: 0, to: 1 }, { kind: 'entered', side: 0, id: 'a2', place: 1 }]);
    expect(book.canSwap('a2')).toBe(true);
    book.saw([{ kind: 'ringOut', side: 0 }, { kind: 'entered', side: 0, id: 'a1', place: 0 }]);
    expect(book.canSwap('a1')).toBe(false);
  });

  it('leaves out a creature too tired to fight from the start', () => {
    const tired = { ...progress, team: [creature(10, []), creature(0, [])] } as unknown as ProgressMessage;
    expect(fightBook(started, tired).canSwap('a1')).toBe(false);
  });

  it('reads the loadout of the creature on the island and counts the treats thrown', () => {
    const book = fightBook(started, progress);
    expect(book.loadout('a2', progress)).toEqual(['m2', null, null]);
    expect(book.loadout('b1', progress)).toBeNull();
    book.saw([{ kind: 'treatThrown', item: 'berry', liking: 'liked' }]);
    expect(book.bag(progress)).toEqual([{ item: 'berry', count: 1 }]);
  });
});
