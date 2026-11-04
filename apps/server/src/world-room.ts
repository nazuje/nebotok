import { Deferred, ErrorCode, Room, ServerError, validate, type Client } from '@colyseus/core';
import {
  CLIENT_MESSAGES,
  CLOSE_CODES,
  IDLE,
  LanguageSchema,
  PLAYER_SPAWN,
  SERVER_MESSAGES,
  WalkHoldMessage,
  WalkStopMessage,
  WalkToMessage,
  createSave,
  createWalker,
  inBounds,
  isCompatibleProtocol,
  isWalkable,
  planWalk,
  stepWalker,
  welcome,
  withIntent,
  type Intent,
  type Language,
  type Point,
  type SaveFile,
  type Walker,
  type WorldInfo,
} from '@nebotok/core';
import { z } from 'zod';
import type { Log } from './log.ts';
import type { ProfileStore } from './profiles.ts';
import type { ProgressStore } from './progress.ts';
import type { WorldContent } from './world.ts';
import { Player, WorldState } from './world-state.ts';

const WORLD: WorldInfo = { name: 'sky' };
/** A dropped player stays in the world, standing still, this long before their seat is given up. */
export const RECONNECT_SECONDS = 180;
export const TICK_RATE = 20;
export const SAVE_EVERY_MS = 30_000;
const MAX_PLAYERS = 16;

export const JoinOptions = z.object({ protocol: z.number().int(), language: LanguageSchema.optional() });

/** What onAuth hands to onJoin as `client.auth`. */
export type SeatAuth = { readonly playerId: number; readonly language: Language | undefined };

export type WorldServices = {
  readonly log: Log;
  readonly world: WorldContent;
  readonly profiles: ProfileStore;
  readonly progress: ProgressStore;
};

type Seat = {
  readonly playerId: number;
  readonly name: string;
  readonly createdAt: string;
  readonly language: Language;
  /** False when the stored save could not be read: what we could not understand is never overwritten. */
  readonly canSave: boolean;
  walker: Walker;
  dirty: boolean;
  /** Set when the same profile joined again elsewhere; this seat then ends without saving. */
  replaced: boolean;
  /** Set when the server itself closes this seat (take-over, sign-out): no reconnection is offered. */
  closing: boolean;
  reconnection: Deferred<Client> | null;
};

/** Checks a join before a seat is reserved: the protocol first, then the session token. */
export function authorizeJoin(profiles: ProfileStore, token: unknown, options: unknown): SeatAuth {
  const parsed = JoinOptions.safeParse(options);
  // A protocol refusal needs a newer page; a session refusal needs the profile screen. The codes differ
  // so the client can tell which.
  if (!parsed.success) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, 'join options need a protocol number');
  if (!isCompatibleProtocol(parsed.data.protocol)) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, `protocol ${parsed.data.protocol} is not supported`);
  const playerId = profiles.authenticate(token);
  if (playerId === null) throw new ServerError(ErrorCode.AUTH_FAILED, 'not signed in');
  return { playerId, language: parsed.data.language };
}

function spawnOf(content: WorldContent): Point {
  const spawn = content.map.spawns[PLAYER_SPAWN];
  if (!spawn) throw new Error(`map ${content.map.id} has no ${PLAYER_SPAWN} spawn`);
  return spawn;
}

/**
 * The one shared family world, wired to its services. Colyseus builds rooms itself, so the
 * services ride on the class.
 */
