import { ErrorCode, Room, ServerError, type AuthContext, type Client, type RoomException, type RoomMethodName } from '@colyseus/core';
import {
  ARENA_IDLE,
  ARENA_MESSAGES,
  ARENA_NONE,
  arenaInputOf,
  cleanArenaInput,
  createBrain,
  createRng,
  fightContentOf,
  fightStart,
  fightStep,
  wildInput,
  type ArenaEventsMessage,
  type ArenaFight,
  type ArenaInput,
  type ArenaInputs,
  type ArenaLineupCreature,
  type ArenaStartedMessage,
  type Brain,
  type FightEvent,
  type Rng,
  type Side,
} from '@nebotok/core';
import { z } from 'zod';
import { ArenaInputSchema, ArenaRoomState, showFight } from './arena-state.ts';
import { BATTLE_IDLE_MS } from './battles.ts';
import type { FightBook, FightPlan, FightStop } from './fights.ts';
import type { Log } from './log.ts';
import type { ProfileStore } from './profiles.ts';
import type { WorldContent } from './world.ts';

/** 30 inputs a second, each running two of core's 60 Hz steps. */
export const ARENA_TICK_RATE = 30;
export const ARENA_SUB_STEPS = 2;
/** More messages than this a second from one client close its connection; inputs count. */
export const ARENA_MESSAGES_PER_SECOND = 45;
/** New presses beyond this many in a second (the last `ARENA_TICK_RATE` inputs) are dropped and counted. */
export const PRESSES_PER_SECOND = 10;
/** How long a dropped player's seat is held for the SDK to reconnect. */
export const ARENA_RECONNECT_SECONDS = 20;
/** A fight with people on both sides waits this long for one who is away, then ends with no result. */
export const DUEL_WAIT_MS = 30_000;
const INPUT_BUFFER = 16;
/** After its end the room stays this long, so the last state and events reach the players, then closes. */
const CLOSE_AFTER_MS = 2_000;

export type ArenaServices = {
  readonly log: Log;
  readonly world: WorldContent;
  readonly profiles: ProfileStore;
  readonly fights: FightBook;
  readonly now: () => number;
  /** Keeps every core step's inputs on the room (`recorded`), for the replay test. Off in play. */
  readonly record?: boolean;
};

const CreateOptions = z.object({ fightId: z.string().min(1).max(64) });
const SeatOptions = z.object({ ticket: z.string().min(1).max(64) });

/** What onAuth hands to onJoin as `client.auth`. */
type ArenaAuth = { readonly playerId: number };
type Fighter = { readonly playerId: number; readonly side: Side; connected: boolean };
type Mind = { readonly brain: Brain; readonly rng: Rng };

const pressed = (input: ArenaInput): boolean => input.press !== null || input.dash || input.treat === true || input.swap === true;
/** The input with every button let go and the stick kept. */
const released = (input: ArenaInput): ArenaInput => ({ ...ARENA_IDLE, dir: input.dir, leave: input.leave });
const lineup = (fight: ArenaFight, side: Side): ArenaLineupCreature[] => {
  if (fight.mode === 'rounds') return fight.picks[side].map(({ fighter, place }) => ({ id: fighter.id, species: fighter.species, level: fighter.level, place }));
  if (side === 0) return fight.team.map(({ fighter, place }) => ({ id: fighter.id, species: fighter.species, level: fighter.level, place }));
  const wild = fight.island.bodies[1];
  return [{ id: wild.id, species: wild.species, level: wild.level, place: null }];
};

/** Refused events the step before already sent, as `side:button:reason`: a held button is refused every tick, but told once. */
function freshRefusals(events: readonly FightEvent[], before: ReadonlySet<string>): { events: FightEvent[]; seen: Set<string> } {
  const seen = new Set<string>();
  const kept = events.filter((event) => {
    if (event.kind !== 'refused') return true;
    const key = `${event.side}:${event.button}:${event.reason}`;
    const fresh = !seen.has(key) && !before.has(key);
    seen.add(key);
    return fresh;
  });
  return { events: kept, seen };
}

/**
 * One arena fight (docs/protocol.md, "Arena fights"), planned by the world room in the fight book
 * and played here at a fixed step. Private: joined only with a seat reservation the world room
 * made for that player, never by matchmaking.
 */
