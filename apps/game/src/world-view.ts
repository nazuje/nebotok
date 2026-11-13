import type { Point, WorldMap } from '@nebotok/core';
import { advance, applyCommand, canReach, drawnAt, isDirection, reconcile, startPrediction, type Command, type Prediction, type ServerSelf } from './self-walker.ts';
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
  readonly inBattle: boolean;
  readonly talking: boolean;
  /** The skill they are doing (`fishing`, `foraging`, `cooking`), or `''`. */
  readonly skill: string;
};

/** One player as the world should draw them right now. */
export type ShownPlayer = {
  readonly id: string;
  readonly name: string;
  readonly avatar: string;
  readonly self: boolean;
  readonly connected: boolean;
  readonly inBattle: boolean;
  readonly talking: boolean;
  readonly skill: string;
  /** The tile the server last gave, and whether it said the player is moving. */
  readonly tile: Point;
  readonly moving: boolean;
  /** Where to draw them, in tiles, and how. */
  readonly at: Point;
  readonly facing: ServerSelf['facing'];
  readonly walking: boolean;
};

/** Others are drawn this far in the past, so there is always a next update to walk towards. */
export const OTHERS_DELAY_MS = 100;
const DEFAULT_STEP_MS = 200;

type Entry = { facts: PlayerFacts; track: Track };

export type WorldView = {
  /** Forgets everyone, as when a new room is joined or the world is left. */
  reset(): void;
  setSelf(id: string | null): void;
  self(): string | null;
  /** Drops the prediction, so your courier starts again from the server's tile with nothing to do. */
  restart(): void;
  setMap(map: WorldMap | null): void;
  setStepMs(stepMs: number): void;
  stepMs(): number;
  update(id: string, facts: PlayerFacts, now: number): void;
  remove(id: string): void;
  /** How many other players the server has told this page about, away ones included. */
  others(): number;
  /** Moves the prediction on to `now` and lines it up with the server. Called once a frame. */
  tick(now: number): void;
  /** Applies a command to your own courier at once. The tile it was planned from, for the server; null when a walk target cannot be reached. */
  command(command: Command): Point | null;
  /** Whether a walk to this tile would be accepted from where your courier is now. */
  canReach(target: Point): boolean;
  /** The server refused a walk: stop predicting it. */
  refused(): void;
  /** The map shown and your own courier's tile on it as the server last gave it, once both are known. */
  standing(): { map: WorldMap; tile: Point } | null;
  /** Your own courier's predicted tile, plan and facing, once it is known. */
  predicted(): { tile: Point; intent: 'idle' | 'hold' | 'path'; moving: boolean; facing: ServerSelf['facing'] } | null;
  shown(now: number): ShownPlayer[];
};

const asDirection = (facing: string) => (isDirection(facing) ? facing : 'down');
const serverSelf = (facts: PlayerFacts): ServerSelf => ({ x: facts.x, y: facts.y, facing: asDirection(facts.facing), moving: facts.moving });

/**
 * The client's picture of the world: fed by the server's state, read by the scene every frame.
 * Others follow their tracks a little in the past; your own courier is predicted.
 */
export function createWorldView(): WorldView {
  const players = new Map<string, Entry>();
  let selfId: string | null = null;
  let map: WorldMap | null = null;
  let stepMs = DEFAULT_STEP_MS;
  let prediction: Prediction | null = null;
  let tickedAt: number | null = null;

  type Motion = Pick<ShownPlayer, 'at' | 'facing' | 'walking'>;
  const predictedMotion = (predicted: Prediction, now: number): Motion => ({ at: drawnAt(predicted, stepMs, now), facing: predicted.walker.facing, walking: predicted.walker.moving });
  const trackedMotion = (track: Track, facts: PlayerFacts, now: number): Motion => {
    const sample = sampleTrack(track, now - OTHERS_DELAY_MS, stepMs);
    return { at: { x: sample.x, y: sample.y }, facing: sample.facing, walking: sample.walking && facts.connected };
  };

  const selfFacts = () => (selfId === null ? undefined : players.get(selfId)?.facts);

  const view: WorldView = {
    reset: () => {
      players.clear();
      selfId = null;
      prediction = null;
      tickedAt = null;
    },
    setSelf: (id) => {
      selfId = id;
      prediction = null;
    },
    self: () => selfId,
    restart: () => {
      prediction = null;
    },
    setMap: (next) => {
      map = next;
      prediction = null;
    },
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
      if (id === selfId) prediction = null;
    },
    others: () => players.size - (selfId !== null && players.has(selfId) ? 1 : 0),
    tick: (now) => {
      const facts = selfFacts();
      const dt = tickedAt === null ? 0 : now - tickedAt;
      tickedAt = now;
      if (!facts || !map) return;
      const server = serverSelf(facts);
      prediction = reconcile(advance(prediction ?? startPrediction(server), map, dt, stepMs), map, server, stepMs, now);
    },
    command: (command) => {
      if (!prediction || !map) return null;
      const next = applyCommand(prediction, map, command, stepMs);
      if (next) prediction = next.prediction;
      return next?.from ?? null;
    },
    canReach: (target) => prediction !== null && map !== null && canReach(prediction, map, target),
    refused: () => {
      if (map && prediction) prediction = applyCommand(prediction, map, { kind: 'stop' }, stepMs)?.prediction ?? prediction;
    },
    standing: () => {
      const facts = selfFacts();
      return map && facts ? { map, tile: { x: facts.x, y: facts.y } } : null;
    },
    predicted: () =>
      prediction && { tile: { x: prediction.walker.x, y: prediction.walker.y }, intent: prediction.walker.intent.kind, moving: prediction.walker.moving, facing: prediction.walker.facing },
    shown: (now) =>
      [...players].map(([id, { facts, track }]) => {
        const self = id === selfId;
        const motion = self && prediction ? predictedMotion(prediction, now) : trackedMotion(track, facts, now);
        const { at, facing, walking } = motion;
        return { id, name: facts.name, avatar: facts.avatar, self, connected: facts.connected, inBattle: facts.inBattle, talking: facts.talking, skill: facts.skill, tile: { x: facts.x, y: facts.y }, moving: facts.moving, at, facing, walking };
      }),
  };
  return view;
}
