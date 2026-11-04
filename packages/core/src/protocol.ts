import { z } from 'zod';
import { DirectionSchema } from './grid.ts';

/** Bumped whenever a client and server of different versions could misunderstand each other. */
export const PROTOCOL_VERSION = 2;

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

/** Messages a client sends to the world room, by type. See docs/protocol.md. */
export const CLIENT_MESSAGES = {
  ping: 'ping',
  walkTo: 'walk.to',
  walkHold: 'walk.hold',
  walkStop: 'walk.stop',
} as const;

/** Messages the world room sends to a client, by type. */
export const SERVER_MESSAGES = {
  welcome: 'welcome',
  pong: 'pong',
  walkRefused: 'walk.refused',
} as const;

const Coordinate = z.number().int().min(0).max(1_023);

/** Walk along the shortest path to a tile. */
export const WalkToMessage = z.strictObject({ x: Coordinate, y: Coordinate });
export type WalkToMessage = z.infer<typeof WalkToMessage>;

/** Keep walking one way, tile after tile, until a stop or another intent. */
export const WalkHoldMessage = z.strictObject({ direction: DirectionSchema });
export type WalkHoldMessage = z.infer<typeof WalkHoldMessage>;

/** Finish the current step and stand still. */
export const WalkStopMessage = z.strictObject({});

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
