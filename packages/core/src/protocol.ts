import { z } from 'zod';
import { DirectionSchema, type Point } from './grid.ts';
import type { WalkCommand } from './movement.ts';

/** Bumped whenever a client and server of different versions could misunderstand each other. */
export const PROTOCOL_VERSION = 4;

export type WorldInfo = {
  readonly name: string;
};

export type WelcomeMessageKey = 'welcome.alone' | 'welcome.together';

export type Welcome = {
  readonly protocol: number;
  readonly world: string;
  readonly playerCount: number;
  readonly messageKey: WelcomeMessageKey;
};

export const WELCOME_MESSAGE_KEYS: readonly WelcomeMessageKey[] = ['welcome.alone', 'welcome.together'];

/** What the server tells a player who has just arrived. `playerCount` includes them. */
export function welcome(world: WorldInfo, playerCount: number): Welcome {
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new RangeError(`welcome() needs at least one player, got ${playerCount}`);
  }
  return {
    protocol: PROTOCOL_VERSION,
    world: world.name,
    playerCount,
    messageKey: playerCount === 1 ? 'welcome.alone' : 'welcome.together',
  };
}

export function isCompatibleProtocol(clientProtocol: number): boolean {
  return clientProtocol === PROTOCOL_VERSION;
}

/** Messages a client sends to the world room, by type. See docs/protocol.md; the payload schemas of the battle and team ones are in messages.ts. */
export const CLIENT_MESSAGES = {
  ping: 'ping',
  walkTo: 'walk.to',
  walkHold: 'walk.hold',
  walkStop: 'walk.stop',
  battleMove: 'battle.move',
  battleSwitch: 'battle.switch',
  battleTreat: 'battle.treat',
  battleRun: 'battle.run',
  teamReorder: 'team.reorder',
  storageSwap: 'storage.swap',
  starterChoose: 'starter.choose',
} as const;

/** Messages the world room sends to a client, by type. Each goes only to the player it is about. */
export const SERVER_MESSAGES = {
  welcome: 'welcome',
  pong: 'pong',
  walkRefused: 'walk.refused',
  progress: 'progress',
  storage: 'storage',
  battleStarted: 'battle.started',
  battleTurn: 'battle.turn',
  battleView: 'battle.view',
  battleResult: 'battle.result',
  battleBefriend: 'battle.befriend',
  refused: 'refused',
} as const;

const Coordinate = z.number().int().min(0).max(1_023);
/** The tile the client planned a walk command from: see `planCommand` in movement.ts. */
const From = z.strictObject({ x: Coordinate, y: Coordinate }).optional();

/** Walk along the shortest path to a tile. */
export const WalkToMessage = z.strictObject({ x: Coordinate, y: Coordinate, from: From });
export type WalkToMessage = z.infer<typeof WalkToMessage>;

/** Keep walking one way, tile after tile, until a stop or another intent. */
export const WalkHoldMessage = z.strictObject({ direction: DirectionSchema, from: From });
export type WalkHoldMessage = z.infer<typeof WalkHoldMessage>;

/** Finish the current step and stand still. */
export const WalkStopMessage = z.strictObject({ from: From });
export type WalkStopMessage = z.infer<typeof WalkStopMessage>;

/** The message that asks the server for a walk command planned from the tile `from`. */
export function walkMessage(command: WalkCommand, from: Point): { readonly type: string; readonly payload: WalkToMessage | WalkHoldMessage | WalkStopMessage } {
  const at = { x: from.x, y: from.y };
  if (command.kind === 'to') return { type: CLIENT_MESSAGES.walkTo, payload: { x: command.target.x, y: command.target.y, from: at } };
  if (command.kind === 'hold') return { type: CLIENT_MESSAGES.walkHold, payload: { direction: command.direction, from: at } };
  return { type: CLIENT_MESSAGES.walkStop, payload: { from: at } };
}

/** Sent back when a walk-to target cannot be reached, so the client can drop its prediction. */
export type WalkRefused = { readonly x: number; readonly y: number };

/**
 * WebSocket close codes the server uses, in the range Colyseus leaves to applications (4011 to 4999).
 * A client that gets `replaced` must not reconnect by itself: the same profile joined elsewhere.
 */
export const CLOSE_CODES = {
  replaced: 4101,
  signedOut: 4102,
} as const;
