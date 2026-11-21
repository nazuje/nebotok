import { ARENA_IDLE, SUBUNITS, arenaStep, createRng, otherSide, walkCapOf, type ArenaContent, type ArenaInput, type ArenaInputs, type ArenaState, type Body, type FightEvent, type Side, type StormPhase } from '@nebotok/core';
import type { STATUS_BITS as SERVER_STATUS_BITS } from '../../../server/src/arena-state.ts';

/**
 * Your own creature, predicted (docs/protocol.md, "Prediction"): every input you send is stepped
 * at once with core's `arenaStep`, the same step the server runs, so your creature answers your
 * thumb without waiting a round trip. Each new server state is the base again: the inputs the
 * server has not yet acknowledged are replayed on top of it, and the gap between the old and the
 * new prediction is blended away over `BLEND_MS`, or jumped when it is past `SNAP_BODIES` bodies.
 * Only movement and dashes are predicted. Presses, knocks and ring-outs come from the server: the
 * replay holds no shots or zones, and a cast is only shown starting (`createCastEcho`).
 */

/** Core steps in each of the arena room's fixed steps; your input counts on the first only (apps/server/src/arena-room.ts). */
export const SUB_STEPS = 2;
/** How long a correction takes to blend away, in ms. */
export const BLEND_MS = 120;
/** A correction further than this many bodies jumps instead. */
export const SNAP_BODIES = 1.5;
/** A correction shorter than this, in arena units, is not counted as one. */
const NOTICED_UNITS = 0.5;
/** A rooted creature stays rooted through any replay; the next state says when it is free. */
const HELD_TICKS = 600;
const SECOND_MS = 1_000;

/** `ArenaBody.status` bits the prediction reads, as the server sets them. */
const STATUS_BITS = { rooted: 2, tumbling: 8 } as const satisfies Pick<typeof SERVER_STATUS_BITS, 'rooted' | 'tumbling'>;
const STORM_PHASES: readonly StormPhase[] = ['calm', 'warning', 'shrinking', 'floor'];
/** The replay rolls no dice that matter: it has no shots, zones or wind-ups. */
const NO_DICE = createRng('arena-prediction').state();

export type Point = { readonly x: number; readonly y: number };

/** A creature as the arena room's state shows it (apps/server/src/arena-state.ts `ArenaBody`). */
export type ShownBody = {
  readonly id: string;
  readonly species: string;
  readonly level: number;
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly facing: number;
  readonly health: number;
  readonly max: number;
  readonly status: number;
  readonly cooldowns: { at(index: number): number | undefined };
  readonly turtle: boolean;
};

/** The island as the arena room's state shows it (`ArenaRoomState`). */
export type ShownIsland = {
  readonly phase: string;
  readonly tick: number;
  readonly limit: number;
  readonly radius: number;
  readonly storm: { readonly step: number; readonly phase: string; readonly next: number };
  readonly bodies: { at(index: number): ShownBody | undefined };
};

/** What the netcode meters show (`?test=1&net=1`). Errors are in arena units. */
export type NetMeters = {
  readonly rttMs: number;
  /** Inputs sent and not yet acknowledged: how far ahead of the server your creature runs. */
  readonly lead: number;
  readonly correctionsPerSecond: number;
  readonly meanError: number;
  readonly snaps: number;
  /** Corrections measured, their summed error and the largest, for a check to take a window of. */
  readonly samples: number;
  readonly errorSum: number;
  readonly worstError: number;
  /** Corrections while the server showed your creature tumbling from a knock, which is never predicted: kept out of the error and the snaps. */
  readonly knocked: number;
};

export type Predictor = {
  /** An input just sent as `seq`: your creature steps on it at once. */
  sent(seq: number, input: ArenaInput, now: number): void;
  /** The room's state, with the last input it acknowledged. Does nothing when neither changed. */
  heard(island: ShownIsland, ack: number, now: number): void;
  /** Where to draw your creature, in arena units, or null before the first state. */
  at(now: number): Point | null;
  meters(rttMs: number, lead: number, now: number): NetMeters;
};

/** An input sent, and your creature after it as last predicted. */
type Sent = { readonly seq: number; readonly input: ArenaInput; body: Body | null };
type Glide = { readonly x: number; readonly y: number; readonly since: number };

const tumbling = (body: ShownBody): boolean => (body.status & STATUS_BITS.tumbling) !== 0;

