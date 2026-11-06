/**
 * Payloads of the battle, team, storage and starter messages: zod schemas for what a client sends
 * (the server validates each with them) and types for what the server sends. The message type
 * names are in CLIENT_MESSAGES and SERVER_MESSAGES (protocol.ts); docs/protocol.md explains the flow.
 * These live apart from protocol.ts because they need content ids, and content.ts imports protocol.ts.
 */
import { z } from 'zod';
import { canOfferTreat, legalActions } from './battle/engine.ts';
import { MAX_TEAM, MOVES_PER_CREATURE, PLAYER_SIDE, WILD_SIDE, type BattleCreature, type BattleEvent, type BattleOutcome, type BattlePhase, type BattleState, type FieldWeather } from './battle/state.ts';
import { ContentId } from './content.ts';
import { needsStarter, type Progress } from './creatures.ts';
import { STORAGE_LIMIT, type CreatureInstance } from './save.ts';

const TeamIndex = z.number().int().min(0).max(MAX_TEAM - 1);
const MoveSlot = z.number().int().min(0).max(MOVES_PER_CREATURE - 1);

/** Use the active creature's move in this slot. */
export const BattleMoveMessage = z.strictObject({ slot: MoveSlot });
export type BattleMoveMessage = z.infer<typeof BattleMoveMessage>;

/** Send out the team creature at this place. */
export const BattleSwitchMessage = z.strictObject({ index: TeamIndex });
export type BattleSwitchMessage = z.infer<typeof BattleSwitchMessage>;

/** Offer one of this treat from the inventory, when the battle view's `canTreat` is true. */
export const BattleTreatMessage = z.strictObject({ itemId: ContentId });
export type BattleTreatMessage = z.infer<typeof BattleTreatMessage>;

/** Leave the battle, when the battle view's `canRun` is true. */
export const BattleRunMessage = z.strictObject({});
export type BattleRunMessage = z.infer<typeof BattleRunMessage>;

/** A new team order: `order[i]` is the current place of the creature that moves to place i. */
export const TeamReorderMessage = z
  .strictObject({ order: z.array(TeamIndex).min(1).max(MAX_TEAM) })
  .refine(({ order }) => order.toSorted((a, b) => a - b).every((value, at) => value === at), 'order names every place of the team once');
export type TeamReorderMessage = z.infer<typeof TeamReorderMessage>;

/**
 * At a shrine: both indexes swap a team creature with a stored one; only `team` stores that
 * creature; only `storage` brings that creature onto the team. See `swapStorage` in creatures.ts.
 */
export const StorageSwapMessage = z
  .strictObject({ team: TeamIndex.nullable(), storage: z.number().int().min(0).max(STORAGE_LIMIT - 1).nullable() })
  .refine(({ team, storage }) => team !== null || storage !== null, 'name a team place, a storage place or both');
export type StorageSwapMessage = z.infer<typeof StorageSwapMessage>;

/** The number of an offer in `move.offer`, so an answer cannot land on a later offer. */
export const OfferId = z.number().int().min(1).max(2 ** 31 - 1);

/** The answer to `move.offer` `offer`: forget the move in slot `forget` for the new one, or null to skip the new move. */
export const MoveChooseMessage = z.strictObject({ offer: OfferId, forget: MoveSlot.nullable() });
export type MoveChooseMessage = z.infer<typeof MoveChooseMessage>;

/** A new player's choice of starter, one of the species in content/starters.json. */
export const StarterChooseMessage = z.strictObject({ species: ContentId });
export type StarterChooseMessage = z.infer<typeof StarterChooseMessage>;

/** A creature as the battle screen shows it. The player's own also list their moves. */
export type BattleCreatureView = {
  /** `a1` to `a6` for yours, `b1` for the wild one; turn events name creatures by it. */
  readonly id: string;
  readonly species: string;
  readonly type: string;
  readonly level: number;
  readonly hp: number;
  readonly maxHp: number;
};

export type BattleSideView<Creature> = { readonly active: number; readonly creatures: readonly Creature[] };

