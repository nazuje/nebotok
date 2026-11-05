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
  emptyProgress,
  progressOf,
  freeTileNear,
  inBounds,
  isCompatibleProtocol,
  isWalkable,
  planCommand,
  stepWalker,
  welcome,
  withIntent,
  type Language,
  type Point,
  type Progress,
  type SaveFile,
  type WalkCommand,
  type Walker,
  type WorldInfo,
} from '@nebotok/core';
import { z } from 'zod';
import type { Log } from './log.ts';
import { sessionKey, type ProfileStore } from './profiles.ts';
import type { ProgressStore } from './progress.ts';
import { createRateLimiter } from './rate-limit.ts';
import type { WorldContent } from './world.ts';
import { Player, WorldState } from './world-state.ts';

const WORLD: WorldInfo = { name: 'sky' };
/** A dropped player stays in the world, standing still, this long before their seat is given up. */
export const RECONNECT_SECONDS = 180;
export const TICK_RATE = 20;
export const SAVE_EVERY_MS = 30_000;
/** A walker that comes to a stop is saved too, but one seat at most this often, so a crash loses little. */
export const STOP_SAVE_GAP_MS = 5_000;
const MAX_PLAYERS = 16;
/** Each walk.to runs a path search; more than this a second from one client are dropped. */
export const WALK_TO_PER_SECOND = 5;

export const JoinOptions = z.object({ protocol: z.number().int(), language: LanguageSchema.optional() });

/** What onAuth hands to onJoin as `client.auth`. */
export type SeatAuth = { readonly playerId: number; readonly language: Language | undefined; readonly session: string };

export type WorldServices = {
  readonly log: Log;
  readonly world: WorldContent;
  readonly profiles: ProfileStore;
  readonly progress: ProgressStore;
  readonly now: () => number;
};