/**
 * Core's body for one the room shows. What the state leaves out comes from `carried`, the
 * prediction's own body at the same input: the dash still driving, the ticks of a knock.
 */
function bodyOf(shown: ShownBody, carried: Body | null, content: ArenaContent): Body {
  const species = content.species.get(shown.species);
  const { island } = content.arena;
  const knocked = carried !== null && carried.knockedTicks > 0 ? carried.knockedTicks : island.knockedTicks;
  return {
    x: shown.x,
    y: shown.y,
    vx: shown.vx,
    vy: shown.vy,
    facing: shown.facing,
    walkCap: species ? walkCapOf(species.stats.speed, content.arena) : 0,
    dashTicks: carried?.dashTicks ?? 0,
    dashDir: carried?.dashDir ?? shown.facing,
    dashCooldown: shown.cooldowns.at(3) ?? 0,
    knockedTicks: tumbling(shown) ? knocked : 0,
    teetering: carried?.teetering ?? false,
    out: false,
    id: shown.id,
    species: shown.species,
    level: shown.level,
    health: shown.health,
    maxHealth: shown.max,
    loadout: [null, null, null],
    cooldowns: [shown.cooldowns.at(0) ?? 0, shown.cooldowns.at(1) ?? 0, shown.cooldowns.at(2) ?? 0],
    turtle: shown.turtle,
    computer: false,
    status: { slowPercent: 100, slowTicks: 0, rootTicks: (shown.status & STATUS_BITS.rooted) !== 0 ? HELD_TICKS : 0, shieldTicks: 0, shieldMove: null, reflectPercent: 0, shieldKnock: 0 },
    windup: null,
    lunge: null,
  };
}

/** Core's island for the room's state, with nothing on it but the two creatures. Null without both. */
export function islandOf(shown: ShownIsland, side: Side, carried: Body | null, content: ArenaContent): ArenaState | null {
  const mine = shown.bodies.at(side);
  const theirs = shown.bodies.at(otherSide(side));
  if (!mine || !theirs) return null;
  const own = bodyOf(mine, carried, content);
  const other = bodyOf(theirs, null, content);
  return {
    // The state's tick is the fight's; the island's own clock restarts each round.
    tick: shown.tick - shown.limit + content.arena.island.limitTicks,
    rng: NO_DICE,
    radius: shown.radius,
    storm: { step: shown.storm.step, phase: STORM_PHASES.find((phase) => phase === shown.storm.phase) ?? 'calm', nextShrink: shown.storm.next < 0 ? null : shown.storm.next },
    bodies: side === 0 ? [own, other] : [other, own],
    things: [],
    nextId: 1,
    weather: null,
    outcome: null,
  };
}

/** One of the room's fixed steps of your input, as the server runs it: the input on the first core step, then the stick alone. Your presses are left to the server. */
export function stepInput(island: ArenaState, side: Side, input: ArenaInput, content: ArenaContent): ArenaState {
  const first: ArenaInput = { dir: input.dir, dash: input.dash, press: null };
  const held: ArenaInput = { dir: input.dir, dash: false, press: null };
  let next = island;
  for (const own of [first, held].slice(0, SUB_STEPS)) {
    const inputs: ArenaInputs = side === 0 ? [own, ARENA_IDLE] : [ARENA_IDLE, own];
    // An ending is the server's to call; the prediction keeps walking.
    next = arenaStep({ ...next, outcome: null }, inputs, content).state;
  }
  return next;
}

const distance = (a: Body, b: Body): number => Math.hypot(a.x - b.x, a.y - b.y) / SUBUNITS;

