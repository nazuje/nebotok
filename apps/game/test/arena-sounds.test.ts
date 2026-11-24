import type { FightEvent } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import sounds from '../../../content/sounds.json' with { type: 'json' };
import { ARENA_SOUND_IDS, COUNTDOWN_FROM_S, arenaSounds, createPhaseSounds } from '../src/arena/arena-sounds.ts';
import { BATTLE_SOUND_IDS, battleResultSound, battleStepSound } from '../src/battle-sounds.ts';

const PLAYER = { side: 0, watching: false } as const;
const hit = (effectiveness: 'strong' | 'normal' | 'weak', damage = 5): FightEvent => ({ kind: 'hit', side: 1, by: 0, move: 'm', damage, health: 10, effectiveness, knock: 100, x: 0, y: 0 });
const ids = (events: readonly FightEvent[], listener: { side: 0 | 1; watching: boolean } = PLAYER) => arenaSounds(events, listener).map((sound) => sound.id);
const cast = (shape: string) => ids([{ kind: 'cast', side: 0, button: 0, move: 'm', shape } as FightEvent]);
const round = (winner: 0 | 1 | null): FightEvent => ({ kind: 'roundEnded', round: 0, winner, how: 'knockout', replay: winner === null });

describe('the arena\'s sounds', () => {
  it('has a recipe in sounds.json for every sound a fight or a turn battle plays', () => {
    const known = new Set(sounds.sounds.map((sound) => sound.id));
    expect([...ARENA_SOUND_IDS, ...BATTLE_SOUND_IDS].filter((id) => !known.has(id))).toEqual([]);
  });

  it('tells a strong, a normal and a weak hit apart, and plays only the strongest of a frame', () => {
    expect(ids([hit('normal')])).toEqual(['arena.hit']);
    expect(ids([hit('weak')])).toEqual(['arena.hit.weak']);
    expect(ids([hit('weak'), hit('strong'), hit('normal')])).toEqual(['arena.hit.strong']);
    expect(ids([hit('strong', 0)])).toEqual([]);
  });

  it('gives each shape family its cast', () => {
    expect(cast('bolt')).toEqual(cast('spray'));
    expect(cast('cone')).toEqual(cast('burst'));
    expect(cast('lunge')).toEqual(cast('strike'));
    expect(cast('shield')).toEqual(cast('wall'));
    for (const shape of ['freeze', 'puddle', 'zone']) expect(cast(shape)).toEqual(cast('snare'));
    const families = ['bolt', 'cone', 'lunge', 'shield', 'snare', 'weather'].map((shape) => cast(shape)[0]);
    expect(new Set(families).size).toBe(6);
  });

  it('plays each sound once a frame, the ones a burst must not drop first', () => {
    const events: FightEvent[] = [
      { kind: 'dashed', side: 0, dir: 0 },
      { kind: 'dashed', side: 1, dir: 0 },
      hit('normal'),
      { kind: 'ringOut', side: 1 },
      { kind: 'fightEnded', result: 'wonByRingOut' },
    ];
    expect(arenaSounds(events, PLAYER)).toEqual([
      { id: 'arena.ringout', priority: 'keep' },
      { id: 'arena.fight.won', priority: 'keep' },
      { id: 'arena.dash', priority: 'normal' },
      { id: 'arena.hit', priority: 'normal' },
    ]);
  });

  it('sounds the storm, the treats, a swap and healing', () => {
    expect(ids([{ kind: 'stormWarning', step: 0, radius: 1 }])).toEqual(['arena.storm.warn']);
    expect(ids([{ kind: 'stormShrank', step: 1, radius: 1 }])).toEqual(['arena.storm.step']);
    expect(ids([{ kind: 'treatThrown', item: 't', liking: 'favourite' }])).toEqual(['arena.treat.throw']);
    expect(ids([{ kind: 'treatLost', item: 't' }])).toEqual(['arena.treat.miss']);
    expect(ids([{ kind: 'befriended', species: 's', level: 3 }, { kind: 'fightEnded', result: 'befriended' }])).toEqual(['arena.befriend']);
    expect(ids([{ kind: 'swapped', from: 0, to: 1 }])).toEqual(['arena.swap']);
    expect(ids([{ kind: 'healed', side: 0, amount: 4, health: 9 }])).toEqual(['arena.heal']);
  });

  it('turns a result round for side 1, cheers every decided end for a watcher, and leaves a run silent', () => {
    const lost: FightEvent = { kind: 'fightEnded', result: 'lost' };
    expect(ids([lost])).toEqual(['arena.fight.lost']);
    expect(ids([lost], { side: 1, watching: false })).toEqual(['arena.fight.won']);
    expect(ids([lost], { side: 1, watching: true })).toEqual(['arena.fight.won']);
    expect(ids([{ kind: 'fightEnded', result: 'ran' }])).toEqual([]);
    expect(ids([{ kind: 'fightEnded', result: 'timeUp' }])).toEqual([]);
  });

  it('sounds a round won or lost, but only the fight\'s stinger when the last round ends it', () => {
    expect(ids([round(0)])).toEqual(['arena.round.won']);
    expect(ids([round(1)])).toEqual(['arena.round.lost']);
    expect(ids([round(null)])).toEqual([]);
    expect(ids([round(0), { kind: 'fightEnded', result: 'won' }])).toEqual(['arena.fight.won']);
  });
});

describe('a best of 3\'s countdown and "Go!"', () => {
  it('ticks each of the pick screen\'s last seconds once, then says go as the fighting starts', () => {
    const phases = createPhaseSounds();
    const heard = [30_000, 10_000, 3_900, 3_100, 2_950, 2_000, 1_500, 900, 50].flatMap((ms) => phases('picking', ms).map((sound) => sound.id));
    expect(heard).toEqual(Array.from({ length: COUNTDOWN_FROM_S }, () => 'arena.countdown'));
    expect(phases('fighting', 0)).toEqual([{ id: 'arena.go', priority: 'keep' }]);
    expect(phases('fighting', 0)).toEqual([]);
    expect(phases('between', 2_000)).toEqual([]);
    expect(phases('fighting', 0).map((sound) => sound.id)).toEqual(['arena.go']);
  });

  it('says nothing when a page arrives in the middle of a fight', () => {
    const phases = createPhaseSounds();
    expect(phases('fighting', 0)).toEqual([]);
    expect(phases('picking', 2_000)).toEqual([]);
  });
});

describe('a turn battle\'s sounds', () => {
  it('plays a hit and a faint, and a win or a loss, and nothing else; a befriending is heard as its hearts (battleEndSound)', () => {
    expect(battleStepSound({ kind: 'hit', creature: 'b1' })).toBe('battle.hit');
    expect(battleStepSound({ kind: 'faint', creature: 'b1' })).toBe('battle.faint');
    expect(battleStepSound({ kind: 'attack', creature: 'a1' })).toBeNull();
    expect(battleStepSound(null)).toBeNull();
    expect(battleResultSound('won')).toBe('battle.win');
    expect(battleResultSound('befriended')).toBeNull();
    expect(battleResultSound('fainted')).toBe('battle.lose');
    expect(battleResultSound('ran')).toBeNull();
  });
});