export function arenaRoom({ log, world, profiles, fights, now, record = false }: ArenaServices) {
  const content = fightContentOf(world.battle);

  return class ArenaRoom extends Room {
    override maxMessagesPerSecond = ARENA_MESSAGES_PER_SECOND;
    // The room outlives an empty moment: its player may be away, and it closes itself at the end.
    override autoDispose = false;
    override state = new ArenaRoomState();
    override inputs = this.defineInput(ArenaInputSchema, {
      bufferMaxSize: INPUT_BUFFER,
      sanitize: (input) => Object.assign(input, cleanArenaInput(input as unknown as Record<string, unknown>)),
      idle: ({ latest }) => ({ dir: latest?.dir ?? ARENA_NONE }),
    });

    private plan!: FightPlan;
    private fight!: ArenaFight;
    private readonly minds = new Map<Side, Mind>();
    private readonly fighters = new Map<string, Fighter>();
    /** When the fight started waiting for an away player, or null while it runs. */
    private awaySince: number | null = null;
    private over = false;
    /** The fixed steps of each side's recent new presses, for `PRESSES_PER_SECOND`. */
    private readonly pressSteps: [number[], number[]] = [[], []];
    private readonly lastPress: [ArenaInput['press'], ArenaInput['press']] = [null, null];
    private refusedBefore: ReadonlySet<string> = new Set();
    private stepCount = 0;
    readonly stats = { steps: 0, totalMs: 0, worstMs: 0, inputs: 0, droppedInputs: 0, droppedPresses: 0, refusedPresses: 0 };
    /** Each core step's inputs, oldest first, when `record` is on. */
    readonly recorded: ArenaInputs[] = [];

    get fightId(): string {
      return this.plan.fightId;
    }

    get current(): ArenaFight {
      return this.fight;
    }

    get paused(): boolean {
      return this.awaySince !== null;
    }

    // Clients never matchmake into a fight: only the world room's seat reservations get in, and
    // matchmaker.reserveSeatFor does not call this.
    static override async onAuth(): Promise<never> {
      throw new ServerError(ErrorCode.AUTH_FAILED, 'arena rooms are joined only with a seat from the world room');
    }

    override onCreate(options: unknown) {
      const parsed = CreateOptions.safeParse(options);
      const plan = parsed.success ? fights.plan(parsed.data.fightId) : undefined;
      if (!plan) throw new ServerError(ErrorCode.MATCHMAKE_INVALID_CRITERIA, 'no such fight');
      this.plan = plan;
      void this.setPrivate(true);
      this.fight = fightStart(plan.setup, content);
      for (const { side, mind } of plan.minds) this.minds.set(side, { brain: createBrain(mind, content.arena), rng: createRng(`mind:${side}:${plan.setup.seed}`) });
      showFight(this.state, this.fight, content);
      // Nothing moves until everyone is in.
      if (plan.seats.length > 0) this.awaySince = now();
      fights.attach(plan.fightId, { stop: (why) => this.stop(why), holds: (playerId) => [...this.fighters.values()].some((fighter) => fighter.playerId === playerId) });
      this.setFixedTimestep(() => this.step(), ARENA_TICK_RATE, { subSteps: ARENA_SUB_STEPS });
      log.info('fight started', { roomId: this.roomId, fight: plan.fightId, mode: plan.setup.mode, players: plan.seats.map((seat) => seat.playerId), minds: plan.minds.map((mind) => mind.mind) });
    }

    /** Checks the one-time ticket the reservation carries, and that the session joining is the player it was made for. */
    override onAuth(_client: Client, options: unknown, context: AuthContext): ArenaAuth {
      const seat = SeatOptions.safeParse(options);
      const playerId = seat.success ? fights.useTicket(this.plan.fightId, seat.data.ticket) : null;
      if (playerId === null) throw new ServerError(ErrorCode.AUTH_FAILED, 'no fight ticket');
      if (profiles.authenticate(context.token) !== playerId) throw new ServerError(ErrorCode.AUTH_FAILED, 'this fight ticket is for another player');
      if ([...this.fighters.values()].some((fighter) => fighter.playerId === playerId)) throw new ServerError(ErrorCode.AUTH_FAILED, 'already in this fight');
      return { playerId };
    }

    override onJoin(client: Client) {
      const { playerId } = client.auth as ArenaAuth;
      const seat = this.plan.seats.find((each) => each.playerId === playerId);
      if (!seat || this.over) throw new ServerError(ErrorCode.AUTH_FAILED, 'not in this fight');
      this.fighters.set(client.sessionId, { playerId, side: seat.side, connected: true });
      this.sendStarted(client, seat.side);
      this.resumeIfEveryoneIsHere();
      log.info('fighter joined', { roomId: this.roomId, fight: this.plan.fightId, sessionId: client.sessionId, playerId, side: seat.side });
    }

    override onDrop(client: Client, code: number) {
      const fighter = this.fighters.get(client.sessionId);
      if (!fighter || this.over) return;
      fighter.connected = false;
      this.awaySince ??= now();
      this.allowReconnection(client, ARENA_RECONNECT_SECONDS).catch(() => {});
      log.info('fighter dropped', { roomId: this.roomId, fight: this.plan.fightId, sessionId: client.sessionId, code });
    }

    override onReconnect(client: Client) {
      const fighter = this.fighters.get(client.sessionId);
      if (!fighter) return;
      fighter.connected = true;
      this.sendStarted(client, fighter.side);
      this.resumeIfEveryoneIsHere();
      log.info('fighter reconnected', { roomId: this.roomId, fight: this.plan.fightId, sessionId: client.sessionId });
    }

    override onLeave(client: Client, code: number) {
      const fighter = this.fighters.get(client.sessionId);
      if (!fighter) return;
      this.fighters.delete(client.sessionId);
      log.info('fighter left', { roomId: this.roomId, fight: this.plan.fightId, sessionId: client.sessionId, code });
      if (this.over) return;
      this.awaySince ??= now();
      fights.seatLost(this.plan.fightId, fighter.playerId);
    }

    override onDispose() {
      if (!this.over) this.stop('shutdown');
    }

    /** A refused join is no error of the fight; a step that throws ends it, since the next would too. */
    override onUncaughtException(error: RoomException, method: RoomMethodName) {
      const cause = error.cause ?? error;
      if (cause instanceof ServerError && (method === 'onAuth' || method === 'onJoin')) {
        log.info('fighter refused', { roomId: this.roomId, fight: this.plan.fightId, reason: cause.message });
        return;
      }
      log.error('arena room error', { roomId: this.roomId, fight: this.plan?.fightId, method, error: cause instanceof Error ? cause.name : typeof cause, message: cause instanceof Error ? cause.message : '' });
      if (method === 'setFixedTimestep' && !this.over) this.stop('failed');
    }

    private sendStarted(client: Client, side: Side) {
      const { fight } = this;
      client.send(ARENA_MESSAGES.started, { fightId: this.plan.fightId, mode: fight.mode, side, sides: [lineup(fight, 0), lineup(fight, 1)] } satisfies ArenaStartedMessage);
    }

    private resumeIfEveryoneIsHere() {
      const here = this.plan.seats.every((seat) => [...this.fighters.values()].some((fighter) => fighter.playerId === seat.playerId && fighter.connected));
      if (!here || this.awaySince === null) return;
      this.awaySince = null;
      // What was sent while the fight waited is stale.
      for (const sessionId of this.fighters.keys()) this.inputs.get(sessionId).clear();
    }

    /** One fixed step: each side's input, two core steps, the state and the events. A waiting fight does not move. */
    private step() {
      if (this.over) return;
      if (this.awaySince !== null) {
        const wait = this.fight.mode === 'wild' ? BATTLE_IDLE_MS : DUEL_WAIT_MS;
        if (now() - this.awaySince >= wait) this.stop('away');
        return;
      }
      const started = performance.now();
      const people = this.peopleInputs();
      const events: FightEvent[] = [];
      for (let sub = 0; sub < ARENA_SUB_STEPS && !this.fight.outcome; sub += 1) {
        const inputs: ArenaInputs = [this.inputOf(0, people[0], sub), this.inputOf(1, people[1], sub)];
        if (record) this.recorded.push(inputs);
        const result = fightStep(this.fight, inputs, content);
        this.fight = result.fight;
        events.push(...result.events);
      }
      this.stepCount += 1;
      showFight(this.state, this.fight, content);
      this.sendEvents(events);
      const took = performance.now() - started;
      this.stats.steps += 1;
      this.stats.totalMs += took;
      this.stats.worstMs = Math.max(this.stats.worstMs, took);
      if (this.fight.outcome) this.end('done');
    }

    /** Each side's input from its player this step, or null for a computer's side. */
    private peopleInputs(): [ArenaInput | null, ArenaInput | null] {
      const people: [ArenaInput | null, ArenaInput | null] = [null, null];
      for (const [sessionId, fighter] of this.fighters) {
        const accessor = this.inputs.get(sessionId);
        const before = accessor.consumedCount;
        const frame = accessor.next();
        if (!accessor.wasIdle) {
          this.stats.inputs += 1;
          // An overflowing buffer drops its oldest inputs, which also counts them consumed.
          this.stats.droppedInputs += Math.max(0, accessor.consumedCount - before - 1);
        }
        people[fighter.side] = this.limitPresses(fighter.side, arenaInputOf(frame as unknown as Record<string, unknown>));
      }
      return people;
    }

    /** Drops the buttons of an input past `PRESSES_PER_SECOND` new presses. Holding one button is one press. */
    private limitPresses(side: Side, input: ArenaInput): ArenaInput {
      const recent = this.pressSteps[side].filter((step) => step > this.stepCount - ARENA_TICK_RATE);
      this.pressSteps[side] = recent;
      const held = input.press !== null && input.press === this.lastPress[side] && !input.dash && !input.treat && !input.swap;
      this.lastPress[side] = input.press;
      if (!pressed(input) || held) return input;
      if (recent.length >= PRESSES_PER_SECOND) {
        this.stats.droppedPresses += 1;
        return released(input);
      }
      recent.push(this.stepCount);
      return input;
    }

    /** Side's input for a core step: its player's on the first, with the buttons let go on the second; else its mind's. */
    private inputOf(side: Side, person: ArenaInput | null, sub: number): ArenaInput {
      const mind = this.minds.get(side);
      if (mind) return wildInput(this.fight.island, side, mind.brain, mind.rng, content);
      if (!person) return ARENA_IDLE;
      return sub === 0 ? person : released({ ...person, leave: false });
    }

    private sendEvents(stepEvents: readonly FightEvent[]) {
      const { events, seen } = freshRefusals(stepEvents, this.refusedBefore);
      this.refusedBefore = seen;
      const people = new Set([...this.fighters.values()].map((fighter) => fighter.side));
      this.stats.refusedPresses += events.filter((event) => event.kind === 'refused' && people.has(event.side)).length;
      if (events.length > 0) this.broadcast(ARENA_MESSAGES.events, { tick: this.fight.tick, events } satisfies ArenaEventsMessage);
    }

    /** Ends the fight before its end: a wild fight as its player leaving would, rounds with no result. */
    private stop(why: FightStop) {
      if (this.over) return;
      if (this.fight.mode === 'wild' && !this.fight.outcome) {
        try {
          const inputs: ArenaInputs = [{ ...ARENA_IDLE, leave: true }, ARENA_IDLE];
          if (record) this.recorded.push(inputs);
          const left = fightStep(this.fight, inputs, content);
          this.fight = left.fight;
          this.sendEvents(left.events);
        } catch (error) {
          log.error('fight could not be left', { roomId: this.roomId, fight: this.plan.fightId, error: error instanceof Error ? error.message : String(error) });
        }
      }
      this.end(why);
    }

    /** Hands the end to the world room once, then closes the room. */
    private end(why: FightStop | 'done') {
      this.over = true;
      showFight(this.state, this.fight, content);
      this.state.phase = 'ended';
      const { stats } = this;
      log.info('fight ended', {
        roomId: this.roomId,
        fight: this.plan.fightId,
        mode: this.fight.mode,
        why,
        outcome: this.fight.outcome?.result ?? null,
        ticks: this.fight.tick,
        steps: stats.steps,
        meanStepMs: stats.steps === 0 ? 0 : Number((stats.totalMs / stats.steps).toFixed(3)),
        worstStepMs: Number(stats.worstMs.toFixed(3)),
        inputs: stats.inputs,
        droppedInputs: stats.droppedInputs,
        droppedPresses: stats.droppedPresses,
        refusedPresses: stats.refusedPresses,
      });
      try {
        fights.finish({ fightId: this.plan.fightId, fight: this.fight, why });
      } catch (error) {
        log.error('fight hand-off failed', { roomId: this.roomId, fight: this.plan.fightId, error: error instanceof Error ? error.message : String(error) });
      }
      this.clock.setTimeout(() => void this.disconnect(), CLOSE_AFTER_MS);
    }
  };
}

export type ArenaRoom = InstanceType<ReturnType<typeof arenaRoom>>;
