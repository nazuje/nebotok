import { rngFromState, type RngState } from '../rng.ts';
import type { Ability } from './abilities.ts';
import type { ArenaContent } from './rules.ts';
import type { ArenaEvent, ArenaWeather, Body, Button, Side, Thing } from './state.ts';

/**
 * The fight while one step works it out: copies of the bodies and things that the step's phases
 * change in place, and what the step has decided so far. Only `arenaStep` makes one.
 */

export type MovingBody = { -readonly [Key in keyof Body]: Body[Key] };
export type MovingThing = { -readonly [Key in keyof Thing]: Thing[Key] };

/** An aim: a vector in 1/4096, and where a thrown shape lands (1/256 units) when the aim help has the other creature. */
export type Aim = { readonly x: number; readonly y: number; readonly reach: number | null };

/** A cast that hits at once (cone, burst, the weather's push ring); it lands once both sides have acted, so neither goes first. */
export type InstantHit = { readonly side: Side; readonly button: Button; readonly ability: Ability; readonly aim: Aim };

export type Working = {
  readonly tick: number;
  readonly content: ArenaContent;
  readonly bodies: [MovingBody, MovingBody];
  things: MovingThing[];
  nextId: number;
  weather: ArenaWeather | null;
  readonly events: ArenaEvent[];
  /**
   * Each side's health in permille at the start of the step. Every knock in the step reads it, so
   * the order the step lands hits in never changes how far a body flies.
   */
  readonly healthAtStart: readonly [number, number];
  readonly instants: InstantHit[];
  /** Weathers cast this step; `settleWeather` picks one. */
  readonly weatherCalls: ArenaWeather[];
  /** Heals from zones this step, given after every hit of the step. */
  readonly heals: { readonly side: Side; readonly amount: number }[];
  /** Pulls from snares this step, in arena units, made together once every shot has flown. */
  readonly pulls: { readonly side: Side; readonly units: number }[];
  rng: RngState;
  /** The step's damage roll, drawn when its first hit needs it. */
  roll: number | null;
};

/**
 * The damage roll, `minRollPercent` to 100: one a step, shared by every hit in it, so a mirrored
 * fight draws the same numbers whichever side hits first.
 */
export function rollOf(work: Working): number {
  if (work.roll === null) {
    const rng = rngFromState(work.rng);
    work.roll = rng.int(work.content.rules.minRollPercent, 100);
    work.rng = rng.state();
  }
  return work.roll;
}

/** Hands out the next thing id. */
export function nextIdOf(work: Working): number {
  const id = work.nextId;
  work.nextId += 1;
  return id;
}
