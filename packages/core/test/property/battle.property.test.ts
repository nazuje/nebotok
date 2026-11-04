import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  BOT_NAMES,
  BOT_POLICIES,
  SIDES,
  battleStep,
  createRng,
  isLegalAction,
  opponentOf,
  startBattle,
  type BattleContent,
  type BattleEvent,
  type BattleSetup,
  type BattleState,
  type BotName,
  type SideIndex,
} from '../../src/index.ts';
import { battleContent, speciesIds, weatherIds, withRules } from '../support/battle-content.ts';

const team = fc.array(fc.record({ species: fc.constantFrom(...speciesIds), level: fc.integer({ min: 1, max: 100 }) }), { minLength: 1, maxLength: 6 }).map((creatures) => ({ creatures }));
const setup: fc.Arbitrary<BattleSetup> = fc.record({ sides: fc.tuple(team, team), weather: fc.option(fc.constantFrom(...weatherIds), { nil: null }) });
const bots = fc.tuple(fc.constantFrom(...BOT_NAMES), fc.constantFrom(...BOT_NAMES));
const seed = fc.integer({ min: 0, max: 0xffffffff });

type Step = { readonly before: BattleState; readonly state: BattleState; readonly events: readonly BattleEvent[] };
type Played = { readonly start: BattleState; readonly startEvents: readonly BattleEvent[]; readonly steps: readonly Step[] };

/** Plays a whole battle and keeps every step, checking each action a bot picks is legal. */
function play(battle: BattleSetup, names: readonly [BotName, BotName], value: number, content: BattleContent = battleContent): Played {
  const battleRng = createRng(value);
  const botRng = createRng(`bots:${value}`);
  const started = startBattle(battle, content);
  const steps: Step[] = [];
  let state = started.state;
  // Twice the turn limit plus one: every turn can be followed by one swap step.
  for (let guard = 0; state.phase !== 'over' && guard <= content.rules.turnLimit * 2; guard += 1) {
    const before = state;
    const [first, second] = SIDES.map((side) => {
      const action = BOT_POLICIES[names[side]](before, side, botRng, content);
      expect(isLegalAction(before, side, action)).toBe(true);
      return action;
    });
    const result = battleStep(before, [first ?? null, second ?? null], battleRng, content);
    steps.push({ before, ...result });
    state = result.state;
  }
  return { start: started.state, startEvents: started.events, steps };
}

const finalState = (played: Played): BattleState => played.steps.at(-1)?.state ?? played.start;

function sideOf(state: BattleState, id: string): SideIndex | null {
  for (const side of SIDES) if (state.sides[side].creatures.some((creature) => creature.id === id)) return side;
  return null;
}

/** Every creature id an event names, with the side it must belong to. */
function namedCreatures(event: BattleEvent): readonly (readonly [string, SideIndex])[] {
  switch (event.kind) {
    case 'switched':
      return event.from === null ? [[event.to, event.side]] : [[event.from, event.side], [event.to, event.side]];
    case 'used':
    case 'fainted':
      return [[event.creature, event.side]];
    case 'missed':
    case 'hit':
      return [[event.creature, event.side], [event.target, opponentOf(event.side)]];
    default:
      return [];
  }
}

describe('battle properties', () => {
  it('keeps every creature between 0 and its full health, which never changes', () => {
    fc.assert(
      fc.property(setup, bots, seed, (battle, names, value) => {
        const played = play(battle, names, value);
        for (const { before, state } of played.steps) {
          for (const side of SIDES) {
            state.sides[side].creatures.forEach((creature, at) => {
              expect(Number.isInteger(creature.hp)).toBe(true);
              expect(creature.hp).toBeGreaterThanOrEqual(0);
              expect(creature.hp).toBeLessThanOrEqual(creature.maxHp);
              expect(creature.hp).toBeLessThanOrEqual(before.sides[side].creatures[at]!.hp);
              expect(creature.maxHp).toBe(played.start.sides[side].creatures[at]!.maxHp);
            });
          }
        }
      }),
      { numRuns: 150 },
    );
  });

  it('always ends within the turn limit', () => {
    fc.assert(
      fc.property(setup, bots, seed, fc.constantFrom(battleContent, withRules({ turnLimit: 10 })), (battle, names, value, content) => {
        const played = play(battle, names, value, content);
        const state = finalState(played);
        expect(state.phase).toBe('over');
        expect(state.turn).toBeLessThanOrEqual(content.rules.turnLimit);
        expect(played.steps.at(-1)?.events.at(-1)).toEqual({ kind: 'ended', ...state.outcome });
        const wipedOut = SIDES.filter((side) => state.sides[side].creatures.every((creature) => creature.hp === 0));
        const winner = state.outcome?.winner ?? null;
        const losers = winner === null ? [0, 1] : [opponentOf(winner)];
        // A battle that reaches the turn limit has no side with every creature fainted.
        expect(wipedOut).toEqual(state.outcome?.reason === 'fainted' ? losers : []);
      }),
      { numRuns: 150 },
    );
  });

  it('only ever names real creatures, on the right side, using moves they know', () => {
    fc.assert(
      fc.property(setup, bots, seed, (battle, names, value) => {
        const played = play(battle, names, value);
        const state = finalState(played);
        const events = [...played.startEvents, ...played.steps.flatMap((step) => step.events)];
        for (const [id, side] of events.flatMap(namedCreatures)) expect(sideOf(state, id)).toBe(side);
        const uses = events.flatMap((event) => (event.kind === 'used' ? [event] : []));
        for (const use of uses) {
          const user = state.sides[use.side].creatures.find((creature) => creature.id === use.creature);
          expect(user?.moves).toContain(use.move);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('reports each hit as the health the target lost', () => {
    fc.assert(
      fc.property(setup, bots, seed, (battle, names, value) => {
        for (const { state, events } of play(battle, names, value).steps) {
          for (const event of events) {
            if (event.kind !== 'hit') continue;
            const target = state.sides[opponentOf(event.side)].creatures.find((creature) => creature.id === event.target);
            expect(event.damage).toBeGreaterThanOrEqual(0);
            // The target can only lose more health later in the same step if it is hit again.
            expect(target!.hp).toBeLessThanOrEqual(event.hp);
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it('plays the same battle every time from the same seed', () => {
    fc.assert(
      fc.property(setup, bots, seed, (battle, names, value) => {
        expect(play(battle, names, value)).toEqual(play(battle, names, value));
      }),
      { numRuns: 60 },
    );
  });
});
