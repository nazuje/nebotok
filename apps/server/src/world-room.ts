import { randomInt, randomUUID } from 'node:crypto';
import { Deferred, ErrorCode, Room, ServerError, validate, type Client } from '@colyseus/core';
import {
  BattleMoveMessage,
  BattleRunMessage,
  BattleSwitchMessage,
  BattleTreatMessage,
  CLIENT_MESSAGES,
  CLOSE_CODES,
  IDLE,
  LanguageSchema,
  PLAYER_SPAWN,
  SERVER_MESSAGES,
  StarterChooseMessage,
  StorageSwapMessage,
  TeamReorderMessage,
  WalkHoldMessage,
  WalkStopMessage,
  WalkToMessage,
  battleView,
  canBattle,
  chooseStarter,
  createRng,
  createSave,
  createWalker,
  emptyProgress,
  encounterZoneAt,
  freeTileNear,
  healTeam,
  inBounds,
  isCompatibleProtocol,
  isWalkable,
  markSeen,
  needsStarter,
  planCommand,
  progressMessage,
  progressOf,
  reorderTeam,
  rollEncounter,
  shrineAt,
  stepWalker,
  swapStorage,
  wakeAfterFainting,
  wakePoint,
  welcome,
  withIntent,
  type BattleEvent,
  type BattleResult,
  type BattleUpdate,
  type BattleViewMessage,
  type BefriendResult,
  type Direction,
  type EncounterZone,
  type Language,
  type Point,
  type Progress,
  type RefusalReason,
  type Refused,
  type SaveFile,
  type StorageMessage,
  type WakePoint,
  type WalkCommand,
  type Walker,
  type WildEncounter,
  type WorldInfo,
} from '@nebotok/core';
import { z } from 'zod';
import { BATTLE_IDLE_MS, abandonBattle, beginBattle, planRequest, playStep, settleBattle, storageRefusal, type BattleRequest, type LiveBattle } from './battles.ts';
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
/** Battle, team, storage and starter requests a second from one client; more are dropped. A battle needs one a turn. */
export const REQUESTS_PER_SECOND = 5;
/** How often battles left without input are looked for. */
export const BATTLE_CHECK_MS = 5_000;

export const JoinOptions = z.object({ protocol: z.number().int(), language: LanguageSchema.optional() });

/** What onAuth hands to onJoin as `client.auth`. */
export type SeatAuth = { readonly playerId: number; readonly language: Language | undefined; readonly session: string };

export type WorldServices = {
  readonly log: Log;
  readonly world: WorldContent;
  readonly profiles: ProfileStore;
  readonly progress: ProgressStore;
  readonly now: () => number;
  /** A fresh 32-bit seed from the server's randomness, for the encounter RNG and each battle. */
  readonly seed?: () => number;
};

const cryptoSeed = (): number => randomInt(0, 2 ** 32);

