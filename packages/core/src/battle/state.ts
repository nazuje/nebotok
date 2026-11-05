import { z } from 'zod';
import { ContentId, CreatureLevel, MAX_LEVEL } from '../content.ts';

export { MAX_LEVEL };
export const MAX_TEAM = 6;
export const MOVES_PER_CREATURE = 4;

export type SideIndex = 0 | 1;
export const SIDES: readonly SideIndex[] = [0, 1];

/** In a wild battle the player is always side 0 and the wild creature side 1. */
export const PLAYER_SIDE: SideIndex = 0;
export const WILD_SIDE: SideIndex = 1;

export function opponentOf(side: SideIndex): SideIndex {
  return side === 0 ? 1 : 0;
}

/**
 * What one side does in a step. `move` uses one of the active creature's moves by slot;
 * `switch` sends out another creature by its place in the team. Only the player in a wild battle
 * may `treat` (offer a treat from items.json, see `canOfferTreat`) or `run`.
 */
export const BattleAction = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('move'), slot: z.number().int().min(0).max(MOVES_PER_CREATURE - 1) }),
  z.strictObject({ kind: z.literal('switch'), to: z.number().int().min(0).max(MAX_TEAM - 1) }),
  z.strictObject({ kind: z.literal('treat'), item: ContentId }),
  z.strictObject({ kind: z.literal('run') }),
]);
export type BattleAction = z.infer<typeof BattleAction>;

/**
 * Running resolves first, then treats, then switches, then moves: a creature switched in takes the
 * hit meant for the one before it, and a treat is offered before the wild creature acts.
 */
export const ACTION_ORDER: Readonly<Record<BattleAction['kind'], number>> = { run: -2, treat: -1, switch: 0, move: 1 };

const MoveList = z
  .array(ContentId)
  .min(1)
  .max(MOVES_PER_CREATURE)
  .refine((moves) => new Set(moves).size === moves.length, 'a creature knows each move once');

/**
 * One creature going into battle. Without `hp` it starts at full health, and without `moves` it
 * knows its species' moves. A team creature brings both from the save; `hp` above its full health
 * is lowered to it.
 */
export const CreatureSetup = z.strictObject({
  species: ContentId,
  level: CreatureLevel,
  hp: z.number().int().min(0).max(1_023).optional(),
  moves: MoveList.optional(),
});
export const SideSetup = z.strictObject({ creatures: z.array(CreatureSetup).min(1).max(MAX_TEAM) });

/**
 * A new battle: two teams, and the weather already on the battlefield, which lasts until a move
 * changes it. `wild: true` makes side 1 one wild creature the player (side 0) can befriend or run from.
 */
export const BattleSetup = z
  .strictObject({
    sides: z.tuple([SideSetup, SideSetup]),
    weather: ContentId.nullable(),
    wild: z.literal(true).optional(),
  })
  .refine((setup) => setup.wild !== true || setup.sides[1].creatures.length === 1, 'a wild battle has one wild creature');
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

/**
 * How a battle ended. `fainted`: one side has no creature left (a wild creature that faints and is
 * not befriended counts here too). `turnLimit`: see BattleRules. `befriended`: the wild creature took
 * a treat and joins the winner. `ran`: the player left a wild battle before winning it.
 */
export type BattleOutcome = {
  /** Null is a draw, or a run. */
  readonly winner: SideIndex | null;
  readonly reason: 'fainted' | 'turnLimit' | 'befriended' | 'ran';
};

/**
 * `choose`: both sides pick an action. `swap`: each side in `mustSwap` sends out a new creature
 * after its active one fainted, and the other side passes. `befriend`: a wild creature has fainted;
 * the player may offer it one treat or run, and the wild side passes. `over`: see `outcome`.
 */
export type BattlePhase = 'choose' | 'swap' | 'befriend' | 'over';

/** What only a wild battle has. */
export type WildBattle = {
  /** While the wild creature is up, a treat can be offered once its health is at or below this. */
  readonly treatHp: number;
};

export type BattleState = {
  readonly phase: BattlePhase;
  /** Turns fully resolved so far. */
  readonly turn: number;
  readonly weather: FieldWeather | null;
  readonly sides: readonly [BattleSide, BattleSide];
  readonly mustSwap: readonly [boolean, boolean];
  readonly outcome: BattleOutcome | null;
  /** Present only in wild battles, so a duel's state (and the battle goldens' hashes) keep their shape. */
  readonly wild?: WildBattle;
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
  | {
      readonly kind: 'treatOffered';
      readonly side: SideIndex;
      readonly item: string;
      readonly target: string;
      /** The befriend chance that was rolled, in percent. */
      readonly chance: number;
      readonly accepted: boolean;
    }
  /** A wild creature fainted: the battle waits in `befriend` for a treat or a run. */
  | { readonly kind: 'canBefriend'; readonly creature: string }
  | { readonly kind: 'ran'; readonly side: SideIndex }
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
