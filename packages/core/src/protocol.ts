import { z } from 'zod';
import { DirectionSchema, type Point } from './grid.ts';
import type { WalkCommand } from './movement.ts';
import type { PlayerSettings } from './save.ts';

/**
 * Bumped whenever a client and server of different versions could misunderstand each other,
 * including when the server starts to accept or require something different with the same messages.
 * 7: the starter comes only through a talk (`STARTER_NEEDS_TALK`), so clients from before it, which
 * open the starter screen by themselves, are refused at the join instead of getting stuck.
 * 8: skills and the job board: gathering, cooking and their tiny games, `Player.skill`, and the
 * refusals `resting`, `needsLevel` and `bagFull`.
 * 9: the tiny games are judged as they are drawn: no grace before a dip or sparkle, a fade after
 * it (`FADE_MS`), one sparkle at a time, and the marker's needle width (`MARKER_HALF_WIDTH`).
 * 10: the player's settings: `settings.set` and `settings` ("Read to me").
 * 11: arena loadouts and the turtle setting: `loadout.set`, `settings.turtle`, `turtle` in
 * `settings`, and `loadout` and `learned` on each team creature in `progress`.
 * 12: the arena room: its input stream (`ARENA_INPUT_FIELDS`), `arena.join` and `arena.result` from
 * the world room, and `arena.started` and `arena.events` from the arena room.
 * 13: duels: `duel.ask`, `duel.answer` and `duel.cancel`, `duel.asked` and `duel.answered`, their
 * rules (`DUEL_REACH`, `DUEL_ANSWER_MS`, `DUEL_PAUSE_MS`, `DUEL_TEAM`), and `arena` in `welcome`.
 * 14: picking three for a best of 3: `arena.pick`, `refused` from the arena room, and its
 * `picking` and `between` phases with `countdown`, `picked` and `rounds` in its state.
 */
export const PROTOCOL_VERSION = 14;

/**
 * The client-server contract each protocol version stands for, as hashed by
 * scripts/lib/protocol-contract.test.mjs. When that test fails, the contract changed: raise
 * PROTOCOL_VERSION and add a line for it with the new hash. Never change an older line.
 */
export const PROTOCOL_CONTRACTS: Readonly<Record<number, string>> = {
  7: '153c0d940d945b',
  8: '08338db2ebbc37',
  9: '134099ff291a6b',
  10: '085c82893f62a3',
  11: '09d3bce56b47cb',
  12: '0262812411765a',
  13: '0f0b76d24fb1b5',
  14: '1e9eadd51b162d',
};

export type WorldInfo = {
  readonly name: string;
};

export type WelcomeMessageKey = 'welcome.alone' | 'welcome.together';

export type Welcome = {
  readonly protocol: number;
  readonly world: string;
  readonly playerCount: number;
  readonly messageKey: WelcomeMessageKey;
  /** Whether arena fights are on (`ARENA_BATTLES`), so the page offers duels. */
  readonly arena: boolean;
};

export const WELCOME_MESSAGE_KEYS: readonly WelcomeMessageKey[] = ['welcome.alone', 'welcome.together'];

/** What the server tells a player who has just arrived. `playerCount` includes them. */
export function welcome(world: WorldInfo, playerCount: number, arena = false): Welcome {
  if (!Number.isInteger(playerCount) || playerCount < 1) {
    throw new RangeError(`welcome() needs at least one player, got ${playerCount}`);
  }
  return {
    protocol: PROTOCOL_VERSION,
    world: world.name,
    playerCount,
    messageKey: playerCount === 1 ? 'welcome.alone' : 'welcome.together',
    arena,
  };
}

export function isCompatibleProtocol(clientProtocol: number): boolean {
  return clientProtocol === PROTOCOL_VERSION;
}

/** Messages a client sends to the world room, by type. See docs/protocol.md; the payload schemas are in messages.ts (battle and team), story-messages.ts (talking), skill-messages.ts (skills and jobs) and duel-messages.ts (duels). */
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
  moveChoose: 'move.choose',
  talkStart: 'talk.start',
  talkNext: 'talk.next',
  talkEnd: 'talk.end',
  gatherStart: 'gather.start',
  cookStart: 'cook.start',
  skillFinish: 'skill.finish',
  skillCancel: 'skill.cancel',
  boardOpen: 'board.open',
  settingsSet: 'settings.set',
  settingsTurtle: 'settings.turtle',
  loadoutSet: 'loadout.set',
  duelAsk: 'duel.ask',
  duelAnswer: 'duel.answer',
  duelCancel: 'duel.cancel',
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
  moveOffer: 'move.offer',
  story: 'story',
  talkNode: 'talk.node',
  talkEnded: 'talk.ended',
  questChanged: 'quest.changed',
  skills: 'skills',
  skillAttempt: 'skill.attempt',
  skillResult: 'skill.result',
  jobs: 'jobs',
  jobChanged: 'job.changed',
  refused: 'refused',
  settings: 'settings',
  arenaJoin: 'arena.join',
  arenaResult: 'arena.result',
  duelAsked: 'duel.asked',
  duelAnswered: 'duel.answered',
} as const;

/** Messages the arena room sends to its players. Its input stream is `ARENA_INPUT_FIELDS` and `arena.pick` is in `ARENA_CLIENT_MESSAGES` (arena-messages.ts). */
export const ARENA_MESSAGES = {
  started: 'arena.started',
  events: 'arena.events',
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

/** Changes the player's own settings, which are saved with them. */
export const SettingsSetMessage = z.strictObject({ readToMe: z.boolean() });
export type SettingsSetMessage = z.infer<typeof SettingsSetMessage>;

/** Turns the player's turtle setting on or off; saved with them like `settings.set`. */
export const SettingsTurtleMessage = z.strictObject({ on: z.boolean() });
export type SettingsTurtleMessage = z.infer<typeof SettingsTurtleMessage>;

/** `settings`: the player's settings, sent on joining and after each `settings.set` and `settings.turtle`. */
export type SettingsMessage = PlayerSettings;

/** Sent back when a walk-to target cannot be reached, so the client can drop its prediction. */
export type WalkRefused = { readonly x: number; readonly y: number };

/**
 * WebSocket close codes the server uses, in the range Colyseus leaves to applications (4011 to 4999).
 * A client that gets `replaced` must not reconnect by itself: the same profile joined elsewhere.
 * `failed` means the server hit an error with this seat alone; the client joins again.
 */
export const CLOSE_CODES = {
  replaced: 4101,
  signedOut: 4102,
  failed: 4103,
} as const;