/** Everything one player's client needs to draw their battle now. It never names another player. */
export type BattleView = {
  readonly id: string;
  readonly phase: BattlePhase;
  readonly turn: number;
  readonly weather: FieldWeather | null;
  readonly team: BattleSideView<BattleCreatureView & { readonly moves: readonly string[] }>;
  readonly opponent: BattleSideView<BattleCreatureView>;
  /** The player must send `battle.switch` now: their active creature fainted. */
  readonly mustSwap: boolean;
  /** `battle.treat` is allowed now (with a treat the player has). */
  readonly canTreat: boolean;
  readonly canRun: boolean;
  readonly outcome: BattleOutcome | null;
};

const creatureView = ({ id, species, type, level, hp, maxHp }: BattleCreature): BattleCreatureView => ({ id, species, type, level, hp, maxHp });
const teamCreatureView = ({ id, species, type, level, hp, maxHp, moves }: BattleCreature) => ({ id, species, type, level, hp, maxHp, moves });

/** The battle view of the player, who is always side 0. `id` is the server's id for this battle. */
export function battleView(id: string, state: BattleState): BattleView {
  const mine = state.sides[PLAYER_SIDE];
  const theirs = state.sides[WILD_SIDE];
  return {
    id,
    phase: state.phase,
    turn: state.turn,
    weather: state.weather,
    team: { active: mine.active, creatures: mine.creatures.map(teamCreatureView) },
    opponent: { active: theirs.active, creatures: theirs.creatures.map(creatureView) },
    mustSwap: state.mustSwap[PLAYER_SIDE],
    canTreat: canOfferTreat(state, PLAYER_SIDE),
    canRun: legalActions(state, PLAYER_SIDE).some((action) => action.kind === 'run'),
    outcome: state.outcome,
  };
}

/** `battle.started` and `battle.turn`: the battle now, and what happened to get there, in order, to animate. */
export type BattleUpdate = { readonly battle: BattleView; readonly events: readonly BattleEvent[] };

/** `battle.view`: the battle now, with nothing to animate, as after a reconnection. */
export type BattleViewMessage = { readonly battle: BattleView };

/** What the team creature at place `index` got from a battle: `xp` gained, and its level after. */
export type CreatureReward = { readonly index: number; readonly xp: number; readonly level: number };

/** Where a player woke after their whole team fainted: their last shrine, or null for the map's player spawn. */
export type WakePoint = { readonly map: string; readonly shrine: string | null };

/** A move the team creature at place `index` learned. */
export type LearnedMove = { readonly index: number; readonly move: string };

/**
 * `battle.result`: how the battle ended, what each creature gained, the moves they learned at once
 * (with room for them), and where the player woke if they lost.
 */
export type BattleResult = {
  readonly battle: string;
  readonly outcome: BattleOutcome;
  readonly rewards: readonly CreatureReward[];
  readonly learned: readonly LearnedMove[];
  readonly woke: WakePoint | null;
};

/**
 * `move.offer`: the team creature at place `index` (a `species`) can learn `move`, but already
 * knows four, `moves` in slot order. The player answers with `move.choose` naming `offer`.
 */
export type MoveOffer = { readonly offer: number; readonly index: number; readonly species: string; readonly move: string; readonly moves: readonly string[] };

/** `battle.befriend`: the wild creature joined, and where it went. */
export type BefriendResult = { readonly battle: string; readonly species: string; readonly placedIn: 'team' | 'storage' };

/** Why the server did not do what a client asked. */
export const REFUSAL_REASONS = ['notInBattle', 'inBattle', 'notNow', 'noItem', 'notAtShrine', 'full', 'invalid', 'tooFar', 'notTalking'] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** `refused`: a request from this list was not done; `request` is its message type. */
export type Refused = { readonly request: string; readonly reason: RefusalReason };

/** `progress`: the player's own creatures and items. Storage comes separately, at shrines, and the story as `story`. */
export type ProgressMessage = Omit<Progress, 'storage' | 'story'> & { readonly needsStarter: boolean };

export function progressMessage(progress: Progress): ProgressMessage {
  const { team, inventory, lastShrine, seen, befriended } = progress;
  return { team, inventory, lastShrine, seen, befriended, needsStarter: needsStarter(progress) };
}

/** `storage`: the stored creatures, sent at a shrine and after each `storage.swap`. */
export type StorageMessage = { readonly shrine: string; readonly storage: readonly CreatureInstance[] };
