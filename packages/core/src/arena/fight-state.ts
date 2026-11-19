import { z } from 'zod';
import type { TreatLiking } from '../befriend.ts';
import { MAX_TEAM } from '../battle/state.ts';
import { ContentId } from '../content.ts';
import { stableHash } from '../hash.ts';
import { ArenaFighter, type ArenaEvent, type ArenaOutcome, type ArenaState, type Side } from './state.ts';

/**
 * A whole fight around the island (docs/arena.md, "Fight modes"): a wild fight, your team in
 * order against one wild creature, or a best of 3 in rounds, one creature a side each round.
 * `fightStep` (fight.ts) moves it a tick at a time around `arenaStep`.
 */

const Seed = z.union([z.number().int(), z.string().min(1).max(200)]);
const TeamPlace = z.number().int().min(0).max(MAX_TEAM - 1);

/** A stack of one treat in the bag. */
export const TreatStack = z.strictObject({ item: ContentId, count: z.number().int().min(0).max(999) });
export type TreatStack = z.infer<typeof TreatStack>;

/** A team creature that can fight: its place on the team, its fighter and its real health now (at least 1). */
export const WildTeamEntry = z.strictObject({ place: TeamPlace, fighter: ArenaFighter, hp: z.number().int().min(1).max(10_000) });
export type WildTeamEntry = z.infer<typeof WildTeamEntry>;

/**
 * A wild fight: the standing team in order, the lead first, the wild creature, and the treats in the
 * bag. `weather` is the encounter zone's, on the island from the start until a move's weather
 * replaces it; none for clear skies.
 */
export const WildFightSetup = z.strictObject({
  mode: z.literal('wild'),
  seed: Seed,
  team: z.array(WildTeamEntry).min(1).max(MAX_TEAM),
  wild: ArenaFighter,
  treats: z.array(TreatStack).max(100),
  weather: ContentId.optional(),
});
export type WildFightSetup = z.infer<typeof WildFightSetup>;

/** One creature a side picked for the rounds, in order; `place` is its team place, or null for a trainer's. */
export const RoundPick = z.strictObject({ place: TeamPlace.nullable(), fighter: ArenaFighter });
export type RoundPick = z.infer<typeof RoundPick>;

/** A best of 3: each side's picks, one a round. */
export const RoundsFightSetup = z.strictObject({
  mode: z.literal('rounds'),
  seed: Seed,
  picks: z.tuple([z.array(RoundPick).min(1).max(3), z.array(RoundPick).min(1).max(3)]),
});
export type RoundsFightSetup = z.infer<typeof RoundsFightSetup>;

export const FightSetup = z.discriminatedUnion('mode', [WildFightSetup, RoundsFightSetup]);
export type FightSetup = z.infer<typeof FightSetup>;

/**
 * A creature of one side's line-up and how it is doing: its arena health (`hpScale` times its
 * real health), whether it has been on the island, and whether it was rung out of this fight.
 */
export type FightCreature = {
  readonly place: number | null;
  readonly fighter: ArenaFighter;
  readonly health: number;
  readonly maxHealth: number;
  readonly fought: boolean;
  readonly out: boolean;
};

/**
 * A thrown treat: flying, or lying on the ground once it has landed, with the ticks left of its
 * flight or of its time on the ground. Positions and velocities as a body's.
 */
export type FightTreat = {
  readonly item: string;
  readonly liking: TreatLiking;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly radius: number;
  readonly ticks: number;
  readonly landed: boolean;
};

export const WILD_RESULTS = ['won', 'wonByRingOut', 'befriended', 'lost', 'ran', 'timeUp'] as const;
export type WildResult = (typeof WILD_RESULTS)[number];
export type WildOutcome = { readonly result: WildResult; readonly tick: number };

export type WildFight = {
  readonly mode: 'wild';
  /** Ticks since the fight started. */
  readonly tick: number;
  /** Side 0 is the team creature on the island now, side 1 the wild creature. */
  readonly island: ArenaState;
  readonly team: readonly FightCreature[];
  /** The index in `team` of the creature on the island. */
  readonly active: number;
  readonly swapCooldown: number;
  /** The bag's treats, each count down by one for every treat thrown and up for one picked back up. */
  readonly treats: readonly TreatStack[];
  readonly treat: FightTreat | null;
  /** Ticks until the next treat can be thrown, after one was lost. */
  readonly treatWait: number;
  readonly outcome: WildOutcome | null;
};

/** One island of a best of 3: the round (0 to 2), how it ended, and whether it is played again. */
export type RoundResult = {
  readonly round: number;
  readonly winner: Side | null;
  readonly how: ArenaOutcome['how'] | 'forfeit';
  readonly tick: number;
  readonly replayed: boolean;
};

export type RoundsResult = 'won' | 'lost' | 'draw';
/** `result` is side 0's. */
export type RoundsOutcome = { readonly result: RoundsResult; readonly winner: Side | null; readonly tick: number };

export type RoundsFight = {
  readonly mode: 'rounds';
  readonly seed: number | string;
  readonly tick: number;
  readonly island: ArenaState;
  readonly picks: readonly [readonly FightCreature[], readonly FightCreature[]];
  /** The round being played, which is also the index of each side's creature in it. */
  readonly round: number;
  /** Whether this island replays a round that ended level. */
  readonly replay: boolean;
  readonly rounds: readonly RoundResult[];
  readonly score: readonly [number, number];
  readonly outcome: RoundsOutcome | null;
};

export type ArenaFight = WildFight | RoundsFight;

/** What a fight step adds to the island's events. `place` is a team place, or null for a trainer's creature. */
export type FightEvent =
  | ArenaEvent
  | { readonly kind: 'entered'; readonly side: Side; readonly id: string; readonly place: number | null }
  | { readonly kind: 'swapped'; readonly from: number | null; readonly to: number | null }
  | { readonly kind: 'treatThrown'; readonly item: string; readonly liking: TreatLiking }
  | { readonly kind: 'treatLanded'; readonly item: string; readonly x: number; readonly y: number }
  | { readonly kind: 'treatPickedUp'; readonly item: string }
  | { readonly kind: 'treatEaten'; readonly item: string; readonly amount: number; readonly health: number }
  | { readonly kind: 'treatLost'; readonly item: string }
  | { readonly kind: 'befriended'; readonly species: string; readonly level: number }
  | { readonly kind: 'roundEnded'; readonly round: number; readonly winner: Side | null; readonly how: RoundResult['how']; readonly replay: boolean }
  | { readonly kind: 'fightEnded'; readonly result: WildResult | RoundsResult };

export type FightStepResult = { readonly fight: ArenaFight; readonly events: readonly FightEvent[] };

/** The fight's fingerprint, for goldens and for the server's mismatch log. */
export const fightHash = (fight: ArenaFight): string => stableHash(fight);
