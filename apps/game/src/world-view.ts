import { DIRECTIONS, type Direction, type Point } from '@nebotok/core';
import { extendTrack, sampleTrack, startTrack, type Track } from './track.ts';

/** What the server's state says about one player. */
export type PlayerFacts = {
  readonly name: string;
  readonly avatar: string;
  readonly x: number;
  readonly y: number;
  readonly facing: string;
  readonly moving: boolean;
  readonly connected: boolean;
};

/** One player as the world should draw them right now. */
export type ShownPlayer = {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly self: boolean;
  readonly connected: boolean;
  /** The tile the server last gave, and whether it said the player is moving. */
  readonly tile: Point;
  readonly moving: boolean;
  /** Where to draw them, in tiles, and how. */
  readonly at: Point;
  readonly facing: Direction;
  readonly walking: boolean;
};

/**
 * Others are drawn this far in the past, so there is always a next update to walk towards. The
 * player's own courier needs less, and later gets its own prediction.
 */
export const OTHERS_DELAY_MS = 100;
export const SELF_DELAY_MS = 50;
const DEFAULT_STEP_MS = 200;

type Entry = { facts: PlayerFacts; track: Track };

export type WorldView = {
  /** Forgets everyone, as when a new room is joined or the world is left. */
  reset(): void;
  setSelf(id: string | null): void;
  self(): string | null;
  setStepMs(stepMs: number): void;
  stepMs(): number;
  update(id: string, facts: PlayerFacts, now: number): void;
  remove(id: string): void;
  shown(now: number): ShownPlayer[];
};

const asDirection = (facing: string): Direction => DIRECTIONS.find((direction) => direction === facing) ?? 'down';

/** The client's picture of the world: fed by the server's state, read by the scene every frame. */
export function createWorldView(): WorldView {
  const players = new Map<string, Entry>();
  let selfId: string | null = null;
  let stepMs = DEFAULT_STEP_MS;

  return {
    reset: () => {
      players.clear();
      selfId = null;
    },
    setSelf: (id) => {
      selfId = id;
    },
    self: () => selfId,
    setStepMs: (next) => {
      if (Number.isInteger(next) && next > 0) stepMs = next;
    },
    stepMs: () => stepMs,
    update: (id, facts, now) => {
      const tile = { x: facts.x, y: facts.y };
      const facing = asDirection(facts.facing);
      const known = players.get(id);
      const track = known ? extendTrack(known.track, tile, facing, now, stepMs) : startTrack(tile, facing);
      players.set(id, { facts: { ...facts }, track });
    },
    remove: (id) => {
      players.delete(id);
    },
    shown: (now) =>
      [...players].map(([id, { facts, track }]) => {
        const self = id === selfId;
        const sample = sampleTrack(track, now - (self ? SELF_DELAY_MS : OTHERS_DELAY_MS), stepMs);
        return {
          id,
          name: facts.name,
          avatar: facts.avatar,
          self,
          connected: facts.connected,
          tile: { x: facts.x, y: facts.y },
          moving: facts.moving,
          at: { x: sample.x, y: sample.y },
          facing: sample.facing,
          walking: sample.walking && facts.connected,
        };
      }),
  };
}
