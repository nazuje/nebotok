import { z } from 'zod';
import { MAX_TEAM } from './battle/state.ts';
import type { CreatureReward, LearnedMove, WakePoint } from './messages.ts';
import type { ArenaInput, Side } from './arena/state.ts';
import { DIRECTION_COUNT } from './arena/fixed.ts';
import { ROUNDS } from './arena/rounds.ts';
import type { FightEvent, RoundResult, RoundsOutcome, WildOutcome } from './arena/fight-state.ts';

/**
 * The arena room's wire (docs/protocol.md, "Arena fights"): the input each player streams with
 * Colyseus's `room.input()`, and the messages about a fight. The world room sends `arena.join` and
 * `arena.result`; the arena room `arena.started` and `arena.events`.
 */

/** The input schema's fields and their wire types, in order. The server builds its input schema from this. */
export const ARENA_INPUT_FIELDS = {
  dir: 'uint8',
  press: 'uint8',
  dash: 'boolean',
  treat: 'boolean',
  swap: 'boolean',
  leave: 'boolean',
} as const;

/** What `dir` and `press` carry for no direction and no button. */
export const ARENA_NONE = 255;

/** One input as it travels: `dir` 0 to 15 or `ARENA_NONE`, `press` 0 to 2 or `ARENA_NONE`. */
export type ArenaWireInput = {
  dir: number;
  press: number;
  dash: boolean;
  treat: boolean;
  swap: boolean;
  leave: boolean;
};

const BUTTON_COUNT = 3;

const inRange = (value: unknown, count: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < count;

/** A wire input with anything out of its range (NaN, 9999, a string, a missing field) turned into none. */
export function cleanArenaInput(raw: Readonly<Record<string, unknown>>): ArenaWireInput {
  return {
    dir: inRange(raw['dir'], DIRECTION_COUNT) ? raw['dir'] : ARENA_NONE,
    press: inRange(raw['press'], BUTTON_COUNT) ? raw['press'] : ARENA_NONE,
    dash: raw['dash'] === true,
    treat: raw['treat'] === true,
    swap: raw['swap'] === true,
    leave: raw['leave'] === true,
  };
}

/** The core input of a wire input, cleaned first. */
export function arenaInputOf(raw: Readonly<Record<string, unknown>>): ArenaInput {
  const wire = cleanArenaInput(raw);
  return {
    dir: wire.dir === ARENA_NONE ? null : wire.dir,
    dash: wire.dash,
    press: wire.press === ARENA_NONE ? null : (wire.press as 0 | 1 | 2),
    treat: wire.treat,
    swap: wire.swap,
    leave: wire.leave,
  };
}

/**
 * A Colyseus seat reservation, as `matchMaker.reserveSeatFor` makes it and the SDK's
 * `consumeSeatReservation` takes it. The one-time fight ticket stays on the server with it.
 */
export type ArenaSeatReservation = {
  readonly name: string;
  readonly sessionId: string;
  readonly roomId: string;
  readonly processId?: string;
  readonly publicAddress?: string;
  readonly reconnectionToken?: string;
  readonly devMode?: boolean;
};

/** `arena.join`: a fight you are in is ready; join its room with the reservation. */
export type ArenaJoinMessage = { readonly fightId: string; readonly reservation: ArenaSeatReservation };

/** One creature of a side's line-up: its fighter id, species and level, and its team place, or null for a creature not of your team. */
export type ArenaLineupCreature = { readonly id: string; readonly species: string; readonly level: number; readonly place: number | null };

/** `arena.started`: the fight's mode, both sides' line-ups and which side is yours. */
export type ArenaStartedMessage = {
  readonly fightId: string;
  readonly mode: 'wild' | 'rounds';
  readonly side: Side;
  readonly sides: readonly [readonly ArenaLineupCreature[], readonly ArenaLineupCreature[]];
};

/** Messages a player sends the arena room besides its input stream. */
export const ARENA_CLIENT_MESSAGES = {
  pick: 'arena.pick',
} as const;

/** `arena.pick`: the team places of the creatures to fight a best of 3 with, in round order. */
export const ArenaPickMessage = z.strictObject({ order: z.array(z.number().int().min(0).max(MAX_TEAM - 1)).min(1).max(ROUNDS) });
export type ArenaPickMessage = z.infer<typeof ArenaPickMessage>;

/** How long a best of 3 waits for picks before it takes each side's first three standing creatures. */
export const ARENA_PICK_MS = 30_000;
/** The pause between the rounds of a best of 3, while the score shows. */
export const ARENA_BETWEEN_MS = 3_000;
/** What the arena state's `rounds` holds for a round that ended level; otherwise the winner's side. */
export const ROUND_DRAW = 2;

/** `arena.events`: what one fixed step's core steps did, for the screen's juice; `tick` is the fight's tick after them. */
export type ArenaEventsMessage = { readonly tick: number; readonly events: readonly FightEvent[] };

/** Where a befriended creature went. */
export type ArenaBefriended = { readonly species: string; readonly level: number; readonly placedIn: 'team' | 'storage' };

/**
 * `arena.result`: the fight is settled. `outcome` is null for a fight that ended with no result.
 * `rounds` holds a best of 3's islands; a wild fight's is empty.
 */
export type ArenaResultMessage = {
  readonly fightId: string;
  readonly outcome: WildOutcome | RoundsOutcome | null;
  readonly rewards: readonly CreatureReward[];
  readonly befriended: ArenaBefriended | null;
  readonly learned: readonly LearnedMove[];
  readonly rounds: readonly RoundResult[];
  /** Where the player woke after the whole team fainted, or null. */
  readonly woke: WakePoint | null;
};
