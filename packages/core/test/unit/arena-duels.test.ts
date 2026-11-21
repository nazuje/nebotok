import { describe, expect, it } from 'vitest';
import { RoundsFightSetup, canDuel, duelLineup, duelSetup, duelTeams, evenLevel, fightStart, inDuelReach, newCreature, roundsGiveUp, type CreatureInstance, type RoundsFight } from '../../src/index.ts';
import { fightContent } from '../support/arena-content.ts';
import { battleContent } from '../support/battle-content.ts';

const at = (species: string, level: number, hp?: number): CreatureInstance => {
  const made = newCreature(species, level, battleContent);
  return hp === undefined ? made : { ...made, hp };
};

describe('who can duel', () => {
  it('fights with the first three standing creatures, in team order', () => {
    const team = [at('glowbun', 5), at('puddlepip', 5, 0), at('pinwhirl', 5), at('snowsnoot', 5), at('dawnshell', 5)];
    expect(duelLineup(team).map(({ place }) => place)).toEqual([0, 2, 3]);
    expect(canDuel(team)).toBe(true);
  });

  it('needs three standing creatures', () => {
    expect(canDuel([at('glowbun', 5), at('puddlepip', 5), at('pinwhirl', 5, 0)])).toBe(false);
    expect(canDuel([])).toBe(false);
  });

  it('asks a courier up to 4 tiles away along either axis', () => {
    expect(inDuelReach({ x: 10, y: 10 }, { x: 14, y: 6 })).toBe(true);
    expect(inDuelReach({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false);
    expect(inDuelReach({ x: 10, y: 10 }, { x: 10, y: 5 })).toBe(false);
  });
});

describe('an even match', () => {
  it('is the higher of the two teams’ average levels, rounded half up', () => {
    expect(evenLevel([[at('glowbun', 5), at('glowbun', 6), at('glowbun', 7)], [at('glowbun', 10)]])).toBe(10);
    expect(evenLevel([[at('glowbun', 1), at('glowbun', 2)], [at('glowbun', 1)]])).toBe(2);
    expect(evenLevel([[at('glowbun', 3), at('glowbun', 3), at('glowbun', 4)], [at('glowbun', 2)]])).toBe(3);
  });
});

describe('the duel a yes starts', () => {
  const asker = [at('glowbun', 6), at('puddlepip', 6), at('pinwhirl', 6), at('snowsnoot', 30)];
  const answerer = [at('dawnshell', 12), at('glowbun', 12), at('puddlepip', 12)];

  it('is a best of 3 at real levels, each side with its own creatures, loadouts and turtle setting', () => {
    const setup = duelSetup({ seed: 'duel', teams: [asker, answerer], even: false, turtles: [true, false], content: battleContent });
    expect(RoundsFightSetup.parse(setup)).toEqual(setup);
    expect(setup.picks[0].map(({ place, fighter }) => [place, fighter.id, fighter.species, fighter.level, fighter.turtle, fighter.computer])).toEqual([
      [0, 'a1', 'glowbun', 6, true, false],
      [1, 'a2', 'puddlepip', 6, true, false],
      [2, 'a3', 'pinwhirl', 6, true, false],
    ]);
    expect(setup.picks[1].map(({ fighter }) => [fighter.id, fighter.level, fighter.turtle])).toEqual([
      ['b1', 12, false],
      ['b2', 12, false],
      ['b3', 12, false],
    ]);
    expect(setup.picks[1][1]!.fighter.loadout).toEqual(answerer[1]!.loadout);
    expect(fightStart(setup, fightContent).mode).toBe('rounds');
  });

  it('puts every creature at the even level, its buttons grown or trimmed to fit it, and changes no team', () => {
    const before = JSON.stringify([asker, answerer]);
    const setup = duelSetup({ seed: 'duel', teams: [asker, answerer], even: true, turtles: [false, false], content: battleContent });
    const level = evenLevel([asker, answerer]);
    expect(level).toBe(12);
    expect([...setup.picks[0], ...setup.picks[1]].every(({ fighter }) => fighter.level === level)).toBe(true);
    expect(setup.picks[0][0]!.fighter.loadout).toEqual(['heat-shimmer', 'sun-ray', 'sun-call']);
    const lower = duelSetup({ seed: 'duel', teams: [[at('glowbun', 12), at('glowbun', 1), at('glowbun', 1)], [at('glowbun', 2), at('glowbun', 2), at('glowbun', 2)]], even: true, turtles: [false, false], content: battleContent });
    expect(lower.picks[0][0]!.fighter).toMatchObject({ level: 5, loadout: ['heat-shimmer', null, null] });
    expect(JSON.stringify([asker, answerer])).toBe(before);
  });

  it('needs a standing creature on each side', () => {
    expect(() => duelSetup({ seed: 1, teams: [asker, []], even: false, turtles: [false, false], content: battleContent })).toThrow(RangeError);
  });
});

describe('both sides picking', () => {
  const asker = [at('glowbun', 6), at('puddlepip', 6, 0), at('pinwhirl', 6), at('snowsnoot', 9), at('dawnshell', 4)];
  const answerer = [at('dawnshell', 12), at('glowbun', 12)];

  it('offers every standing creature, by team place, the setup’s first three standing being the defaults', () => {
    const options = { teams: [asker, answerer], even: false, turtles: [false, true], content: battleContent } as const;
    const [mine, theirs] = duelTeams(options);
    expect(mine.map(({ place, fighter }) => [place, fighter.id, fighter.level])).toEqual([
      [0, 'a1', 6],
      [2, 'a3', 6],
      [3, 'a4', 9],
      [4, 'a5', 4],
    ]);
    expect(theirs.map(({ place, fighter }) => [place, fighter.id, fighter.turtle])).toEqual([
      [0, 'b1', true],
      [1, 'b2', true],
    ]);
    const setup = duelSetup({ seed: 'duel', ...options });
    expect(setup.picks[0]).toEqual(mine.slice(0, 3));
    expect(setup.picks[1]).toEqual(theirs);
  });

  it('puts every choice at the even level in an even match', () => {
    const level = evenLevel([asker, answerer]);
    const [mine, theirs] = duelTeams({ teams: [asker, answerer], even: true, turtles: [false, false], content: battleContent });
    expect([...mine, ...theirs].every(({ fighter }) => fighter.level === level)).toBe(true);
  });
});

describe('giving up a duel', () => {
  const teams = [
    [at('glowbun', 6), at('puddlepip', 6), at('pinwhirl', 6)],
    [at('dawnshell', 6), at('glowbun', 6), at('puddlepip', 6)],
  ] as const;
  const start = (): RoundsFight => {
    const fight = fightStart(duelSetup({ seed: 'give-up', teams, even: false, turtles: [false, false], content: battleContent }), fightContent);
    if (fight.mode !== 'rounds') throw new Error('a duel is a best of 3');
    return fight;
  };

  it('loses the round under way and every round after until the other side has 2 wins', () => {
    const given = roundsGiveUp(start(), 0);
    if (given.fight.mode !== 'rounds') throw new Error('giving up keeps a best of 3');
    expect(given.fight.outcome).toMatchObject({ result: 'lost', winner: 1 });
    expect(given.fight.rounds.map(({ round, winner, how }) => [round, winner, how])).toEqual([
      [0, 1, 'gaveUp'],
      [1, 1, 'gaveUp'],
    ]);
    expect(given.fight.score).toEqual([0, 2]);
    expect(given.events.at(-1)).toEqual({ kind: 'fightEnded', result: 'lost' });
  });

  it('needs only the rounds still missing, and leaves a fight already over alone', () => {
    const fight = start();
    const ahead = { ...fight, round: 1, score: [1, 0] as [number, number], rounds: [{ round: 0, winner: 0 as const, how: 'ringOut' as const, tick: 90, replayed: false }] };
    const given = roundsGiveUp(ahead, 1);
    if (given.fight.mode !== 'rounds') throw new Error('giving up keeps a best of 3');
    expect(given.fight.rounds.map(({ round, how }) => [round, how])).toEqual([
      [0, 'ringOut'],
      [1, 'gaveUp'],
    ]);
    expect(given.fight.outcome).toMatchObject({ result: 'won', winner: 0 });
    expect(roundsGiveUp(given.fight, 0)).toEqual({ fight: given.fight, events: [] });
  });
});
