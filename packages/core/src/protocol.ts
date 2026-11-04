/** Bumped whenever a client and server of different versions could misunderstand each other. */
export const PROTOCOL_VERSION = 1;

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