export function worldRoom({ log, world, profiles, progress }: WorldServices) {
  const { map, stepMs } = world;
  const spawn = spawnOf(world);

  return class WorldRoom extends Room {
    override maxClients = MAX_PLAYERS;
    override maxMessagesPerSecond = 30;
    override state = new WorldState();
    private readonly seats = new Map<string, Seat>();
    private stopListening: () => void = () => {};

    override messages = {
      [CLIENT_MESSAGES.ping]: validate(z.strictObject({ sentAt: z.number().finite() }), (client: Client, { sentAt }) => {
        client.send(SERVER_MESSAGES.pong, { sentAt });
      }),
      [CLIENT_MESSAGES.walkTo]: validate(WalkToMessage, (client: Client, target) => this.walkTo(client, target)),
      [CLIENT_MESSAGES.walkHold]: validate(WalkHoldMessage, (client: Client, { direction }) => this.setIntent(client, { kind: 'hold', direction })),
      [CLIENT_MESSAGES.walkStop]: validate(WalkStopMessage, (client: Client) => this.setIntent(client, IDLE)),
    };

    static override async onAuth(token: string, options: unknown): Promise<SeatAuth> {
      return authorizeJoin(profiles, token, options);
    }

    override onCreate() {
      this.state.map = map.id;
      this.state.stepMs = stepMs;
      this.setFixedTimestep((context) => this.tick(Math.round(context.dtMs)), TICK_RATE);
      this.clock.setInterval(() => this.saveChanged(), SAVE_EVERY_MS);
      this.stopListening = profiles.onSignedOut((playerId) => this.signOut(playerId));
      log.info('room created', { room: this.roomName, roomId: this.roomId });
    }

    override onJoin(client: Client) {
      const auth = client.auth as SeatAuth;
      const profile = profiles.get(auth.playerId);
      if (!profile) throw new ServerError(ErrorCode.AUTH_FAILED, 'this profile no longer exists');
      const earlier = this.activeSeatOf(auth.playerId);
      // Taking over from another device continues from where that device's character stands.
      const start = earlier ? { walker: withIntent(earlier.seat.walker, IDLE), canSave: earlier.seat.canSave, language: earlier.seat.language } : this.load(auth.playerId);
      if (earlier) this.replace(earlier.sessionId, earlier.seat);

      const seat: Seat = {
        playerId: profile.id,
        name: profile.name,
        createdAt: new Date(profile.createdAt).toISOString(),
        language: auth.language ?? start.language,
        canSave: start.canSave,
        walker: start.walker,
        dirty: true,
        replaced: false,
        closing: false,
        reconnection: null,
      };
      const player = new Player();
      player.name = profile.name;
      player.avatar = profile.avatar;
      this.seats.set(client.sessionId, seat);
      this.state.players.set(client.sessionId, player);
      this.show(client.sessionId, seat.walker);
      this.state.playerCount = this.state.players.size;
      client.send(SERVER_MESSAGES.welcome, welcome(WORLD, this.state.playerCount));
      log.info('player joined', { roomId: this.roomId, sessionId: client.sessionId, playerId: seat.playerId, playerCount: this.state.playerCount, tookOver: earlier !== undefined });
    }

    // Colyseus calls onDrop for every close code but a consented leave, including the ones this room
    // sends itself; those seats go straight on to onLeave.
    override onDrop(client: Client, code: number) {
      const seat = this.seats.get(client.sessionId);
      if (seat?.closing) return;
      const player = this.state.players.get(client.sessionId);
      if (player) player.connected = false;
      if (seat) {
        seat.walker = withIntent(seat.walker, IDLE);
        const reconnection = this.allowReconnection(client, RECONNECT_SECONDS);
        // A seat that is not taken back just ends: Colyseus calls onLeave, which saves it. While the
        // room is closing down this is a plain rejected promise rather than a Deferred.
        reconnection.catch(() => {});
        seat.reconnection = reconnection instanceof Deferred ? reconnection : null;
        this.save(seat);
      }
      log.info('player dropped', { roomId: this.roomId, sessionId: client.sessionId, code });
    }

    override onReconnect(client: Client) {
      const seat = this.seats.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (seat) seat.reconnection = null;
      if (player) player.connected = true;
      log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId });
    }

    override onLeave(client: Client, code: number) {
      const seat = this.seats.get(client.sessionId);
      if (seat && !seat.replaced) this.save(seat);
      this.seats.delete(client.sessionId);
      this.state.players.delete(client.sessionId);
      this.state.playerCount = this.state.players.size;
      log.info('player left', { roomId: this.roomId, sessionId: client.sessionId, code, playerCount: this.state.playerCount });
    }

    override onDispose() {
      this.stopListening();
      for (const seat of this.seats.values()) if (!seat.replaced) this.save(seat);
      log.info('room disposed', { roomId: this.roomId });
    }

    private activeSeatOf(playerId: number): { sessionId: string; seat: Seat } | undefined {
      for (const [sessionId, seat] of this.seats) if (seat.playerId === playerId && !seat.replaced) return { sessionId, seat };
      return undefined;
    }

    /** The saved position when it is still a walkable tile of this map, else the spawn. */
    private load(playerId: number): { walker: Walker; canSave: boolean; language: Language } {
      let save: SaveFile | null = null;
      try {
        save = progress.load(playerId);
      } catch (error) {
        log.warn('save unreadable; this player will not be saved', { playerId, error: error instanceof Error ? error.message : String(error) });
        return { walker: createWalker(spawn), canSave: false, language: 'en' };
      }
      const position = save?.data.position;
      const usable = position && position.map === map.id && isWalkable(map, position);
      return { walker: usable ? createWalker(position, position.facing) : createWalker(spawn), canSave: true, language: save?.data.language ?? 'en' };
    }

    private replace(sessionId: string, seat: Seat) {
      seat.replaced = true;
      this.state.players.delete(sessionId);
      this.close(sessionId, seat, CLOSE_CODES.replaced);
    }

    private signOut(playerId: number) {
      const found = this.activeSeatOf(playerId);
      if (found) this.close(found.sessionId, found.seat, CLOSE_CODES.signedOut);
    }

    /** Ends a seat from the server side, whether its client is connected or waiting to reconnect. */
    private close(sessionId: string, seat: Seat, code: number) {
      seat.closing = true;
      if (seat.reconnection) seat.reconnection.reject(new Error(`seat closed with ${code}`));
      else this.clients.get(sessionId)?.leave(code);
    }

    private walkTo(client: Client, target: Point) {
      const seat = this.seats.get(client.sessionId);
      if (!seat || !inBounds(map, target)) return;
      const intent = planWalk(map, seat.walker, target);
      if (intent) seat.walker = withIntent(seat.walker, intent);
      else client.send(SERVER_MESSAGES.walkRefused, { x: target.x, y: target.y });
    }

    private setIntent(client: Client, intent: Intent) {
      const seat = this.seats.get(client.sessionId);
      if (seat) seat.walker = withIntent(seat.walker, intent);
    }

    private tick(dtMs: number) {
      for (const [sessionId, seat] of this.seats) {
        const before = seat.walker;
        const after = stepWalker(map, before, dtMs, stepMs);
        seat.walker = after;
        if (after.x !== before.x || after.y !== before.y || after.facing !== before.facing) seat.dirty = true;
        this.show(sessionId, after);
      }
    }

    private show(sessionId: string, walker: Walker) {
      const player = this.state.players.get(sessionId);
      if (!player) return;
      player.x = walker.x;
      player.y = walker.y;
      player.facing = walker.facing;
      player.moving = walker.moving;
    }

    private saveChanged() {
      for (const seat of this.seats.values()) if (!seat.replaced) this.save(seat);
    }

    private save(seat: Seat) {
      if (!seat.canSave || !seat.dirty) return;
      const { x, y, facing } = seat.walker;
      try {
        progress.save(seat.playerId, createSave({ name: seat.name, language: seat.language, createdAt: seat.createdAt, position: { map: map.id, x, y, facing } }));
        seat.dirty = false;
      } catch (error) {
        log.warn('could not save a player', { playerId: seat.playerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}

export type WorldRoom = InstanceType<ReturnType<typeof worldRoom>>;
