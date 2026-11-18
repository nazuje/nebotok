import { z } from 'zod';
import { ContentId, type ArenaRules } from '../content.ts';
import { stableHash } from '../hash.ts';
import { createRng, type RngState } from '../rng.ts';
import { DIRECTION_COUNT, SUBUNITS, TICKS_PER_SECOND, div, oppositeDirection, percentOf, toSubunits } from './fixed.ts';
import type { ArenaContent } from './rules.ts';
import { stormAtStart } from './storm.ts';

/**
 * The state of one arena fight: plain whole-number data that `arenaStep` moves on a tick at a
 * time. Positions are in 1/256 arena units from the island's centre, velocities in 1/256 arena
 * units a tick, and every timer counts the ticks left. See docs/arena.md.
 */

export type Side = 0 | 1;
export const ARENA_SIDES: readonly Side[] = [0, 1];
export const otherSide = (side: Side): Side => (side === 0 ? 1 : 0);

/** One side's input for one tick: the stick's direction (0 to 15, or none) and the dash button. */
export const ArenaInput = z.strictObject({
  dir: z.number().int().min(0).max(DIRECTION_COUNT - 1).nullable(),
  dash: z.boolean(),
});
export type ArenaInput = z.infer<typeof ArenaInput>;
export const ARENA_IDLE: ArenaInput = { dir: null, dash: false };
export type ArenaInputs = readonly [ArenaInput, ArenaInput];

/** A creature's body on the island. */
export type Body = {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  /** The direction it faces, 0 to 15 (see `DIRECTION_VECTORS`). */
  readonly facing: number;
  /** Its walking top speed, in 1/256 arena units a tick, from its species' base speed. */
  readonly walkCap: number;
  /** Ticks of dash drive left, and the direction it drives in. */
  readonly dashTicks: number;
  readonly dashDir: number;
  /** Ticks until it can dash again. */
  readonly dashCooldown: number;
  /** Ticks of tumble left after a knock: weak steering, and the lip does not hold it. */
  readonly knockedTicks: number;
  /** Whether its centre is past the lip, hanging over the edge. */
  readonly teetering: boolean;
  /** Knocked off the island: it is out of this fight. */
  readonly out: boolean;
};

export type StormPhase = 'calm' | 'warning' | 'shrinking' | 'floor';

export type ArenaStorm = {
  /** Shrinks finished so far. */
  readonly step: number;
  readonly phase: StormPhase;
  /** The tick the next shrink starts, or null once the island is at its floor. */
  readonly nextShrink: number | null;
};

/** A fight ends on a ring-out or the time limit; `winner` is null for a draw. */
export type ArenaOutcome = {
  readonly winner: Side | null;
  readonly how: 'ringOut' | 'timeUp';
  readonly tick: number;
};

export type ArenaState = {
  readonly tick: number;
  /** The seeded RNG's state, resumed with `rngFromState`, so a fight replays from its seed. */
  readonly rng: RngState;
  /** The island's radius now, in 1/256 arena units. */
  readonly radius: number;
  readonly storm: ArenaStorm;
  readonly bodies: readonly [Body, Body];
  readonly outcome: ArenaOutcome | null;
};

/** What happened in a step, for the screen's juice and for logs. The state is the truth. */
export type ArenaEvent =
  | { readonly kind: 'stormWarning'; readonly step: number; readonly radius: number }
  | { readonly kind: 'stormShrank'; readonly step: number; readonly radius: number }
  | { readonly kind: 'dashed'; readonly side: Side; readonly dir: number }
  /** `side` is the body knocked, by the other one's dash; `knock` in arena units a second. */
  | { readonly kind: 'bumped'; readonly side: Side; readonly knock: number; readonly x: number; readonly y: number }
  | { readonly kind: 'teeter'; readonly side: Side }
  | { readonly kind: 'ringOut'; readonly side: Side };

export type ArenaStepResult = { readonly state: ArenaState; readonly events: readonly ArenaEvent[] };

/** Who fights: the seed for the fight's RNG and the species on side 0 and side 1. */
export const ArenaSetup = z.strictObject({
  seed: z.union([z.number().int(), z.string()]),
  species: z.tuple([ContentId, ContentId]),
});
export type ArenaSetup = z.infer<typeof ArenaSetup>;

/** Bodies start this share of the island's radius from the centre, side 0 on the left facing right. */
const START_PERCENT = 45;

/** Walk cap: `walkBase + walkPerSpeedPercent% × base speed` arena units a second. */
export function walkCapOf(baseSpeed: number, rules: ArenaRules): number {
  const { walkBase, walkPerSpeedPercent } = rules.island;
  return div((walkBase * 100 + walkPerSpeedPercent * baseSpeed) * SUBUNITS, 100 * TICKS_PER_SECOND);
}

function startBody(side: Side, species: string, content: ArenaContent): Body {
  const known = content.species.get(species);
  if (!known) throw new RangeError(`arena: no species "${species}"`);
  const offset = percentOf(toSubunits(content.arena.island.radius), START_PERCENT);
  const facing = side === 0 ? 0 : oppositeDirection(0);
  return {
    x: side === 0 ? -offset : offset,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    walkCap: walkCapOf(known.stats.speed, content.arena),
    dashTicks: 0,
    dashDir: facing,
    dashCooldown: 0,
    knockedTicks: 0,
    teetering: false,
    out: false,
  };
}

/** A fight at tick 0: both bodies standing still across the centre, the island whole. */
export function arenaStart(setup: ArenaSetup, content: ArenaContent): ArenaState {
  const { island } = content.arena;
  return {
    tick: 0,
    rng: createRng(setup.seed).state(),
    radius: toSubunits(island.radius),
    storm: stormAtStart(content.arena),
    bodies: [startBody(0, setup.species[0], content), startBody(1, setup.species[1], content)],
    outcome: null,
  };
}

/** The fight's fingerprint, for goldens and for the server's mismatch log. */
export const arenaHash = (state: ArenaState): string => stableHash(state);
