import { z } from 'zod';
import { ARENA_KINDS, type ArenaShape } from '../arena-shapes.ts';
import { maxHpAt } from '../battle/damage.ts';
import type { Effectiveness } from '../battle/state.ts';
import { ContentId, CreatureLevel, type ArenaRules } from '../content.ts';
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

/** The three ability buttons: 0 holds a quick move, 1 a special and 2 an ultimate (`ARENA_KINDS`). */
export type Button = 0 | 1 | 2;
export const ARENA_BUTTONS: readonly Button[] = [0, 1, 2];

/**
 * One side's input for one tick: the stick's direction (0 to 15, or none), the dash button and the
 * ability button pressed, if any. One button a tick; holding button 1 sends it every tick. `treat`,
 * `swap` and `leave` are the wild fight's own buttons, which only `fightStep` reads (fight.ts);
 * left out, they are not pressed.
 */
export const ArenaInput = z.strictObject({
  dir: z.number().int().min(0).max(DIRECTION_COUNT - 1).nullable(),
  dash: z.boolean(),
  press: z.union([z.literal(0), z.literal(1), z.literal(2)]).nullable().default(null),
  treat: z.boolean().optional(),
  swap: z.boolean().optional(),
  leave: z.boolean().optional(),
});
export type ArenaInput = z.infer<typeof ArenaInput>;
export const ARENA_IDLE: ArenaInput = { dir: null, dash: false, press: null };
export type ArenaInputs = readonly [ArenaInput, ArenaInput];

/** A creature's move on each button, or none. */
export const ArenaLoadout = z.tuple([ContentId.nullable(), ContentId.nullable(), ContentId.nullable()]);
export type ArenaLoadout = z.infer<typeof ArenaLoadout>;

/**
 * One side's creature. `turtle` is its player's easier setting: it takes less damage, and a
 * `computer` creature facing it walks, winds up and cools down more gently. Only a computer's
 * creature winds up before a special or an ultimate.
 */
export const ArenaFighter = z.strictObject({
  id: z.string().min(1).max(64),
  species: ContentId,
  level: CreatureLevel,
  loadout: ArenaLoadout,
  turtle: z.boolean().default(false),
  computer: z.boolean().default(false),
});
export type ArenaFighter = z.infer<typeof ArenaFighter>;

/** Who fights: the seed for the fight's RNG and the creatures on side 0 and side 1. */
export const ArenaSetup = z.strictObject({
  seed: z.union([z.number().int(), z.string()]),
  fighters: z.tuple([ArenaFighter, ArenaFighter]),
});
export type ArenaSetup = z.infer<typeof ArenaSetup>;

/** What slows, roots or shields a body, each for the ticks left. */
export type BodyStatus = {
  /** The share of its walk cap left while slowed. */
  readonly slowPercent: number;
  readonly slowTicks: number;
  /** No walking, dashing or casting. */
  readonly rootTicks: number;
  readonly shieldTicks: number;
  /** The shield's move, the share of a blocked hit it throws back and how hard it knocks. */
  readonly shieldMove: string | null;
  readonly reflectPercent: number;
  readonly shieldKnock: number;
};

/** A press the computer's creature winds up before it casts, aimed when pressed. */
export type Windup = {
  readonly button: Button;
  readonly ticks: number;
  /** The aim, a vector in 1/4096, and where a thrown shape lands in 1/256 units, if the aim help had the other creature. */
  readonly x: number;
  readonly y: number;
  readonly reach: number | null;
};

/** A lunge's drive: the velocity it holds for the ticks left. */
export type Lunge = {
  readonly move: string;
  readonly ticks: number;
  readonly vx: number;
  readonly vy: number;
};

/** A creature's body on the island, and the fighter it carries. */
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
  /** The creature: its id, species and level. */
  readonly id: string;
  readonly species: string;
  readonly level: number;
  /** Arena health: `hpScale` times its real health. 0 is a knockout. */
  readonly health: number;
  readonly maxHealth: number;
  readonly loadout: ArenaLoadout;
  /** Ticks until each button can be pressed again. */
  readonly cooldowns: readonly [number, number, number];
  readonly turtle: boolean;
  readonly computer: boolean;
  readonly status: BodyStatus;
  readonly windup: Windup | null;
  readonly lunge: Lunge | null;
  /**
   * Ticks left in which nothing can hit, bump or knock it: a creature that came onto the island
   * during a wild fight (fight.ts). Bodies that started the fight have none.
   */
  readonly graceTicks?: number;
};

