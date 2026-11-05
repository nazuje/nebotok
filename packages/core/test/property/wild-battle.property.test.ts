import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { BOT_POLICIES, SIDES, battleStep, canOfferTreat, createRng, isLegalAction, startBattle, type BattleSetup, type BattleState } from '../../src/index.ts';
import { battleContent, speciesIds, weatherIds } from '../support/battle-content.ts';

const creature = fc.record({ species: fc.constantFrom(...speciesIds), level: fc.integer({ min: 1, max: 100 }) });
const setup: fc.Arbitrary<BattleSetup> = fc.record({
  sides: fc.tuple(fc.array(creature, { minLength: 1, maxLength: 6 }).map((creatures) => ({ creatures })), creature.map((wild) => ({ creatures: [wild] }))),
  weather: fc.option(fc.constantFrom(...weatherIds), { nil: null }),
  wild: fc.constant(true as const),
});
const player = fc.constantFrom(BOT_POLICIES.befriender, BOT_POLICIES.random, BOT_POLICIES.greedy);
const seed = fc.integer({ min: 0, max: 0xffffffff });

describe('wild battle properties', () => {
  it('ends within the step bound with a reason that fits how it went', () => {
    fc.assert(
      fc.property(setup, player, seed, (battle, policy, value) => {
        const battleRng = createRng(value);
        const botRng = createRng(`bots:${value}`);
        let state: BattleState = startBattle(battle, battleContent).state;
        let steps = 0;
        const offered: boolean[] = [];
        while (state.phase !== 'over') {
          expect(steps).toBeLessThanOrEqual(battleContent.rules.turnLimit * 2 + 2);
          const before = state;
          const actions = [policy(before, 0, botRng, battleContent), BOT_POLICIES.greedy(before, 1, botRng, battleContent)] as const;
          for (const side of SIDES) expect(isLegalAction(before, side, actions[side])).toBe(true);
          if (actions[0]?.kind === 'treat') offered.push(canOfferTreat(before, 0));
          const result = battleStep(before, actions, battleRng, battleContent);
          for (const event of result.events) {
            if (event.kind !== 'treatOffered') continue;
            expect(event.chance).toBeGreaterThanOrEqual(battleContent.befriending.minPercent);
            expect(event.chance).toBeLessThanOrEqual(battleContent.befriending.maxPercent);
          }
          state = result.state;
          steps += 1;
        }
        expect(offered.every(Boolean)).toBe(true);
        const reason = state.outcome?.reason;
        const winner = state.outcome?.winner;
        const teamFainted = state.sides[0].creatures.every((c) => c.hp === 0);
        // Only the player befriends, a run has no winner, and the wild creature wins only by fainting the whole team or at the turn limit.
        expect(reason !== 'befriended' || winner === 0).toBe(true);
        expect(reason !== 'ran' || winner === null).toBe(true);
        expect(winner !== 1 || teamFainted || reason === 'turnLimit').toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('befriends at least sometimes when the player offers treats', () => {
    let befriended = 0;
    for (let value = 0; value < 100; value += 1) {
      const battle: BattleSetup = { sides: [{ creatures: [{ species: 'storm-blob', level: 40 }] }, { creatures: [{ species: 'rain-blob', level: 10 }] }], weather: null, wild: true };
      let state = startBattle(battle, battleContent).state;
      const battleRng = createRng(value);
      const botRng = createRng(`bots:${value}`);
      while (state.phase !== 'over') {
        state = battleStep(state, [BOT_POLICIES.befriender(state, 0, botRng, battleContent), BOT_POLICIES.greedy(state, 1, botRng, battleContent)], battleRng, battleContent).state;
      }
      if (state.outcome?.reason === 'befriended') befriended += 1;
    }
    expect(befriended).toBeGreaterThan(20);
  });
});
