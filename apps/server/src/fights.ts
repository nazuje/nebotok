import { randomUUID } from 'node:crypto';
import { matchMaker, type IRoomCache } from '@colyseus/core';
import type { ArenaFight, ArenaMindName, ArenaSeatReservation, FightSetup, RoundPick, Side } from '@nebotok/core';

/**
 * The fights this server runs, shared by the world room, which plans each fight and settles its
 * end, and the arena room that plays it (docs/protocol.md, "Rooms and the hand-off"). Everything
 * lives in this process's memory: a restart loses the fights, never a save.
 */

export const ARENA_ROOM = 'arena';

/** A person on one side of a fight. */
export type FightSeat = { readonly playerId: number; readonly side: Side };
/** The computer on one side of a fight, with one of arena.json's minds. */
export type FightMind = { readonly side: Side; readonly mind: ArenaMindName };

/** A side whose player picks its creatures for a best of 3, from its standing `team` in team order. */
export type FightPicker = { readonly side: Side; readonly team: readonly RoundPick[] };

/** Why a fight was stopped before its end: its player was away too long, left the world, was taken over, the server is closing, or an error. */
export type FightStop = 'away' | 'left' | 'replaced' | 'shutdown' | 'failed';

/** What the arena room hands the planner when a fight is over: the fight as it ended, or null for one that never started. */
export type FightEnd = { readonly fightId: string; readonly fight: ArenaFight | null; readonly why: FightStop | 'done' };

export type FightPlan = {
  readonly fightId: string;
  readonly setup: FightSetup;
  readonly seats: readonly FightSeat[];
  readonly minds: readonly FightMind[];
  /**
   * A best of 3's sides that pick in the room's `picking` phase; the setup's picks for them are the
   * defaults, which the room takes when the time runs out. None for a wild fight.
   */
  readonly pickers?: readonly FightPicker[];
  /** A duel: each side may give up, and up to `DUEL_WATCHERS` other players may watch. */
  readonly duel?: boolean;
  /** Called once, in this process, when the fight is over. */
  readonly ended: (end: FightEnd) => void;
  /** Called when a player's seat in the fight's room is gone while the fight goes on, so a new one can be offered. */
  readonly seatLost?: (playerId: number) => void;
  /** Called when a watcher's seat in the fight's room is gone: they stopped watching. */
  readonly watcherLeft?: (playerId: number) => void;
};

/** Who a spent ticket was made for, and whether as a watcher. */
export type FightTicket = { readonly playerId: number; readonly watcher: boolean };

/** What the arena room playing a fight lets the book do. */
export type FightControl = {
  /** Ends the fight now: a wild fight as `ran`, rounds with no result. */
  stop(why: FightStop): void;
  /** Whether the player holds a seat in the room, connected or waiting to reconnect. */
  holds(playerId: number): boolean;
  /** Sends the player's watcher seat, if they hold one, out of the room. */
  unwatch(playerId: number): void;
};

type Entry = {
  readonly plan: FightPlan;
  room: IRoomCache | null;
  control: FightControl | null;
  /** One-time tickets, each for one player's seat reservation. */
  readonly tickets: Map<string, FightTicket>;
};

export type FightBook = ReturnType<typeof createFightBook>;

export function createFightBook() {
  const entries = new Map<string, Entry>();

  /** Hands the end to the fight's planner, once. */
  const finish = (end: FightEnd) => {
    const entry = entries.get(end.fightId);
    if (!entry) return;
    entries.delete(end.fightId);
    entry.plan.ended(end);
  };

  return {
    /** Plans a fight and creates its room. Rejects when the room could not be made; the fight is then forgotten. */
    async open(plan: FightPlan): Promise<void> {
      const entry: Entry = { plan, room: null, control: null, tickets: new Map() };
      entries.set(plan.fightId, entry);
      try {
        entry.room = await matchMaker.createRoom(ARENA_ROOM, { fightId: plan.fightId });
      } catch (error) {
        if (entries.get(plan.fightId) === entry) entries.delete(plan.fightId);
        throw error;
      }
    },

    plan: (fightId: string): FightPlan | undefined => entries.get(fightId)?.plan,

    /** The arena room playing the fight registers how to stop it. */
    attach(fightId: string, control: FightControl) {
      const entry = entries.get(fightId);
      if (entry) entry.control = control;
    },

    /**
     * A seat in the fight's room with a fresh one-time ticket: for one of its players, or with
     * `watcher` for anyone else watching a duel. Null when the fight or its room is gone, or the
     * player may not have that seat. The arena room counts its watchers itself.
     */
    async reserve(fightId: string, playerId: number, watcher = false): Promise<ArenaSeatReservation | null> {
      const entry = entries.get(fightId);
      const fighter = entry?.plan.seats.some((seat) => seat.playerId === playerId) ?? false;
      const allowed = watcher ? entry?.plan.duel === true && !fighter : fighter;
      if (!entry?.room || !allowed) return null;
      const ticket = randomUUID();
      entry.tickets.set(ticket, { playerId, watcher });
      return matchMaker.reserveSeatFor(entry.room, { ticket });
    },

    /** Spends a ticket: who it was made for, or null for an unknown or spent one. */
    useTicket(fightId: string, ticket: string): FightTicket | null {
      const tickets = entries.get(fightId)?.tickets;
      const made = tickets?.get(ticket);
      if (tickets === undefined || made === undefined) return null;
      tickets.delete(ticket);
      return made;
    },

    holds: (fightId: string, playerId: number): boolean => entries.get(fightId)?.control?.holds(playerId) ?? false,

    seatLost(fightId: string, playerId: number) {
      entries.get(fightId)?.plan.seatLost?.(playerId);
    },

    watcherLeft(fightId: string, playerId: number) {
      entries.get(fightId)?.plan.watcherLeft?.(playerId);
    },

    /** Ends a watcher's seat from the world's side: they walked, left the world or were signed out. */
    unwatch(fightId: string, playerId: number) {
      entries.get(fightId)?.control?.unwatch(playerId);
    },

    /** Stops a fight before its end. One whose room is not playing yet ends at once with no result. */
    stop(fightId: string, why: FightStop) {
      const entry = entries.get(fightId);
      if (!entry) return;
      if (entry.control) entry.control.stop(why);
      else finish({ fightId, fight: null, why });
    },

    /** The arena room's last word on a fight. */
    finish,

    get size(): number {
      return entries.size;
    },
  };
}
