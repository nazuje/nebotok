import { randomInt, randomUUID } from 'node:crypto';
import { Deferred, ErrorCode, OnMessageException, Room, ServerError, validate, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import {
  BattleMoveMessage,
  BattleRunMessage,
  BattleSwitchMessage,
  BattleTreatMessage,
  BoardOpenMessage,
  CLIENT_MESSAGES,
  CLOSE_CODES,
  CookStartMessage,
  GatherStartMessage,
  IDLE,
  LanguageSchema,
  MAX_PROFILES,
  MoveChooseMessage,
  PLAYER_SPAWN,
  SERVER_MESSAGES,
  SkillCancelMessage,
  SkillFinishMessage,
  StarterChooseMessage,
  StorageSwapMessage,
  TalkEndMessage,
  TalkNextMessage,
  TalkStartMessage,
  TeamReorderMessage,
  WalkHoldMessage,
  WalkStopMessage,
  WalkToMessage,
  answerMove,
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
  marksAt,
  planCommand,
  progressMessage,
  progressOf,
  questEvent,
  reorderTeam,
  rollEncounter,
  shrineAt,
  stepWalker,
  swapStorage,
  talkNodeMessage,
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
  type MoveOffer,
  type PendingMove,
  type Point,
  type Progress,
  type QuestChanged,
  type RefusalReason,
  type Refused,
  type Rng,
  type SaveFile,
  type StorageMessage,
  type StoryMessage,
  type TalkEnded,
  type TalkStep,
  type WakePoint,
  type WalkCommand,
  type Walker,
  type WildEncounter,
  type WorldInfo,
} from '@nebotok/core';
import { z } from 'zod';
import { BATTLE_IDLE_MS, abandonBattle, beginBattle, commitStep, nextStep, planRequest, settleBattle, storageRefusal, type BattleRequest, type LiveBattle } from './battles.ts';
import type { Log } from './log.ts';
import { sessionKey, type ProfileStore } from './profiles.ts';
import type { ProgressStore } from './progress.ts';
import { boardOpen, jobsJoined } from './jobs.ts';
import { createRateLimiter } from './rate-limit.ts';
import { cookStart, endAttempt, gatherStart, newSkillSeat, skillCancel, skillFinish, skillsJoined, tickSkills, type AttemptEnd, type SkillRoom, type SkillSeat } from './skills.ts';
import {
  NO_EXTRAS,
  TALK_IDLE_MS,
  battleEvents,
  continueTalk,
  countEvents,
  deliveredJobs,
  openTalk,
  starterRefusal,
  storyChange,
  talkStartRefusal,
  type LiveTalk,
  type Outgoing,
  type StoryExtras,
  type StoryResult,
} from './talk.ts';
import type { WorldContent } from './world.ts';
import { Player, WorldState } from './world-state.ts';

const WORLD: WorldInfo = { name: 'sky' };
/** A dropped player stays in the world, standing still, this long before their seat is given up. */
export const RECONNECT_SECONDS = 180;
export const TICK_RATE = 20;
export const SAVE_EVERY_MS = 30_000;
/** A walker that comes to a stop is saved too, but one seat at most this often, so a crash loses little. */
export const STOP_SAVE_GAP_MS = 5_000;
/**
 * The server has one world room, and every profile must fit in it: a full room would make
 * matchmaking open a second one. Twice the profiles leaves each one room for a second device
 * taking its seat over.
 */
export const MAX_PLAYERS = MAX_PROFILES * 2;
/** Each walk.to runs a path search; more than this a second from one client are dropped. */
export const WALK_TO_PER_SECOND = 5;
/** Battle, team, storage, starter, move, talk, skill and board requests a second from one client; more are dropped. A battle needs one a turn. */
export const REQUESTS_PER_SECOND = 5;
/** How often battles and talks left without input, and offered moves left unanswered, are looked for. */
export const BATTLE_CHECK_MS = 5_000;
/** An offered move with no answer for this long is skipped, as an idle battle ends, connected or not. */
export const OFFER_IDLE_MS = BATTLE_IDLE_MS;

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
  /**
   * Moves levelling up offered, waiting for the one before to be answered, in order. Like a battle
   * they live only in memory: when the seat ends they are dropped, and the creature does not learn them.
   */
  offers: PendingMove[];
  /** The offer sent with `move.offer` and not answered yet. While it waits the team keeps its order and no wild creature appears. */
  offer: OutstandingOffer | null;
  /** The player's talk with a character, or null. While it lasts the player stands still and meets no wild creature. */
  talk: LiveTalk | null;
  /** The shrine the player is resting at, so walking about next to it heals only once. */
  restedAt: string | null;
  /** The player's gather or cook under way and their resting spots, kept by `skills.ts`. */
  skills: SkillSeat;
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

type OutstandingOffer = PendingMove & { readonly id: number; readonly sentAt: number };

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
  const { map, stepMs, story } = world;
  const spawn = spawnOf(world);

  return class WorldRoom extends Room {
    /** The one world room of this server while it is open. */
    private static open: WorldRoom | null = null;
    /** Which room and session holds each profile's seat, across rooms: a profile holds one seat at most. */
    private static readonly seated = new Map<number, { readonly room: WorldRoom; readonly sessionId: string }>();

    override maxClients = MAX_PLAYERS;
    // The world stays open while nobody plays, so a join never races the room closing down and
    // finds it locked, which would open a second one.
    override autoDispose = false;
    override maxMessagesPerSecond = 30;
    override state = new WorldState();
    private readonly seats = new Map<string, Seat>();
    private stopListening: () => void = () => {};
    private readonly walkLimit = createRateLimiter({ limit: WALK_TO_PER_SECOND, windowMs: 1_000, maxKeys: MAX_PLAYERS * 2 });
    private readonly requestLimit = createRateLimiter({ limit: REQUESTS_PER_SECOND, windowMs: 1_000, maxKeys: MAX_PLAYERS * 2 });
    /** Decides who meets a wild creature in the grass. Each battle has its own RNGs. */
    private readonly encounterRng = createRng(seed());
    /** The id of the last move offer, counted across the room so an old answer never matches a new offer. */
    private offerCount = 0;
    /** The id of the last talk, counted across the room like offers. */
    private talkCount = 0;
    /** The id of the last gather or cook, counted across the room like offers. */
    private attemptCount = 0;
    /** Plans gathers and cooks. Made on first use, so rooms that never see one draw no seed for it. */
    private attemptRng: Rng | null = null;

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
      [CLIENT_MESSAGES.starterChoose]: validate(StarterChooseMessage, (client: Client, { species }) => this.chooseStarter(client, species)),
      [CLIENT_MESSAGES.teamReorder]: validate(TeamReorderMessage, (client: Client, { order }) =>
        this.progressRequest(client, CLIENT_MESSAGES.teamReorder, (seat) => reorderTeam(seat.progress, order) ?? 'invalid'),
      ),
      [CLIENT_MESSAGES.storageSwap]: validate(StorageSwapMessage, (client: Client, { team, storage }) => this.storageSwap(client, team, storage)),
      [CLIENT_MESSAGES.moveChoose]: validate(MoveChooseMessage, (client: Client, { offer, forget }) => this.chooseMove(client, offer, forget)),
      [CLIENT_MESSAGES.talkStart]: validate(TalkStartMessage, (client: Client, { npc }) => this.talkStart(client, npc)),
      [CLIENT_MESSAGES.talkNext]: validate(TalkNextMessage, (client: Client, { conversation, choice }) => this.talkNext(client, conversation, choice)),
      [CLIENT_MESSAGES.talkEnd]: validate(TalkEndMessage, (client: Client, { conversation }) => this.talkEnd(client, conversation)),
      [CLIENT_MESSAGES.gatherStart]: validate(GatherStartMessage, (client: Client, { spot }) => this.skillRequest(client, (room) => gatherStart(room, spot))),
      [CLIENT_MESSAGES.cookStart]: validate(CookStartMessage, (client: Client, { recipe, station }) => this.skillRequest(client, (room) => cookStart(room, recipe, station))),
      [CLIENT_MESSAGES.skillFinish]: validate(SkillFinishMessage, (client: Client, { attempt, taps }) => this.skillRequest(client, (room) => skillFinish(room, attempt, taps))),
      [CLIENT_MESSAGES.skillCancel]: validate(SkillCancelMessage, (client: Client, { attempt }) => this.skillRequest(client, (room) => skillCancel(room, attempt))),
      [CLIENT_MESSAGES.boardOpen]: validate(BoardOpenMessage, (client: Client, { station }) => this.skillRequest(client, (room) => boardOpen(room, station))),
    };

    static override async onAuth(token: string, options: unknown): Promise<SeatAuth> {
      return authorizeJoin(profiles, token, options);
    }

    override onCreate() {
      if (WorldRoom.open) throw new Error('this server already has its world room');
      WorldRoom.open = this;
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
      const earlier = this.seatOf(auth.playerId);
      // The battle does not move to the new device: it ends as a run first, so the team keeps its health.
      // Nor does a talk: the new device starts it again.
      if (earlier) {
        earlier.room.endBattle(earlier.sessionId, earlier.seat, 'replaced');
        earlier.room.endTalk(earlier.sessionId, earlier.seat, 'replaced');
        earlier.room.endSkill(earlier.sessionId, earlier.seat, 'replaced');
      }
      // Taking over from another device continues from where that device's character stands.
      const start = earlier
        ? { walker: withIntent(earlier.seat.walker, IDLE), canSave: earlier.seat.canSave, language: earlier.seat.language, progress: earlier.seat.progress }
        : this.load(auth.playerId);
      if (earlier) earlier.room.replace(earlier.sessionId, earlier.seat);

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
        offers: [],
        offer: null,
        talk: null,
        restedAt: null,
        skills: newSkillSeat(),
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
      WorldRoom.seated.set(seat.playerId, { room: this, sessionId: client.sessionId });
      this.state.players.set(client.sessionId, player);
      this.show(client.sessionId, seat.walker);
      this.state.playerCount = this.state.players.size;
      client.send(SERVER_MESSAGES.welcome, welcome(WORLD, this.state.playerCount));
      client.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      client.send(SERVER_MESSAGES.story, seat.progress.story satisfies StoryMessage);
      this.sendSkills(client.sessionId, seat);
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
        client.send(SERVER_MESSAGES.story, seat.progress.story satisfies StoryMessage);
        this.sendSkills(client.sessionId, seat);
        if (seat.battle) client.send(SERVER_MESSAGES.battleView, { battle: battleView(seat.battle.id, seat.battle.state) } satisfies BattleViewMessage);
        const offer = seat.offer && this.offerMessage(seat, seat.offer);
        if (offer) client.send(SERVER_MESSAGES.moveOffer, offer);
        this.sendTalkNode(client.sessionId, seat);
      }
      log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId, inBattle: Boolean(seat?.battle), talking: Boolean(seat?.talk) });
    }

    override onLeave(client: Client, code: number) {
      const seat = this.seats.get(client.sessionId);
      if (seat && !seat.replaced) {
        this.endBattle(client.sessionId, seat, 'left');
        this.endTalk(client.sessionId, seat, 'left');
        this.endSkill(client.sessionId, seat, 'left');
        this.save(seat);
      }
      this.seats.delete(client.sessionId);
      const held = seat && WorldRoom.seated.get(seat.playerId);
      if (seat && held?.room === this && held.sessionId === client.sessionId) WorldRoom.seated.delete(seat.playerId);
      this.state.players.delete(client.sessionId);
      this.state.playerCount = this.state.players.size;
      log.info('player left', { roomId: this.roomId, sessionId: client.sessionId, code, playerCount: this.state.playerCount });
    }

    override onDispose() {
      this.stopListening();
      if (WorldRoom.open === this) WorldRoom.open = null;
      for (const [playerId, held] of WorldRoom.seated) if (held.room === this) WorldRoom.seated.delete(playerId);
      this.forEachSeat('onDispose', (sessionId, seat) => {
        if (seat.replaced) return;
        this.endBattle(sessionId, seat, 'shutdown');
        this.endTalk(sessionId, seat, 'shutdown');
        this.endSkill(sessionId, seat, 'shutdown');
        this.save(seat);
      });
      log.info('room disposed', { roomId: this.roomId });
    }

    /**
     * Colyseus calls this for an error that escapes a message handler, a tick, a clock timer or a
     * lifecycle hook; without it an error in a tick or timer stops the whole server. The room goes
     * on. A failed message also ends its sender's battle, which may be left half played. Errors in
     * one seat's part of a tick or check are caught closer, by forEachSeat, which ends that seat.
     */
    override onUncaughtException(error: RoomException, method: RoomMethodName) {
      const sessionId = error instanceof OnMessageException ? error.client.sessionId : undefined;
      log.error('room error', { roomId: this.roomId, method, sessionId, ...errorOf(error.cause ?? error) });
      const seat = sessionId === undefined ? undefined : this.seats.get(sessionId);
      if (sessionId !== undefined && seat?.battle) this.dropBattle(sessionId, seat);
    }

    /** Runs one seat's share of a tick or a check. When it throws, that seat ends, or with `battleOnly` just its battle, and the other seats go on. */
    private forEachSeat(task: string, visit: (sessionId: string, seat: Seat) => void, battleOnly = false) {
      for (const [sessionId, seat] of this.seats) {
        try {
          visit(sessionId, seat);
        } catch (error) {
          this.seatFailed(task, sessionId, seat, error, battleOnly);
        }
      }
    }

    private seatFailed(task: string, sessionId: string, seat: Seat, error: unknown, battleOnly: boolean) {
      if (seat.closing) return;
      log.error('seat error', { roomId: this.roomId, sessionId, playerId: seat.playerId, task, ...errorOf(error) });
      if (battleOnly && seat.battle) {
        this.dropBattle(sessionId, seat);
        return;
      }
      // Its battle is left unsettled: the team keeps the health it had before it. The seat is saved
      // as it leaves, and its client joins again.
      seat.battle = null;
      this.close(sessionId, seat, CLOSE_CODES.failed);
    }

    /** Ends a battle that hit an error as a run. When even that fails it is dropped unsettled, and the team keeps the health it had before it. */
    private dropBattle(sessionId: string, seat: Seat) {
      const { battle } = seat;
      if (!battle) return;
      try {
        this.endBattle(sessionId, seat, 'failed');
        return;
      } catch (error) {
        log.error('battle dropped', { roomId: this.roomId, playerId: seat.playerId, battle: battle.id, ...errorOf(error) });
      }
      if (seat.battle !== battle) return;
      seat.battle = null;
      const player = this.state.players.get(sessionId);
      if (player) player.inBattle = false;
      const client = this.clients.get(sessionId);
      client?.send(SERVER_MESSAGES.battleResult, { battle: battle.id, outcome: { winner: null, reason: 'ran' }, rewards: [], learned: [], woke: null } satisfies BattleResult);
      client?.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
    }

    /** The seat a profile holds, in this room or another of this server, unless it was taken over. */
    private seatOf(playerId: number): { room: WorldRoom; sessionId: string; seat: Seat } | undefined {
      const held = WorldRoom.seated.get(playerId);
      const seat = held?.room.seats.get(held.sessionId);
      return held && seat && !seat.replaced ? { room: held.room, sessionId: held.sessionId, seat } : undefined;
    }

    /** The saved position when it is still a walkable tile of this map, else the free tile nearest the spawn. */
    private load(playerId: number): { walker: Walker; canSave: boolean; language: Language; progress: Progress } {
      let save: SaveFile | null = null;
      try {
        save = progress.load(playerId);
      } catch (error) {
        // Only the name: a parse error's message can quote the save.
        log.warn('save unreadable; this player will not be saved', { playerId, error: error instanceof Error ? error.name : typeof error });
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
      const found = this.seatOf(playerId);
      if (found?.room === this && !profiles.isSessionLive(found.seat.session)) this.close(found.sessionId, found.seat, CLOSE_CODES.signedOut);
    }

    /** Ends a seat from the server side, whether its client is connected or waiting to reconnect. */
    private close(sessionId: string, seat: Seat, code: number) {
      seat.closing = true;
      if (seat.reconnection) seat.reconnection.reject(new Error(`seat closed with ${code}`));
      else this.clients.get(sessionId)?.leave(code);
    }

    private walkTo(client: Client, target: Point, from: Point | undefined) {
      const seat = this.seats.get(client.sessionId);
      if (!seat || seat.battle || seat.talk || !inBounds(map, target) || !this.walkLimit.take(client.sessionId, now())) return;
      if (!this.command(client, { kind: 'to', target }, from)) client.send(SERVER_MESSAGES.walkRefused, { x: target.x, y: target.y });
    }

    /** `from` is only a hint: planCommand never lets it move the walker anywhere its own intent or the map would not. Ignored in a battle or a talk. */
    private command(client: Client, command: WalkCommand, from: Point | undefined): boolean {
      const seat = this.seats.get(client.sessionId);
      if (!seat || seat.battle || seat.talk) return false;
      const intent = planCommand(map, seat.walker, command, from);
      if (!intent) return false;
      this.endSkill(client.sessionId, seat, 'walk');
      seat.walker = withIntent(seat.walker, intent);
      return true;
    }

    private tick(dtMs: number) {
      const at = now();
      this.forEachSeat('tick', (sessionId, seat) => {
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
        if (!seat.replaced && !seat.closing) tickSkills(this.skillRoom(sessionId, seat));
        this.show(sessionId, seat.walker);
      });
    }

    /** A step ended on `tile`: rest at a shrine in reach, reach the marks in reach, then maybe meet a wild creature in tall grass. */
    private arrive(sessionId: string, seat: Seat, tile: Point, facing: Direction) {
      const shrine = shrineAt(map, tile);
      if (shrine !== null && shrine !== seat.restedAt) this.rest(sessionId, seat, shrine);
      seat.restedAt = shrine;
      for (const mark of marksAt(map, tile)) this.applyStory(sessionId, seat, questEvent(seat.progress, { kind: 'reached', mark }, story));
      // Nobody is ambushed while away: a dropped player's last step can still end in the grass. A
      // talk stops the walk, but the step under way still ends.
      if (seat.battle || seat.offer || seat.talk || seat.reconnection || !canBattle(seat.progress)) return;
      const zoneId = encounterZoneAt(map, tile);
      const zone = zoneId === null ? undefined : world.encounters.get(zoneId);
      const wild = zone ? rollEncounter(zone, this.encounterRng) : null;
      if (zone && wild) this.startBattle(sessionId, seat, { tile, facing, zone, wild });
    }

    private rest(sessionId: string, seat: Seat, shrine: string) {
      seat.progress = { ...healTeam(seat.progress, world.battle), lastShrine: { map: map.id, shrine } };
      this.changed(seat);
      const client = this.clients.get(sessionId);
      if (!this.applyStory(sessionId, seat, questEvent(seat.progress, { kind: 'rested', shrine }, story))) client?.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      client?.send(SERVER_MESSAGES.storage, { shrine, storage: seat.progress.storage } satisfies StorageMessage);
      log.info('player rested', { roomId: this.roomId, playerId: seat.playerId, shrine });
    }

    private startBattle(sessionId: string, seat: Seat, { tile, facing, zone, wild }: { tile: Point; facing: Direction; zone: EncounterZone; wild: WildEncounter }) {
      const client = this.clients.get(sessionId);
      if (!client) return;
      this.endTalk(sessionId, seat, 'battle');
      this.endSkill(sessionId, seat, 'battle');
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
      // Saved at once with the team as it was before the battle, so a server that stops before the
      // battle ends brings the player back here, in the world, rather than wherever they last stood.
      this.changed(seat);
      const player = this.state.players.get(sessionId);
      if (player) player.inBattle = true;
      client.send(SERVER_MESSAGES.battleStarted, { battle: battleView(begun.battle.id, begun.battle.state), events: begun.events } satisfies BattleUpdate);
      client.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      log.info('battle started', { roomId: this.roomId, playerId: seat.playerId, battle: begun.battle.id, zone: zone.id, species: wild.species, level: wild.level });
      log.debug('battle seed', { roomId: this.roomId, battle: begun.battle.id, seed: battleSeed });
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
      // The step is played on copies first, so one that throws changes neither the battle nor the treats.
      const step = nextStep(battle, planned.action, world.battle);
      const usedItem = planned.progress !== seat.progress;
      commitStep(battle, step);
      seat.progress = planned.progress;
      this.sendTurn(client.sessionId, battle, step.events);
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
    private endBattle(sessionId: string, seat: Seat, why: 'idle' | 'left' | 'replaced' | 'shutdown' | 'failed') {
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
      seat.offers = [...settled.offers];
      const woke = settled.fainted ? this.wake(seat) : null;
      const player = this.state.players.get(sessionId);
      if (player) player.inBattle = false;
      this.changed(seat);
      const outcome = battle.state.outcome ?? { winner: null, reason: 'ran' };
      const client = this.clients.get(sessionId);
      if (client && settled.befriended) client.send(SERVER_MESSAGES.battleBefriend, { battle: battle.id, ...settled.befriended } satisfies BefriendResult);
      client?.send(SERVER_MESSAGES.battleResult, { battle: battle.id, outcome, rewards: settled.rewards, learned: settled.learned, woke } satisfies BattleResult);
      const counted = countEvents(seat.progress, battleEvents(battle.state.outcome, battle.zone, settled.befriended?.species ?? null), story);
      if (!this.applyStory(sessionId, seat, counted)) this.offerNext(sessionId, seat);
      log.info('battle ended', {
        roomId: this.roomId,
        playerId: seat.playerId,
        battle: battle.id,
        reason: outcome.reason,
        winner: outcome.winner,
        turns: battle.state.turn,
        rewards: settled.rewards.length,
        learned: settled.learned.length,
        offers: settled.offers.length,
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

    /** What `move.offer` says about `offer`, or null when its creature is no longer there. */
    private offerMessage(seat: Seat, offer: OutstandingOffer): MoveOffer | null {
      const creature = seat.progress.team[offer.index];
      return creature ? { offer: offer.id, index: offer.index, species: creature.species, move: offer.move, moves: creature.moves } : null;
    }

    /** Sends the next waiting move offer, if there is one, and then `progress`. */
    private offerNext(sessionId: string, seat: Seat) {
      const client = this.clients.get(sessionId);
      let pending = seat.offers.shift();
      while (pending && !seat.progress.team[pending.index]) pending = seat.offers.shift();
      if (pending) {
        this.offerCount += 1;
        seat.offer = { ...pending, id: this.offerCount, sentAt: now() };
        const offer = this.offerMessage(seat, seat.offer);
        if (offer) client?.send(SERVER_MESSAGES.moveOffer, offer);
        log.info('move offered', { roomId: this.roomId, playerId: seat.playerId, offer: seat.offer.id, index: pending.index, move: pending.move });
      }
      client?.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
    }

    /** The player's answer to the outstanding move offer: forget the move in slot `forget` for it, or skip it with null. */
    private chooseMove(client: Client, offer: number, forget: number | null) {
      const seat = this.requestingSeat(client);
      if (!seat) return;
      const current = seat.offer;
      if (!current) {
        this.refuse(client, CLIENT_MESSAGES.moveChoose, 'notNow');
        return;
      }
      const next = current.id === offer ? answerMove(seat.progress, current, forget) : null;
      if (!next) {
        this.refuse(client, CLIENT_MESSAGES.moveChoose, 'invalid');
        return;
      }
      this.settleOffer(client.sessionId, seat, next, forget === null ? 'skipped' : 'learned');
    }

    /** Closes the outstanding offer with the progress after it, saves at once, and sends the next offer and `progress`. */
    private settleOffer(sessionId: string, seat: Seat, next: Progress, how: 'learned' | 'skipped' | 'timedOut') {
      const { offer } = seat;
      if (!offer) return;
      seat.offer = null;
      seat.progress = next;
      this.changed(seat);
      log.info('move offer settled', { roomId: this.roomId, playerId: seat.playerId, offer: offer.id, index: offer.index, move: offer.move, how });
      this.offerNext(sessionId, seat);
    }

    /** Applies a team, starter or storage change the player asked for, or refuses it. Returns whether it was done. */
    private progressRequest(client: Client, request: string, change: (seat: Seat) => Progress | RefusalReason): boolean {
      const seat = this.requestingSeat(client);
      if (!seat) return false;
      // Team places name the creature an offer is for, so they stay put until it is answered.
      const next = seat.battle ? 'inBattle' : seat.offer ? 'notNow' : change(seat);
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

    /** A starter for a player with no creature; then any talk ends, since what the dialogue checks has changed. */
    private chooseStarter(client: Client, species: string) {
      const done = this.progressRequest(
        client,
        CLIENT_MESSAGES.starterChoose,
        (seat) => starterRefusal(seat.progress, seat.talk?.conversation ?? null, story) ?? chooseStarter(seat.progress, species, world.starters, world.battle) ?? 'invalid',
      );
      const seat = this.seats.get(client.sessionId);
      if (done && seat) this.endTalk(client.sessionId, seat, 'starter');
    }

    private talkStart(client: Client, npc: string) {
      const seat = this.requestingSeat(client);
      if (!seat) return;
      const refusal = talkStartRefusal(npc, seat.walker, { battle: seat.battle !== null, offer: seat.offer !== null, talking: seat.talk !== null }, map, story);
      if (refusal) {
        this.refuse(client, CLIENT_MESSAGES.talkStart, refusal);
        return;
      }
      const opened = openTalk(npc, seat.progress, story);
      if (opened.kind !== 'stays') {
        if (opened.kind === 'failed') log.warn('talk effect failed', { roomId: this.roomId, playerId: seat.playerId, npc, node: null });
        this.refuse(client, CLIENT_MESSAGES.talkStart, 'invalid');
        return;
      }
      // The step under way still ends, on the tile the player was checked from.
      seat.walker = withIntent(seat.walker, IDLE);
      this.talkCount += 1;
      seat.talk = { id: this.talkCount, conversation: opened.conversation, lastInputAt: now() };
      const player = this.state.players.get(client.sessionId);
      if (player) player.talking = true;
      log.info('talk started', { roomId: this.roomId, playerId: seat.playerId, conversation: seat.talk.id, npc, node: opened.conversation.node });
      this.applyStory(client.sessionId, seat, opened.step, this.deliveries(seat, opened.step));
      this.sendTalkNode(client.sessionId, seat);
    }

    private talkNext(client: Client, conversation: number, choice: number | null) {
      const seat = this.requestingSeat(client);
      if (!seat) return;
      const { talk } = seat;
      if (!talk || talk.id !== conversation) {
        this.refuse(client, CLIENT_MESSAGES.talkNext, talk ? 'invalid' : 'notTalking');
        return;
      }
      talk.lastInputAt = now();
      const next = continueTalk(talk.conversation, choice, seat.progress, story);
      if (next.kind === 'refused' || next.kind === 'failed') {
        this.refuse(client, CLIENT_MESSAGES.talkNext, 'invalid');
        if (next.kind === 'failed') {
          log.warn('talk effect failed', { roomId: this.roomId, playerId: seat.playerId, npc: talk.conversation.npc, node: talk.conversation.node, choice });
          this.endTalk(client.sessionId, seat, 'failed');
        }
        return;
      }
      this.applyStory(client.sessionId, seat, next.step, this.deliveries(seat, next.step));
      if (next.kind === 'ended') {
        this.endTalk(client.sessionId, seat, 'done');
        return;
      }
      talk.conversation = next.conversation;
      this.sendTalkNode(client.sessionId, seat);
    }

    private talkEnd(client: Client, conversation: number) {
      const seat = this.requestingSeat(client);
      if (!seat) return;
      if (!seat.talk || seat.talk.id !== conversation) this.refuse(client, CLIENT_MESSAGES.talkEnd, seat.talk ? 'invalid' : 'notTalking');
      else this.endTalk(client.sessionId, seat, 'player');
    }

    /** Sends the node the player's talk is at, if they are talking. */
    private sendTalkNode(sessionId: string, seat: Seat) {
      const { talk } = seat;
      if (!talk) return;
      const node = talkNodeMessage(talk.id, talk.conversation, seat.progress, story);
      if (node) this.clients.get(sessionId)?.send(SERVER_MESSAGES.talkNode, node);
      else this.endTalk(sessionId, seat, 'failed');
    }

    /** Ends a seat's talk, if it has one. Nothing is undone: each node's effects were saved as it was entered. */
    private endTalk(sessionId: string, seat: Seat, why: 'done' | 'player' | 'failed' | 'idle' | 'starter' | 'battle' | 'left' | 'replaced' | 'shutdown') {
      const { talk } = seat;
      if (!talk) return;
      seat.talk = null;
      const player = this.state.players.get(sessionId);
      if (player) player.talking = false;
      this.clients.get(sessionId)?.send(SERVER_MESSAGES.talkEnded, { conversation: talk.id } satisfies TalkEnded);
      log.info('talk ended', { roomId: this.roomId, playerId: seat.playerId, conversation: talk.id, npc: talk.conversation.npc, why });
    }

    /**
     * Applies what a talk step, a world event or a skill did to the story, saved at once, and sends it:
     * `extras.first`, `quest.changed` for each quest, then the next move offer that experience brought
     * and `progress`, then `extras.beforeStory`, `story` and `extras.last`. Returns false, sending
     * nothing, when nothing changed and there are no extras.
     */
    private applyStory(sessionId: string, seat: Seat, result: StoryResult, extras: StoryExtras = NO_EXTRAS): boolean {
      const unchanged = result.progress === seat.progress;
      if (unchanged && extras.first.length === 0 && extras.beforeStory.length === 0 && extras.last.length === 0) return false;
      const client = this.clients.get(sessionId);
      sendAll(client, extras.first);
      const change = storyChange(seat.progress, result, world.battle);
      seat.progress = change.progress;
      seat.offers.push(...change.offers);
      if (!unchanged) this.changed(seat);
      for (const quest of change.changes) {
        client?.send(SERVER_MESSAGES.questChanged, quest satisfies QuestChanged);
        log.info('quest changed', { roomId: this.roomId, playerId: seat.playerId, quest: quest.quest, change: quest.change, step: quest.step });
      }
      // An offer already waiting is answered first; the new ones follow it.
      if (seat.offer) client?.send(SERVER_MESSAGES.progress, progressMessage(seat.progress));
      else this.offerNext(sessionId, seat);
      sendAll(client, extras.beforeStory);
      if (change.storyChanged) client?.send(SERVER_MESSAGES.story, seat.progress.story satisfies StoryMessage);
      sendAll(client, extras.last);
      return true;
    }

    /** The messages a talk step's finished jobs send around its story change. */
    private deliveries(seat: Seat, step: TalkStep): StoryExtras {
      return deliveredJobs(step, seat.progress, { now: now(), rests: seat.skills.rests }, story);
    }

    /** What the skill and board rules may read and do for one seat: see `SkillRoom`. */
    private skillRoom(sessionId: string, seat: Seat): SkillRoom {
      return {
        playerId: seat.playerId,
        skills: seat.skills,
        get progress() {
          return seat.progress;
        },
        get walker() {
          return seat.walker;
        },
        get busy() {
          if (seat.battle) return 'inBattle';
          return seat.talk || seat.offer ? 'notNow' : null;
        },
        get now() {
          return now();
        },
        map,
        content: story,
        rng: () => (this.attemptRng ??= createRng(seed())),
        nextAttempt: () => (this.attemptCount += 1),
        log,
        send: (type, message) => this.clients.get(sessionId)?.send(type, message),
        refuse: (request, reason) => {
          const client = this.clients.get(sessionId);
          if (client) this.refuse(client, request, reason);
        },
        stand: (facing) => {
          seat.walker = { ...withIntent(seat.walker, IDLE), facing };
          seat.dirty = true;
        },
        showSkill: (skill) => {
          const player = this.state.players.get(sessionId);
          if (player) player.skill = skill;
        },
        apply: (result, extras) => this.applyStory(sessionId, seat, result, extras),
      };
    }

    /** A gather, cook or board request from a client within its rate limit. */
    private skillRequest(client: Client, request: (room: SkillRoom) => void) {
      const seat = this.requestingSeat(client);
      if (seat) request(this.skillRoom(client.sessionId, seat));
    }

    /** Ends a seat's gather or cook, if it has one, unjudged. */
    private endSkill(sessionId: string, seat: Seat, why: AttemptEnd) {
      endAttempt(this.skillRoom(sessionId, seat), why);
    }

    /** After `progress` and `story` on joining and each reconnection: `skills`, then `jobs`. */
    private sendSkills(sessionId: string, seat: Seat) {
      const room = this.skillRoom(sessionId, seat);
      skillsJoined(room);
      jobsJoined(room);
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
      this.forEachSeat('checkSeats', (sessionId, seat) => {
        if (seat.replaced || seat.closing) return;
        if (profiles.hasSession(seat.playerId)) this.save(seat);
        else this.close(sessionId, seat, CLOSE_CODES.signedOut);
      });
    }

    /**
     * Runs every BATTLE_CHECK_MS: a battle whose player has sent nothing for BATTLE_IDLE_MS ends as a
     * run, a move offer left unanswered for OFFER_IDLE_MS is skipped, and a talk with no request for
     * TALK_IDLE_MS ends.
     */
    checkBattles() {
      const at = now();
      this.forEachSeat(
        'checkBattles',
        (sessionId, seat) => {
          if (seat.replaced) return;
          if (seat.battle && at - seat.battle.lastInputAt >= BATTLE_IDLE_MS) this.endBattle(sessionId, seat, 'idle');
          if (seat.offer && at - seat.offer.sentAt >= OFFER_IDLE_MS) this.settleOffer(sessionId, seat, seat.progress, 'timedOut');
          if (seat.talk && at - seat.talk.lastInputAt >= TALK_IDLE_MS) this.endTalk(sessionId, seat, 'idle');
        },
        true,
      );
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

/** An error's name and message for the log: content ids at most, never a payload. */
function errorOf(error: unknown): { error: string; message: string } {
  return error instanceof Error ? { error: error.name, message: error.message } : { error: typeof error, message: '' };
}

/** Sends each message, in order, to a client that may have gone. */
function sendAll(client: Client | undefined, messages: readonly Outgoing[]) {
  for (const { type, message } of messages) client?.send(type, message);
}
