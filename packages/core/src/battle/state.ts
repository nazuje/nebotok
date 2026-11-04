import { z } from 'zod';
import { ContentId } from '../content.ts';

export const MAX_TEAM = 6;
export const MOVES_PER_CREATURE = 4;
export const MAX_LEVEL = 100;

export type SideIndex = 0 | 1;
export const SIDES: readonly SideIndex[] = [0, 1];

export function opponentOf(side: SideIndex): SideIndex {
  return side === 0 ? 1 : 0;
}

/**
 * What one side does in a step. `move` uses one of the active creature's four moves by slot;
 * `switch` sends out another creature by its place in the team.
 * Befriending adds a `treat` kind here later, with its own place in `ACTION_ORDER` and a resolver
 * in the engine; it may end a battle with the outcome reason `befriended`.
 */
export const BattleAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), slot: z.number().int().min(0).max(MOVES_PER_CREATURE - 1) }),
  z.strictObject({ kind: z.literal('switch'), to: z.number().int().min(0).max(MAX_TEAM - 1) }),
]);
export type BattleAction = z.infer<typeof BattleAction>;

/** Switches resolve before moves, so a creature switched in takes the hit meant for the one before it. */
export const ACTION_ORDER: Readonly<Record<BattleAction['kind'], number>> = { switch: 0, move: 1 };

export const CreatureSetup = z.strictObject({ species: ContentId, level: z.number().int().min(1).max(MAX_LEVEL) });
export const SideSetup = z.strictObject({ creatures: z.array(CreatureSetup).min(1).max(MAX_TEAM) });

/** A new battle: two teams, and the weather already on the battlefield, which lasts until a move changes it. */
export const BattleSetup = z.strictObject({
  sides: z.tuple([SideSetup, SideSetup]),
  weather: ContentId.nullable(),
});
export type BattleSetup = z.infer<typeof BattleSetup>;

/** A creature in battle. Its id is its side's letter and its place in the team: `a1` to `a6`, `b1` to `b6`. */
export type BattleCreature = {
  readonly id: string;
  readonly species: string;
  readonly type: string;
  readonly level: number;
  readonly moves: readonly string[];
  readonly maxHp: number;
  readonly hp: number;
  readonly attack: number;
  readonly defense: number;
  readonly speed: number;
};

export type BattleSide = {
  readonly creatures: readonly BattleCreature[];
  /** The team index of the creature on the battlefield. */
  readonly active: number;
};

export type FieldWeather = {
  readonly type: string;
  /** Turns left including this one, or null for weather that lasts until a move changes it. */
  readonly turnsLeft: number | null;
};

export type BattleOutcome = {
  /** Null is a draw. */
  readonly winner: SideIndex | null;
  readonly reason: 'fainted' | 'turnLimit';
};

/**
 * `choose`: both sides pick an action. `swap`: each side in `mustSwap` sends out a new creature
 * after its active one fainted, and the other side passes. `over`: see `outcome`.
 */
export type BattlePhase = 'choose' | 'swap' | 'over';

export type BattleState = {
  readonly phase: BattlePhase;
  /** Turns fully resolved so far. */
  readonly turn: number;
  readonly weather: FieldWeather | null;
  readonly sides: readonly [BattleSide, BattleSide];
  readonly mustSwap: readonly [boolean, boolean];
  readonly outcome: BattleOutcome | null;
};

export type Effectiveness = 'strong' | 'weak' | 'normal';
export type FieldEffect = 'boosted' | 'weakened' | 'none';

/** What happened, in order, for the client to animate. Creatures are named by id. */
export type BattleEvent =
  | { readonly kind: 'turnStarted'; readonly turn: number }
  | { readonly kind: 'switched'; readonly side: SideIndex; readonly from: string | null; readonly to: string }
  | { readonly kind: 'used'; readonly side: SideIndex; readonly creature: string; readonly move: string }
  | { readonly kind: 'missed'; readonly side: SideIndex; readonly creature: string; readonly target: string }
  | {
      readonly kind: 'hit';
      readonly side: SideIndex;
      readonly creature: string;
      readonly target: string;
      readonly damage: number;
      /** The target's health after the hit. */
      readonly hp: number;
      readonly effectiveness: Effectiveness;
      readonly field: FieldEffect;
    }
  | { readonly kind: 'fainted'; readonly side: SideIndex; readonly creature: string }
  | { readonly kind: 'weatherStarted'; readonly weather: string; readonly turns: number | null }
  | { readonly kind: 'weatherEnded'; readonly weather: string }
  | { readonly kind: 'mustSwap'; readonly side: SideIndex }
  | { readonly kind: 'ended'; readonly winner: SideIndex | null; readonly reason: BattleOutcome['reason'] };

export type BattleStepResult = { readonly state: BattleState; readonly events: readonly BattleEvent[] };

/** The two actions of a step, one per side; a side with nothing to do passes null. */
export type BattleActions = readonly [BattleAction | null, BattleAction | null];

export class BattleError extends Error {
  override name = 'BattleError';
}

export function creatureId(side: SideIndex, slot: number): string {
  return `${side === 0 ? 'a' : 'b'}${slot + 1}`;
}

export function activeCreature(state: BattleState, side: SideIndex): BattleCreature {
  const { creatures, active } = state.sides[side];
  const creature = creatures[active];
  if (!creature) throw new BattleError(`side ${side} has no creature at ${active}`);
  return creature;
}

export function hasFainted(creature: BattleCreature): boolean {
  return creature.hp === 0;
}

export function isDefeated(side: BattleSide): boolean {
  return side.creatures.every(hasFainted);
}