type Seat = {
  readonly playerId: number;
  /** The `sessionKey` of the session this seat joined with. */
  readonly session: string;
  readonly name: string;
  readonly createdAt: string;
  readonly language: Language;
  /** False when the stored save could not be read: what we could not understand is never overwritten. */
  readonly canSave: boolean;
  /** The creatures, treats and shrine of the save, written back unchanged with every save. */
  progress: Progress;
  walker: Walker;
  dirty: boolean;
  /** When this seat was last saved, by the room's clock. */
  savedAt: number;
  /** Set when its walker stopped; saved once STOP_SAVE_GAP_MS has passed since the last save. */
  stopped: boolean;
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
  if (playerId === null || typeof token !== 'string') throw new ServerError(ErrorCode.AUTH_FAILED, 'not signed in');
  return { playerId, language: parsed.data.language, session: sessionKey(token) };
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
export function worldRoom({ log, world, profiles, progress, now }: WorldServices) {
  const { map, stepMs } = world;
  const spawn = spawnOf(world);

  return class WorldRoom extends Room {
    override maxClients = MAX_PLAYERS;
    override maxMessagesPerSecond = 30;
    override state = new WorldState();
    private readonly seats = new Map<string, Seat>();
    private stopListening: () => void = () => {};
    private readonly walkLimit = createRateLimiter({ limit: WALK_TO_PER_SECOND, windowMs: 1_000, maxKeys: MAX_PLAYERS * 2 });

    override messages = {
      [CLIENT_MESSAGES.ping]: validate(z.strictObject({ sentAt: z.number().finite() }), (client: Client, { sentAt }) => {
        client.send(SERVER_MESSAGES.pong, { sentAt });
      }),
      [CLIENT_MESSAGES.walkTo]: validate(WalkToMessage, (client: Client, { x, y, from }) => this.walkTo(client, { x, y }, from)),
      [CLIENT_MESSAGES.walkHold]: validate(WalkHoldMessage, (client: Client, { direction, from }) => this.command(client, { kind: 'hold', direction }, from)),
      [CLIENT_MESSAGES.walkStop]: validate(WalkStopMessage, (client: Client, { from }) => this.command(client, { kind: 'stop' }, from)),
    };

    static override async onAuth(token: string, options: unknown): Promise<SeatAuth> {
      return authorizeJoin(profiles, token, options);
    }

    override onCreate() {
      this.state.map = map.id;
      this.state.stepMs = stepMs;
      this.setFixedTimestep((context) => this.tick(Math.round(context.dtMs)), TICK_RATE);
      this.clock.setInterval(() => this.checkSeats(), SAVE_EVERY_MS);
      this.stopListening = profiles.onSignedOut((playerId) => this.signOut(playerId));
      log.info('room created', { room: this.roomName, roomId: this.roomId });
    }

    override onJoin(client: Client) {
      const auth = client.auth as SeatAuth;
      const profile = profiles.get(auth.playerId);
      if (!profile) throw new ServerError(ErrorCode.AUTH_FAILED, 'this profile no longer exists');
      const earlier = this.activeSeatOf(auth.playerId);
      // Taking over from another device continues from where that device's character stands.
      const start = earlier
        ? { walker: withIntent(earlier.seat.walker, IDLE), canSave: earlier.seat.canSave, language: earlier.seat.language, progress: earlier.seat.progress }
        : this.load(auth.playerId);
      if (earlier) this.replace(earlier.sessionId, earlier.seat);

      const seat: Seat = {
        playerId: profile.id,
        session: auth.session,
        name: profile.name,
        createdAt: new Date(profile.createdAt).toISOString(),
        language: auth.language ?? start.language,
        canSave: start.canSave,
        progress: start.progress,
        walker: start.walker,
        dirty: true,
        savedAt: Number.NEGATIVE_INFINITY,
        stopped: false,
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

    // A reconnection does not run onAuth again, so the session is checked here.
    override onReconnect(client: Client) {
      const seat = this.seats.get(client.sessionId);
      const player = this.state.players.get(client.sessionId);
      if (seat) seat.reconnection = null;
      if (seat && !profiles.hasSession(seat.playerId)) {
        this.close(client.sessionId, seat, CLOSE_CODES.signedOut);
        log.info('reconnection refused: signed out', { roomId: this.roomId, sessionId: client.sessionId, playerId: seat.playerId });
        return;
      }
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

    /** The saved position when it is still a walkable tile of this map, else the free tile nearest the spawn. */
    private load(playerId: number): { walker: Walker; canSave: boolean; language: Language; progress: Progress } {
      let save: SaveFile | null = null;
      try {
        save = progress.load(playerId);
      } catch (error) {
        log.warn('save unreadable; this player will not be saved', { playerId, error: error instanceof Error ? error.message : String(error) });
        return { walker: createWalker(this.arrival()), canSave: false, language: 'en', progress: emptyProgress() };
      }
      const position = save?.data.position;
      const usable = position && position.map === map.id && isWalkable(map, position);
      return {
        walker: usable ? createWalker(position, position.facing) : createWalker(this.arrival()),
        canSave: true,
        language: save?.data.language ?? 'en',
        progress: save ? progressOf(save.data) : emptyProgress(),
      };
    }

    /** New arrivals spread out around the spawn, so nobody appears on top of someone already there, away players included. */
    private arrival(): Point {
      const taken = [...this.seats.values()].filter((seat) => !seat.replaced).map((seat) => seat.walker);
      return freeTileNear(map, spawn, taken);
    }

    private replace(sessionId: string, seat: Seat) {
      seat.replaced = true;
      this.state.players.delete(sessionId);
      this.close(sessionId, seat, CLOSE_CODES.replaced);
    }

    /** Some of the player's sessions ended: their seat goes unless it joined with one that still holds, as after adding a PIN. */
    private signOut(playerId: number) {
      const found = this.activeSeatOf(playerId);
      if (found && !profiles.isSessionLive(found.seat.session)) this.close(found.sessionId, found.seat, CLOSE_CODES.signedOut);
    }

    /** Ends a seat from the server side, whether its client is connected or waiting to reconnect. */
    private close(sessionId: string, seat: Seat, code: number) {
      seat.closing = true;
      if (seat.reconnection) seat.reconnection.reject(new Error(`seat closed with ${code}`));
      else this.clients.get(sessionId)?.leave(code);
    }

    private walkTo(client: Client, target: Point, from: Point | undefined) {
      const seat = this.seats.get(client.sessionId);
      if (!seat || !inBounds(map, target) || !this.walkLimit.take(client.sessionId, now())) return;
      if (!this.command(client, { kind: 'to', target }, from)) client.send(SERVER_MESSAGES.walkRefused, { x: target.x, y: target.y });
    }

    /** `from` is only a hint: planCommand never lets it move the walker anywhere its own intent or the map would not. */
    private command(client: Client, command: WalkCommand, from: Point | undefined): boolean {
      const seat = this.seats.get(client.sessionId);
      if (!seat) return false;
      const intent = planCommand(map, seat.walker, command, from);
      if (intent) seat.walker = withIntent(seat.walker, intent);
      return intent !== null;
    }

    private tick(dtMs: number) {
      const at = now();
      for (const [sessionId, seat] of this.seats) {
        const before = seat.walker;
        const after = stepWalker(map, before, dtMs, stepMs);
        seat.walker = after;
        if (after.x !== before.x || after.y !== before.y || after.facing !== before.facing) seat.dirty = true;
        if (before.moving && !after.moving) seat.stopped = true;
        if (seat.stopped && !seat.replaced && !seat.closing && at - seat.savedAt >= STOP_SAVE_GAP_MS) {
          seat.stopped = false;
          this.save(seat);
        }
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

    /**
     * Runs every SAVE_EVERY_MS. scripts/admin.sh resets PINs and deletes profiles from its own process,
     * which no signedOut event reaches, so each seat's session is looked up again here: a seat without
     * one is closed (and saved as it leaves), the others are saved.
     */
    checkSeats() {
      for (const [sessionId, seat] of this.seats) {
        if (seat.replaced || seat.closing) continue;
        if (profiles.hasSession(seat.playerId)) this.save(seat);
        else this.close(sessionId, seat, CLOSE_CODES.signedOut);
      }
    }

    private save(seat: Seat) {
      if (!seat.canSave || !seat.dirty) return;
      // Deleted from another process: there is no profile left to save for.
      if (!profiles.get(seat.playerId)) return;
      const { x, y, facing } = seat.walker;
      try {
        progress.save(seat.playerId, createSave({ name: seat.name, language: seat.language, createdAt: seat.createdAt, position: { map: map.id, x, y, facing }, ...seat.progress }));
        seat.dirty = false;
        seat.savedAt = now();
      } catch (error) {
        log.warn('could not save a player', { playerId: seat.playerId, error: error instanceof Error ? error.message : String(error) });
      }
    }
  };
}

export type WorldRoom = InstanceType<ReturnType<typeof worldRoom>>;
