import { describe, expect, it } from 'vitest';
import { defaultLoadout, emptyProgress, gainXp, learnedMoves, loadoutFits, newCreature, setLoadout, setSounds, setTurtle, defaultSettings, xpToNextLevel, type CreatureInstance, type Loadout } from '../../src/index.ts';
import { battleContent, goldenBattleContent } from '../support/battle-content.ts';

const species = (id: string) => battleContent.species.get(id)!;
const at = (id: string, level: number, loadout?: Loadout): CreatureInstance => {
  const made = newCreature(id, level, battleContent);
  return loadout ? { ...made, loadout } : made;
};
/** The creature one level up, by exactly the experience that takes. */
const levelUp = (creature: CreatureInstance) => gainXp(creature, xpToNextLevel(creature.level) - creature.xp, battleContent);

describe('learned moves', () => {
  it('are the species\' first moves, then each learnset move up to the level, in learnset order', () => {
    expect(learnedMoves(species('glowbun'), 1, battleContent)).toEqual(['heat-shimmer', 'sun-ray', 'storm-tap', 'sun-call']);
    expect(learnedMoves(species('glowbun'), 15, battleContent)).toEqual(['heat-shimmer', 'sun-ray', 'storm-tap', 'sun-call', 'sun-tap', 'sun-wallop']);
    expect(learnedMoves(species('glowbun'), 100, battleContent)).toHaveLength(8);
  });
});

describe('the default loadout', () => {
  it('fills only the buttons unlocked at the level, each with a move of its kind', () => {
    expect(defaultLoadout({ species: 'glowbun', level: 6 }, battleContent)).toEqual(['heat-shimmer', null, null]);
    expect(defaultLoadout({ species: 'glowbun', level: 7 }, battleContent)).toEqual(['heat-shimmer', 'sun-ray', null]);
    expect(defaultLoadout({ species: 'glowbun', level: 12 }, battleContent)).toEqual(['heat-shimmer', 'sun-ray', 'sun-call']);
  });

  it('takes the first learned move of each kind, even one forgotten in a turn battle', () => {
    expect(defaultLoadout({ species: 'glowbun', level: 40 }, battleContent)).toEqual(['heat-shimmer', 'sun-ray', 'sun-call']);
    expect(defaultLoadout({ species: 'dawnshell', level: 7 }, battleContent)).toEqual(['sun-tap', 'sun-ray', null]);
    expect(newCreature('puddlepip', 14, battleContent).loadout).toEqual(['drip-drop', 'puddle-jump', 'rain-call']);
  });

  it('leaves every button empty without arena rules, as in the frozen turn-battle content', () => {
    expect(defaultLoadout({ species: 'glowbun', level: 50 }, goldenBattleContent)).toEqual([null, null, null]);
  });
});

describe('growing up', () => {
  it('puts the default move on a button as it unlocks', () => {
    const shell = at('dawnshell', 6);
    expect(shell.loadout).toEqual(['sun-tap', null, null]);
    expect(levelUp(shell).loadout).toEqual(['sun-tap', 'sun-ray', null]);
    expect(levelUp(at('gustowl', 11)).loadout).toEqual(['gale-tap', 'twirl', 'gale-call']);
  });

  it('puts a newly learned move on its empty button, and keeps a button that has a move', () => {
    expect(levelUp(at('glowbun', 14, ['heat-shimmer', null, 'sun-call'])).loadout).toEqual(['heat-shimmer', 'sun-wallop', 'sun-call']);
    expect(levelUp(at('glowbun', 14, ['heat-shimmer', 'sun-ray', 'sun-call'])).loadout).toEqual(['heat-shimmer', 'sun-ray', 'sun-call']);
    expect(levelUp(at('glowbun', 9, [null, 'sun-ray', 'sun-call'])).loadout).toEqual([null, 'sun-ray', 'sun-call']);
    expect(gainXp(at('glowbun', 14, ['heat-shimmer', null, 'sun-call']), 0, battleContent).loadout).toEqual(['heat-shimmer', null, 'sun-call']);
  });
});

describe('setting a loadout', () => {
  const progress = { ...emptyProgress(), team: [at('glowbun', 15), at('dawnshell', 6)] };

  it('puts learned moves of each button\'s kind on unlocked buttons, empty ones too', () => {
    const next = setLoadout(progress, 0, ['sun-tap', 'sun-wallop', null], battleContent)!;
    expect(next.team[0]!.loadout).toEqual(['sun-tap', 'sun-wallop', null]);
    expect(next.team[1]).toBe(progress.team[1]);
    expect(progress.team[0]!.loadout).toEqual(['heat-shimmer', 'sun-ray', 'sun-call']);
  });

  it('refuses an unlearned move, a move of the wrong kind, a locked button and a missing creature', () => {
    expect(setLoadout(progress, 0, ['heat-shimmer', 'storm-wallop', 'sun-call'], battleContent)).toBeNull();
    expect(setLoadout(progress, 0, ['sun-ray', null, null], battleContent)).toBeNull();
    expect(setLoadout(progress, 0, ['heat-shimmer', 'sun-ray', 'sun-call'].toReversed() as Loadout, battleContent)).toBeNull();
    expect(setLoadout(progress, 1, ['sun-tap', null, 'sun-call'], battleContent)).toBeNull();
    expect(setLoadout(progress, 2, [null, null, null], battleContent)).toBeNull();
    expect(loadoutFits(progress.team[1]!, ['sun-tap', null, null], battleContent)).toBe(true);
  });
});

describe('the turtle setting', () => {
  it('turns on and off and keeps "Read to me"', () => {
    const on = setTurtle({ ...defaultSettings(), readToMe: true }, true);
    expect(on).toEqual({ readToMe: true, turtle: true, sounds: true });
    expect(setTurtle(on, false)).toEqual({ readToMe: true, turtle: false, sounds: true });
  });
});

describe('the sounds setting', () => {
  it('is on for a new player, turns off and on, and keeps the other settings', () => {
    expect(defaultSettings().sounds).toBe(true);
    const off = setSounds({ ...defaultSettings(), turtle: true }, false);
    expect(off).toEqual({ readToMe: false, turtle: true, sounds: false });
    expect(setSounds(off, true)).toEqual({ readToMe: false, turtle: true, sounds: true });
  });
});