export function createPredictor(side: Side, content: ArenaContent, sendMs: number): Predictor {
  const snapUnits = content.arena.island.body * SNAP_BODIES;
  let island: ArenaState | null = null;
  /** Your creature one input before `island`, which drawing moves on from. */
  let before: Body | null = null;
  let base: Body | null = null;
  let sentAt = Number.NEGATIVE_INFINITY;
  let pending: Sent[] = [];
  let heardTick = -1;
  let heardAck = -1;
  let glide: Glide | null = null;
  const counts = { samples: 0, errorSum: 0, worstError: 0, snaps: 0, knocked: 0 };
  let corrections: number[] = [];

  const glideLeft = (now: number): Point => {
    const left = glide ? 1 - (now - glide.since) / BLEND_MS : 0;
    return glide && left > 0 ? { x: glide.x * left, y: glide.y * left } : { x: 0, y: 0 };
  };

  /** Counts a correction and starts blending it, or jumps when it is too far. */
  function correct(old: Body, next: Body, knocked: boolean, now: number) {
    const error = distance(old, next);
    if (knocked) counts.knocked += 1;
    else {
      counts.samples += 1;
      counts.errorSum += error;
      counts.worstError = Math.max(counts.worstError, error);
    }
    if (error > snapUnits) {
      glide = null;
      if (!knocked) counts.snaps += 1;
      return;
    }
    if (error === 0) return;
    const left = glideLeft(now);
    glide = { x: left.x + (old.x - next.x) / SUBUNITS, y: left.y + (old.y - next.y) / SUBUNITS, since: now };
    if (error >= NOTICED_UNITS && !knocked) corrections.push(now);
  }

  return {
    sent: (seq, input, now) => {
      const next = island && stepInput(island, side, input, content);
      before = island?.bodies[side] ?? null;
      island = next;
      pending.push({ seq, input, body: next?.bodies[side] ?? null });
      sentAt = now;
    },
    heard: (shown, ack, now) => {
      if (shown.tick === heardTick && ack === heardAck) return;
      heardTick = shown.tick;
      heardAck = ack;
      const acked = pending.findLast((sent) => sent.seq <= ack)?.body ?? base;
      pending = pending.filter((sent) => sent.seq > ack);
      const old = island?.bodies[side] ?? null;
      const fresh = shown.phase !== 'fighting' || old?.id !== shown.bodies.at(side)?.id;
      let next = islandOf(shown, side, fresh ? null : acked, content);
      base = next?.bodies[side] ?? null;
      let previous = base;
      for (const sent of pending) {
        previous = next?.bodies[side] ?? null;
        next = next && stepInput(next, side, sent.input, content);
        sent.body = next?.bodies[side] ?? null;
      }
      const mine = shown.bodies.at(side);
      if (!fresh && old && next && mine) correct(old, next.bodies[side], tumbling(mine), now);
      if (fresh) glide = null;
      island = next;
      before = previous;
    },
    at: (now) => {
      const latest = island?.bodies[side];
      if (!latest) return null;
      const from = before ?? latest;
      const t = Math.min(1, Math.max(0, (now - sentAt) / sendMs));
      const left = glideLeft(now);
      return { x: (from.x + (latest.x - from.x) * t) / SUBUNITS + left.x, y: (from.y + (latest.y - from.y) * t) / SUBUNITS + left.y };
    },
    meters: (rttMs, lead, now) => {
      corrections = corrections.filter((at) => now - at < SECOND_MS);
      return { rttMs, lead, correctionsPerSecond: corrections.length, meanError: counts.samples > 0 ? counts.errorSum / counts.samples : 0, ...counts };
    },
  };
}

/** A cast you pressed, shown starting at once. */
type Echo = { readonly button: number; readonly at: number };
/** How long a cast shown at once waits for the server's own, which it stands in for. */
const ECHO_MS = 1_500;

export type CastEcho = {
  /** Whether a cast on `button` was shown and the server's has not come yet. */
  waiting(button: number, now: number): boolean;
  /** Shows a cast at once: remembers it, so the server's own is not shown again. */
  cast(button: number, now: number): void;
  /** The server's events, without the casts already shown. */
  settle(events: readonly FightEvent[], now: number): FightEvent[];
};

/** Your casts start their animation when you press, not a round trip later (docs/protocol.md, "Prediction"). */
export function createCastEcho(side: Side): CastEcho {
  let echoes: Echo[] = [];
  const fresh = (now: number) => {
    echoes = echoes.filter((echo) => now - echo.at < ECHO_MS);
  };
  return {
    waiting: (button, now) => {
      fresh(now);
      return echoes.some((echo) => echo.button === button);
    },
    cast: (button, now) => {
      echoes.push({ button, at: now });
    },
    settle: (events, now) => {
      fresh(now);
      return events.filter((event) => {
        if (event.kind !== 'cast' || event.side !== side) return true;
        const index = echoes.findIndex((echo) => echo.button === event.button);
        if (index < 0) return true;
        echoes.splice(index, 1);
        return false;
      });
    },
  };
}