type Seat = {
  readonly playerId: number;
  /** The `sessionKey` of the session this seat joined with. */
  readonly session: string;
  readonly name: string;
  readonly createdAt: string;
  readonly language: Language;
  /** False when the stored save could not be read: what we could not understand is never overwritten. */
  readonly canSave: boolean;
  /** The creatures, treats and shrine of the save. During a battle the team keeps its health from before it. */
  progress: Progress;
  walker: Walker;
  /** The player's one battle, or null. While it lasts the player cannot walk. */
  battle: LiveBattle | null;
  /** The shrine the player is resting at, so walking about next to it heals only once. */
  restedAt: string | null;
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

/** The tile a walker's step has just ended on during a tick, or null: it was moving and then stopped or claimed another tile. */
function arrivedAt(before: Walker, after: Walker): Point | null {
  if (!before.moving) return null;
  return !after.moving || after.x !== before.x || after.y !== before.y ? { x: before.x, y: before.y } : null;
}

/**
 * The one shared family world, wired to its services. Colyseus builds rooms itself, so the
 * services ride on the class.
 */
export function worldRoom({ log, world, profiles, progress, now, seed = cryptoSeed }: WorldServices) {
  const { map, stepMs } = world;
  const spawn = spawnOf(world);

  return class WorldRoom extends Room {
    override maxClients = MAX_PLAYERS;
    override maxMessagesPerSecond = 30;
    override state = new WorldState();
    private readonly seats = new Map<string, Seat>();
    private stopListening: () => void = () => {};
    private readonly walkLimit = createRateLimiter({ limit: WALK_TO_PER_SECOND, windowMs: 1_000, maxKeys: MAX_PLAYERS * 2 });
    private readonly requestLimit = createRateLimiter({ limit: REQUESTS_PER_SECOND, windowMs: 1_000, maxKeys: MAX_PLAYERS * 2 });
    /** Decides who meets a wild creature in the grass. Each battle has its own RNGs. */
    private readonly encounterRng = createRng(seed());

    override messages = {
      [CLIENT_MESSAGES.ping]: validate(z.strictObject({ sentAt: z.number().finite() }), (client: Client, { sentAt }) => {
        client.send(SERVER_MESSAGES.pong, { sentAt });
      }),
      [CLIENT_MESSAGES.walkTo]: validate(WalkToMessage, (client: Client, { x, y, from }) => this.walkTo(client, { x, y }, from)),
      [CLIENT_MESSAGES.walkHold]: validate(WalkHoldMessage, (client: Client, { direction, from }) => this.command(client, { kind: 'hold', direction }, from)),
      [CLIENT_MESSAGES.walkStop]: validate(WalkStopMessage, (client: Client, { from }) => this.command(client, { kind: 'stop' }, from)),
      [CLIENT_MESSAGES.battleMove]: validate(BattleMoveMessage, (client: Client, { slot }) => this.battleRequest(client, CLIENT_MESSAGES.battleMove, { kind: 'move', slot })),
      [CLIENT_MESSAGES.battleSwitch]: validate(BattleSwitchMessage, (client: Client, { index }) => this.battleRequest(client, CLIENT_MESSAGES.battleSwitch, { kind: 'switch', index })),
      [CLIENT_MESSAGES.battleTreat]: validate(BattleTreatMessage, (client: Client, { itemId }) => this.battleRequest(client, CLIENT_MESSAGES.battleTreat, { kind: 'treat', itemId })),
      [CLIENT_MESSAGES.battleRun]: validate(BattleRunMessage, (client: Client) => this.battleRequest(client, CLIENT_MESSAGES.battleRun, { kind: 'run' })),
      [CLIENT_MESSAGES.starterChoose]: validate(StarterChooseMessage, (client: Client, { species }) =>
        this.progressRequest(client, CLIENT_MESSAGES.starterChoose, (seat) => chooseStarter(seat.progress, species, world.starters, world.battle) ?? (needsStarter(seat.progress) ? 'invalid' : 'notNow')),
      ),
      [CLIENT_MESSAGES.teamReorder]: validate(TeamReorderMessage, (client: Client, { order }) =>
        this.progressRequest(client, CLIENT_MESSAGES.teamReorder, (seat) => reorderTeam(seat.progress, order) ?? 'invalid'),
      ),
      [CLIENT_MESSAGES.storageSwap]: validate(StorageSwapMessage, (client: Client, { team, storage }) => this.storageSwap(client, team, storage)),
    };

    static override async onAuth(token: string, options: unknown): Promise<SeatAuth> {
      return authorizeJoin(profiles, token, options);
    }

    override onCreate() {
      this.state.map = map.id;
      this.state.stepMs = stepMs;
      this.setFixedTimestep((context) => this.tick(Math.round(context.dtMs)), TICK_RATE);
      this.clock.setInterval(() => this.checkSeats(), SAVE_EVERY_MS);
      this.clock.setInterval(() => this.checkBattles(), BATTLE_CHECK_MS);
      this.stopListening = profiles.onSignedOut((playerId) => this.signOut(playerId));
      log.info('room created', { room: this.roomName, roomId: this.roomId });
    }

    override onJoin(client: Client) {
      const auth = client.auth as SeatAuth;
      const profile = profiles.get(auth.playerId);
      if (!profile) throw new ServerError(ErrorCode.AUTH_FAILED, 'this profile no longer exists');
      const earlier = this.activeSeatOf(auth.playerId);
      // The battle does not move to the new device: it ends as a run first, so the team keeps its health.
      if (earlier) this.endBattle(earlier.sessionId, earlier.seat, 'replaced');
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
        battle: null,
        restedAt: null,
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
      client.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
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
      // Messages sent while the connection was down are lost, so the client gets the truth again.
      if (seat) {
        client.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
        if (seat.battle) client.send(SERVER_MESSAGES.battleView, { battle: battleView(seat.battle.id, seat.battle.state) } satisfies BattleViewMessage);
      }
      log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId, inBattle: Boolean(seat?.battle) });
    }

    override onLeave(client: Client, code: number) {
      const seat = this.seats.get(client.sessionId);
      if (seat && !seat.replaced) {
        this.endBattle(client.sessionId, seat, 'left');
        this.save(seat);
      }
      this.seats.delete(client.sessionId);
      this.state.players.delete(client.sessionId);
      this.state.playerCount = this.state.players.size;
      log.info('player left', { roomId: this.roomId, sessionId: client.sessionId, code, playerCount: this.state.playerCount });
    }

    override onDispose() {
      this.stopListening();
      for (const [sessionId, seat] of this.seats) {
        if (seat.replaced) continue;
        this.endBattle(sessionId, seat, 'shutdown');
        this.save(seat);
      }
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
    private arrival(from: Point = spawn, except?: Seat): Point {
      const taken = [...this.seats.values()].filter((seat) => !seat.replaced && seat !== except).map((seat) => seat.walker);
      return freeTileNear(map, from, taken);
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
      if (!seat || seat.battle || !inBounds(map, target) || !this.walkLimit.take(client.sessionId, now())) return;
      if (!this.command(client, { kind: 'to', target }, from)) client.send(SERVER_MESSAGES.walkRefused, { x: target.x, y: target.y });
    }

    /** `from` is only a hint: planCommand never lets it move the walker anywhere its own intent or the map would not. */
    private command(client: Client, command: WalkCommand, from: Point | undefined): boolean {
      const seat = this.seats.get(client.sessionId);
      if (!seat || seat.battle) return false;
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
        const arrived = arrivedAt(before, after);
        if (arrived && !seat.replaced && !seat.closing) this.arrive(sessionId, seat, arrived, before.facing);
        if (seat.stopped && !seat.replaced && !seat.closing && at - seat.savedAt >= STOP_SAVE_GAP_MS) {
          seat.stopped = false;
          this.save(seat);
        }
        this.show(sessionId, seat.walker);
      }
    }

    /** A step ended on `tile`: rest at a shrine in reach, then maybe meet a wild creature in tall grass. */
    private arrive(sessionId: string, seat: Seat, tile: Point, facing: Direction) {
      const shrine = shrineAt(map, tile);
      if (shrine !== null && shrine !== seat.restedAt) this.rest(sessionId, seat, shrine);
      seat.restedAt = shrine;
      // Nobody is ambushed while away: a dropped player's last step can still end in the grass.
      if (seat.battle || seat.reconnection || !canBattle(seat.progress)) return;
      const zoneId = encounterZoneAt(map, tile);
      const zone = zoneId === null ? undefined : world.encounters.get(zoneId);
      const wild = zone ? rollEncounter(zone, this.encounterRng) : null;
      if (zone && wild) this.startBattle(sessionId, seat, { tile, facing, zone, wild });
    }

    private rest(sessionId: string, seat: Seat, shrine: string) {
      seat.progress = { ...healTeam(seat.progress, world.battle), lastShrine: { map: map.id, shrine } };
      this.changed(seat);
      const client = this.clients.get(sessionId);
      client?.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      client?.send(SERVER_MESSAGES.storage, { shrine, storage: seat.progress.storage } satisfies StorageMessage);
      log.info('player rested', { roomId: this.roomId, playerId: seat.playerId, shrine });
    }

    private startBattle(sessionId: string, seat: Seat, { tile, facing, zone, wild }: { tile: Point; facing: Direction; zone: EncounterZone; wild: WildEncounter }) {
      const client = this.clients.get(sessionId);
      if (!client) return;
      const battleSeed = seed();
      let begun: ReturnType<typeof beginBattle>;
      try {
        begun = beginBattle({ id: randomUUID(), seed: battleSeed, zone, wild, team: seat.progress.team, content: world.battle, now: now() });
      } catch (error) {
        log.warn('could not start a battle', { roomId: this.roomId, playerId: seat.playerId, zone: zone.id, error: error instanceof Error ? error.message : String(error) });
        return;
      }
      // The step onto the grass has ended, and the walker may already have started the next one: it stays here.
      seat.walker = createWalker(tile, facing);
      seat.battle = begun.battle;
      seat.progress = markSeen(seat.progress, wild.species);
      seat.dirty = true;
      const player = this.state.players.get(sessionId);
      if (player) player.inBattle = true;
      client.send(SERVER_MESSAGES.battleStarted, { battle: battleView(begun.battle.id, begun.battle.state), events: begun.events } satisfies BattleUpdate);
      client.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      log.info('battle started', { roomId: this.roomId, playerId: seat.playerId, battle: begun.battle.id, zone: zone.id, species: wild.species, level: wild.level, seed: battleSeed });
    }

    /** The seat of a client whose request is within its rate limit; extra requests are dropped without an answer, like extra walk.to. */
    private requestingSeat(client: Client): Seat | undefined {
      const seat = this.seats.get(client.sessionId);
      if (!seat || seat.replaced || seat.closing || !this.requestLimit.take(client.sessionId, now())) return undefined;
      return seat;
    }

    private refuse(client: Client, request: string, reason: RefusalReason) {
      client.send(SERVER_MESSAGES.refused, { request, reason } satisfies Refused);
    }

    private battleRequest(client: Client, request: string, wanted: BattleRequest) {
      const seat = this.requestingSeat(client);
      if (!seat) return;
      const { battle } = seat;
      if (!battle) {
        this.refuse(client, request, 'notInBattle');
        return;
      }
      battle.lastInputAt = now();
      const planned = planRequest(wanted, battle.state, seat.progress, world.battle);
      if (!planned.ok) {
        this.refuse(client, request, planned.reason);
        return;
      }
      const usedItem = planned.progress !== seat.progress;
      seat.progress = planned.progress;
      const events = playStep(battle, planned.action, world.battle);
      this.sendTurn(client.sessionId, battle, events);
      if (battle.state.phase === 'over') {
        this.finishBattle(client.sessionId, seat, battle);
      } else if (usedItem) {
        this.changed(seat);
        client.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      }
    }

    private sendTurn(sessionId: string, battle: LiveBattle, events: readonly BattleEvent[]) {
      this.clients.get(sessionId)?.send(SERVER_MESSAGES.battleTurn, { battle: battleView(battle.id, battle.state), events } satisfies BattleUpdate);
    }

    /** Ends a seat's battle, if it has one, as a run: its player timed out, left, was replaced, or the room is closing. */
    private endBattle(sessionId: string, seat: Seat, why: 'idle' | 'left' | 'replaced' | 'shutdown') {
      const { battle } = seat;
      if (!battle) return;
      log.info('battle abandoned', { roomId: this.roomId, playerId: seat.playerId, battle: battle.id, why });
      this.sendTurn(sessionId, battle, abandonBattle(battle));
      this.finishBattle(sessionId, seat, battle);
    }

    /** Applies a finished battle to the player's creatures and tells them how it went. */
    private finishBattle(sessionId: string, seat: Seat, battle: LiveBattle) {
      const settled = settleBattle(seat.progress, battle, world.battle);
      const progressAfter = settled.fainted ? wakeAfterFainting(settled.progress, world.shrines.teamFainted, world.battle) : settled.progress;
      seat.progress = progressAfter;
      seat.battle = null;
      const woke = settled.fainted ? this.wake(seat) : null;
      const player = this.state.players.get(sessionId);
      if (player) player.inBattle = false;
      this.changed(seat);
      const outcome = battle.state.outcome ?? { winner: null, reason: 'ran' };
      const client = this.clients.get(sessionId);
      if (client && settled.befriended) client.send(SERVER_MESSAGES.battleBefriend, { battle: battle.id, ...settled.befriended } satisfies BefriendResult);
      client?.send(SERVER_MESSAGES.battleResult, { battle: battle.id, outcome, rewards: settled.rewards, woke } satisfies BattleResult);
      client?.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      log.info('battle ended', {
        roomId: this.roomId,
        playerId: seat.playerId,
        battle: battle.id,
        reason: outcome.reason,
        winner: outcome.winner,
        turns: battle.state.turn,
        rewards: settled.rewards.length,
        befriended: settled.befriended?.placedIn ?? null,
        woke: woke !== null,
      });
    }

    /** After the whole team fainted: back at the last shrine on this map, or the spawn, on a free tile near it. */
    private wake(seat: Seat): WakePoint {
      const last = seat.progress.lastShrine;
      const shrine = last && last.map === map.id && Object.hasOwn(map.shrines, last.shrine) ? last.shrine : null;
      seat.walker = createWalker(this.arrival(wakePoint(map, last), seat));
      seat.restedAt = shrineAt(map, seat.walker);
      return { map: map.id, shrine };
    }

    /** Applies a team, starter or storage change the player asked for, or refuses it. Returns whether it was done. */
    private progressRequest(client: Client, request: string, change: (seat: Seat) => Progress | RefusalReason): boolean {
      const seat = this.requestingSeat(client);
      if (!seat) return false;
      const next = seat.battle ? 'inBattle' : change(seat);
      if (typeof next === 'string') {
        this.refuse(client, request, next);
        return false;
      }
      seat.progress = next;
      this.changed(seat);
      client.send(SERVER_MESSAGES.progress, progressMessage(next));
      return true;
    }

    private storageSwap(client: Client, team: number | null, storage: number | null) {
      const seat = this.seats.get(client.sessionId);
      const shrine = seat ? shrineAt(map, seat.walker) : null;
      const done = this.progressRequest(client, CLIENT_MESSAGES.storageSwap, (current) =>
        shrine === null ? 'notAtShrine' : (swapStorage(current.progress, team, storage) ?? storageRefusal(current.progress, team, storage)),
      );
      if (done && seat && shrine !== null) client.send(SERVER_MESSAGES.storage, { shrine, storage: seat.progress.storage } satisfies StorageMessage);
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

    /** Runs every BATTLE_CHECK_MS: a battle whose player has sent nothing for BATTLE_IDLE_MS ends as a run. */
    checkBattles() {
      const at = now();
      for (const [sessionId, seat] of this.seats) {
        if (seat.battle && !seat.replaced && at - seat.battle.lastInputAt >= BATTLE_IDLE_MS) this.endBattle(sessionId, seat, 'idle');
      }
    }

    /** The creatures or treats changed: saved at once, so a crash never loses a battle's outcome. */
    private changed(seat: Seat) {
      seat.dirty = true;
      if (!seat.replaced) this.save(seat);
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