/**
 * Shots (bolt, spray, snare), and zones and marks (puddle, freeze, strike, wall, zone), in the
 * order they were made. `side` is whose hit it is; a reflected shot changes side.
 */
export type Thing = {
  readonly id: number;
  readonly side: Side;
  readonly move: string;
  readonly shape: ArenaShape;
  readonly x: number;
  readonly y: number;
  /** A velocity in 1/256 units a tick: a shot's flight or a wall's roll. */
  readonly vx: number;
  readonly vy: number;
  /** The aim it was cast along, a vector in 1/4096. */
  readonly dx: number;
  readonly dy: number;
  /** In 1/256 units: a shot's size, a zone's radius or a wall's half-width. */
  readonly radius: number;
  /** Ticks before it works (a thrown puddle, a forming freeze, a strike's mark). */
  readonly armTicks: number;
  /** Ticks left of its flight or its life once armed. */
  readonly ticks: number;
  /** A zone's ticks to its next pulse. */
  readonly pulseTicks: number;
  /** Whether it has hit already: walls, puddles and strikes hit once. */
  readonly touched: boolean;
};

/** The weather on the island, for the ticks left. */
export type ArenaWeather = { readonly type: string; readonly ticks: number };

export type StormPhase = 'calm' | 'warning' | 'shrinking' | 'floor';

export type ArenaStorm = {
  /** Shrinks finished so far. */
  readonly step: number;
  readonly phase: StormPhase;
  /** The tick the next shrink starts, or null once the island is at its floor. */
  readonly nextShrink: number | null;
};

/** A fight ends on a knockout, a ring-out or the time limit; `winner` is null for a draw. */
export type ArenaOutcome = {
  readonly winner: Side | null;
  readonly how: 'knockout' | 'ringOut' | 'timeUp';
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
  readonly things: readonly Thing[];
  /** The id the next thing gets. */
  readonly nextId: number;
  readonly weather: ArenaWeather | null;
  readonly outcome: ArenaOutcome | null;
};

/** Why a press did nothing: the button is locked by level, has no move, the body cannot act, or it is cooling down. */
export type RefusedReason = 'locked' | 'empty' | 'busy' | 'cooling';

export type ArenaStatusKind = 'slow' | 'root' | 'shield' | 'pull';

/** What happened in a step, for the screen's juice and for logs. The state is the truth. */
export type ArenaEvent =
  | { readonly kind: 'stormWarning'; readonly step: number; readonly radius: number }
  | { readonly kind: 'stormShrank'; readonly step: number; readonly radius: number }
  | { readonly kind: 'dashed'; readonly side: Side; readonly dir: number }
  /** `side` is the body knocked, by the other one's dash; `knock` in arena units a second. */
  | { readonly kind: 'bumped'; readonly side: Side; readonly knock: number; readonly x: number; readonly y: number }
  | { readonly kind: 'teeter'; readonly side: Side }
  | { readonly kind: 'ringOut'; readonly side: Side }
  | { readonly kind: 'refused'; readonly side: Side; readonly button: Button; readonly reason: RefusedReason }
  | { readonly kind: 'windup'; readonly side: Side; readonly button: Button; readonly move: string; readonly ticks: number }
  | { readonly kind: 'cast'; readonly side: Side; readonly button: Button; readonly move: string; readonly shape: ArenaShape }
  /** `side` is the body hit, by `by`'s move; `damage` is the health it took and `health` what is left; `knock` in arena units a second. */
  | {
      readonly kind: 'hit';
      readonly side: Side;
      readonly by: Side;
      readonly move: string;
      readonly damage: number;
      readonly health: number;
      readonly effectiveness: Effectiveness;
      readonly knock: number;
      readonly x: number;
      readonly y: number;
    }
  /** `side`'s shield took `by`'s hit or touch instead. */
  | { readonly kind: 'blocked'; readonly side: Side; readonly by: Side }
  /** `side`'s shield sent the shot `thing` back; it now has the shot's new id. */
  | { readonly kind: 'reflected'; readonly side: Side; readonly thing: number }
  | { readonly kind: 'status'; readonly side: Side; readonly status: ArenaStatusKind; readonly ticks: number }
  | { readonly kind: 'healed'; readonly side: Side; readonly amount: number; readonly health: number }
  | { readonly kind: 'weatherStarted'; readonly weather: string; readonly ticks: number }
  | { readonly kind: 'weatherEnded'; readonly weather: string }
  | { readonly kind: 'fainted'; readonly side: Side };

