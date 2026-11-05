import { describe, expect, it } from 'vitest';
import { MAX_LEVEL, awardXp, battleStep, createRng, gainXp, maxHpOf, newCreature, sentOut, startBattle, teamAfterBattle, wildBattleSetup, xpForWin, xpToNextLevel } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

describe('growing', () => {
  it('levels up when the experience reaches the next level, keeping the rest and the damage taken', () => {
    const creature = { ...newCreature('sun-blob', 5, battleContent), hp: 10 };
    const grown = gainXp(creature, xpToNextLevel(5) + xpToNextLevel(6) + 3, battleContent);
    expect(grown).toMatchObject({ level: 7, xp: 3 });
    expect(maxHpOf(grown, battleContent) - grown.hp).toBe(maxHpOf(creature, battleContent) - 10);
    expect(gainXp(creature, xpToNextLevel(5) - 1, battleContent)).toMatchObject({ level: 5, xp: xpToNextLevel(5) - 1 });
  });

  it('stops at the top level and keeps a fainted creature fainted', () => {
    expect(gainXp(newCreature('sun-blob', MAX_LEVEL, battleContent), 1_000, battleContent)).toMatchObject({ level: MAX_LEVEL, xp: 0 });
    expect(gainXp({ ...newCreature('sun-blob', 5, battleContent), hp: 0 }, 1_000, battleContent).hp).toBe(0);
    expect(() => gainXp(newCreature('sun-blob', 5, battleContent), -1, battleContent)).toThrow(RangeError);
  });

  it('rewards the creatures that were sent out and still stand after a win', () => {
    const team = [newCreature('rain-blob', 3, battleContent), newCreature('storm-blob', 60, battleContent), newCreature('sun-blob', 3, battleContent)];
    const started = startBattle(wildBattleSetup(team, { species: 'gale-blob', level: 4 }, null), battleContent);
    const rng = createRng(2);
    const switched = battleStep(started.state, [{ kind: 'switch', to: 1 }, { kind: 'move', slot: 0 }], rng, battleContent);
    const events = [...started.events, ...switched.events];
    let { state } = switched;
    while (state.phase === 'choose') {
      const step = battleStep(state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], rng, battleContent);
      events.push(...step.events);
      state = step.state;
    }
    expect(state.phase).toBe('befriend');
    state = battleStep(state, [{ kind: 'run' }, null], rng, battleContent).state;
    expect(state.outcome).toEqual({ winner: 0, reason: 'fainted' });
    expect(sentOut(events)).toEqual([0, 1]);
    const { rewards, team: grown } = awardXp(teamAfterBattle(team, state), state, sentOut(events), battleContent);
    expect(rewards.map((reward) => reward.index)).toEqual([0, 1].filter((index) => state.sides[0].creatures[index]!.hp > 0));
    expect(rewards.every((reward) => reward.xp === xpForWin(4))).toBe(true);
    expect(grown[2]).toEqual(team[2]);
  });

  it('rewards nothing after a run', () => {
    const team = [newCreature('rain-blob', 3, battleContent)];
    const { state } = battleStep(startBattle(wildBattleSetup(team, { species: 'gale-blob', level: 4 }, null), battleContent).state, [{ kind: 'run' }, { kind: 'move', slot: 0 }], createRng(1), battleContent);
    expect(awardXp(team, state, [0], battleContent)).toEqual({ team, rewards: [] });
  });
});