export type ArenaStepResult = { readonly state: ArenaState; readonly events: readonly ArenaEvent[] };

/** Bodies start this share of the island's radius from the centre, side 0 on the left facing right. */
const START_PERCENT = 45;

/** Walk cap: `walkBase + walkPerSpeedPercent% × base speed` arena units a second. */
export function walkCapOf(baseSpeed: number, rules: ArenaRules): number {
  const { walkBase, walkPerSpeedPercent } = rules.island;
  return div((walkBase * 100 + walkPerSpeedPercent * baseSpeed) * SUBUNITS, 100 * TICKS_PER_SECOND);
}

/** Whether a computer's creature fights gently, because the player it faces has the turtle setting on. */
export const isGentle = (body: Body, other: Body): boolean => body.computer && other.turtle;

/** Whether the body is still in its grace after coming onto the island, so nothing can hit, bump or knock it. */
export const inGrace = (body: Body): boolean => (body.graceTicks ?? 0) > 0;

/** The loadout, with each move checked to exist and to be of its button's kind. */
function checkedLoadout(fighter: ArenaFighter, content: ArenaContent): ArenaLoadout {
  fighter.loadout.forEach((id, button) => {
    if (id === null) return;
    const kind = content.moves.get(id)?.arena?.kind;
    if (kind !== ARENA_KINDS[button]) throw new RangeError(`arena: "${id}" is not a ${ARENA_KINDS[button]} move for button ${button + 1}`);
  });
  return fighter.loadout;
}

/** The body of `fighter` on `side` at the start of a fight, at full health, facing `other`. */
export function startBody(side: Side, fighter: ArenaFighter, other: ArenaFighter, content: ArenaContent): Body {
  const rules = content.arena;
  const known = content.species.get(fighter.species);
  if (!known) throw new RangeError(`arena: no species "${fighter.species}"`);
  const offset = percentOf(toSubunits(rules.island.radius), START_PERCENT);
  const facing = side === 0 ? 0 : oppositeDirection(0);
  const walkCap = walkCapOf(known.stats.speed, rules);
  const maxHealth = maxHpAt(known, fighter.level) * rules.island.hpScale;
  return {
    x: side === 0 ? -offset : offset,
    y: 0,
    vx: 0,
    vy: 0,
    facing,
    walkCap: fighter.computer && other.turtle ? percentOf(walkCap, rules.easier.walkPercent) : walkCap,
    dashTicks: 0,
    dashDir: facing,
    dashCooldown: 0,
    knockedTicks: 0,
    teetering: false,
    out: false,
    id: fighter.id,
    species: fighter.species,
    level: fighter.level,
    health: maxHealth,
    maxHealth,
    loadout: checkedLoadout(fighter, content),
    cooldowns: [rules.kinds.quick.openingTicks, rules.kinds.special.openingTicks, rules.kinds.ultimate.openingTicks],
    turtle: fighter.turtle,
    computer: fighter.computer,
    status: { slowPercent: 100, slowTicks: 0, rootTicks: 0, shieldTicks: 0, shieldMove: null, reflectPercent: 0, shieldKnock: 0 },
    windup: null,
    lunge: null,
  };
}

/** A fight at tick 0: both creatures at full health, standing still across the centre, the island whole. */
export function arenaStart(setup: ArenaSetup, content: ArenaContent): ArenaState {
  const { island } = content.arena;
  const [first, second] = setup.fighters;
  return {
    tick: 0,
    rng: createRng(setup.seed).state(),
    radius: toSubunits(island.radius),
    storm: stormAtStart(content.arena),
    bodies: [startBody(0, first, second, content), startBody(1, second, first, content)],
    things: [],
    nextId: 1,
    weather: null,
    outcome: null,
  };
}

/** The fight's fingerprint, for goldens and for the server's mismatch log. */
export const arenaHash = (state: ArenaState): string => stableHash(state);
