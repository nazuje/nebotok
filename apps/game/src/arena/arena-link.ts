import { ARENA_MESSAGES, SERVER_MESSAGES, SUBUNITS, arenaInputOf, otherSide, type ArenaJoinMessage, type ArenaResultMessage, type ArenaStartedMessage, type ArenaEventsMessage, type FightEvent, type Language, type LearnedMove, type ProgressMessage, type Side } from '@nebotok/core';
import type { Game } from 'phaser';
import type { ArenaRoom, WorldConnection, WorldRoom } from '../connection.ts';
import { element } from '../dom.ts';
import { moveArena } from '../move-arena.ts';
import { buttonStates, treatUsable, type ButtonState } from './arena-buttons.ts';
import { ARENA } from './arena-content.ts';
import { createArenaControls } from './arena-controls.ts';
import { createFollower, type Follower } from './arena-follow.ts';
import { INPUTS_PER_SECOND, leadLimit, wireInput } from './arena-input.ts';
import { createNetPanel, netMetersAsked } from './arena-net.ts';
import { createCastEcho, createPredictor, type CastEcho, type NetMeters, type Predictor } from './arena-predict.ts';
import { ARENA_SCENE, ArenaScene, type ArenaDrawn, type ShownFight } from './arena-scene.ts';
import { createArenaScreen, type CardView } from './arena-screen.ts';
import { fightBook, type FightBook } from './fight-book.ts';

export type ArenaOverlay = 'arena';

export type ArenaOptions = {
  /** The game, made after this, since the game needs the arena scene. */
  game(): Game;
  language(): Language;
  /** The connection to the world, whose session takes the arena seat. */
  connection(): WorldConnection | null;
  /** Your creatures and bag, as the server last sent them. */
  progress(): ProgressMessage | null;
  /** The arena screen went up or away, so the page shows another screen and input may change. */
  changed(): void;
  /** A fight started: whatever the player was doing with their courier stops. */
  started(): void;
  /** The moves a fight's end taught at once, for the new-move toast. */
  learned(moves: readonly LearnedMove[]): void;
};

/** The fight on screen, for the test hook. */
export type TestArena = {
  fightId: string;
  /** Whether this page holds its seat in the arena room now. */
  joined: boolean;
  mode: ArenaStartedMessage['mode'] | null;
  side: Side | null;
  phase: string | null;
  tick: number;
  radius: number;
  mine: (CardView & { x: number; y: number }) | null;
  theirs: (CardView & { x: number; y: number }) | null;
  buttons: { action: ButtonState['action']; move: string | null; shown: boolean; locked: boolean; ring: number }[];
  leave: boolean;
  /** Inputs sent, and how many asked for a move. */
  inputs: number;
  presses: number;
  drawn: ArenaDrawn | null;
  result: ArenaResultMessage | null;
  /** The netcode meters (docs/protocol.md, "Prediction"), once the fight has started. */
  net: NetMeters | null;
};

export type Arena = {
  readonly scene: ArenaScene;
  /** Listens to a world room joined afresh for fights, forgetting any fight first. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** Called every frame. */
  frame(now: number): void;
  overlay(): ArenaOverlay | null;
  /** Forgets the fight and leaves its room, as when the player leaves the world. */
  reset(): void;
  snapshot(): { arena: TestArena | null };
};

const SEND_MS = 1_000 / INPUTS_PER_SECOND;
/** How much of each new ping the round trip takes in. */
const PING_EASE = 0.25;

type Fight = {
  readonly id: string;
  room: ArenaRoom | null;
  started: ArenaStartedMessage | null;
  result: ArenaResultMessage | null;
  book: FightBook;
  events: FightEvent[];
  inputs: number;
  presses: number;
  stop: () => void;
  /** Your creature, predicted, and the other one, smoothed; made when the room says which side is yours. */
  predictor: Predictor | null;
  echo: CastEcho | null;
  follower: Follower;
  /** The network's round trip, from a ping each second; the input stream's own counts the inputs waiting in the room too. */
  pingMs: number | null;
  /** Whether the last send was skipped to drain the room's buffer: never two in a row. */
  skipped: boolean;
};

/**
 * The arena fights of this page (docs/arena.md, "Screens and controls"; docs/protocol.md "Arena
 * fights"): `arena.join` from the world room seats the page in the fight's arena room, whose state
 * the scene draws and whose input stream the controls feed 30 times a second; `arena.result` from
 * the world room puts up how it ended, until Continue.
 */
export function createArena(options: ArenaOptions): Arena {
  const root = element<HTMLElement>('#arena');
  const screen = createArenaScreen(root, { continue: () => finish() });
  const netPanel = netMetersAsked(location.search) ? createNetPanel(root) : null;
  let fight: Fight | null = null;
  let sender: ReturnType<typeof setInterval> | undefined;

  const shown = (): ShownFight | null => {
    const state = fight?.room?.state;
    const side = fight?.started?.side;
    if (!fight || !state?.bodies || side === undefined) return null;
    const { predictor, follower } = fight;
    return { state, side, place: (at, now) => (at === side ? (predictor?.at(now) ?? null) : follower.at(now)) };
  };
  const fighting = (): boolean => fight !== null && fight.result === null && fight.room !== null && shown()?.state.phase === 'fighting';

  const controls = createArenaControls(screen, { active: fighting });
  const scene = new ArenaScene({
    fight: shown,
    events: () => {
      if (!fight) return [];
      const events = fight.events;
      fight.events = [];
      return events;
    },
    field: () => screen.field.getBoundingClientRect(),
  });

  function send() {
    const room = fight?.room;
    if (!fight || !room || !fighting()) return;
    if (fight.inputs % INPUTS_PER_SECOND === 0) ping(fight, room);
    const input = room.input();
    // A skipped send takes nothing from the controls, so its presses go with the next.
    if (!fight.skipped && fight.pingMs !== null && input.pendingCount > leadLimit(fight.pingMs, room.clock.patchInterval?.() ?? SEND_MS)) {
      fight.skipped = true;
      return;
    }
    fight.skipped = false;
    const pressed = controls.take();
    const wire = wireInput(controls.direction(), pressed, controls.leaving());
    Object.assign(input.data, wire);
    const seq = input.send();
    const now = performance.now();
    fight.predictor?.sent(seq, arenaInputOf(wire), now);
    fight.inputs += 1;
    if (pressed.press !== null) {
      fight.presses += 1;
      echoCast(fight, pressed.press, now);
    }
  }

  function ping(target: Fight, room: ArenaRoom) {
    room.ping((ms) => {
      target.pingMs = target.pingMs === null ? ms : target.pingMs + (ms - target.pingMs) * PING_EASE;
    });
  }

  /** Starts the animation of a cast you pressed at once, when its button looks ready; the server's own cast then plays nothing more. */
  function echoCast(target: Fight, button: 0 | 1 | 2, now: number) {
    const side = target.started?.side;
    if (!target.echo || side === undefined || target.echo.waiting(button, now)) return;
    const ready = buttons().find((each) => each.action === button);
    const shape = ready?.move ? moveArena(ready.move)?.shape : undefined;
    if (!ready?.move || !shape || ready.locked || ready.cooldown > 0) return;
    target.echo.cast(button, now);
    target.events.push({ kind: 'cast', side, button, move: ready.move, shape });
  }

  /** Hands the room's newest state to the prediction and the other creature's smoothing. */
  function track(target: Fight) {
    const now = performance.now();
    const room = target.room;
    const state = room?.state;
    const side = target.started?.side;
    if (!room || !state?.bodies || side === undefined) return;
    target.predictor?.heard(state, room.input().lastProcessed, now);
    const other = state.bodies.at(otherSide(side));
    if (other) target.follower.heard(other.id, state.tick, { x: other.x / SUBUNITS, y: other.y / SUBUNITS }, now);
  }

  function meters(target: Fight): NetMeters | null {
    const room = target.room;
    return room && target.predictor ? target.predictor.meters(target.pingMs ?? room.clock.smoothedRtt(), room.input().pendingCount, performance.now()) : null;
  }

  function leaveRoom(ending: Fight) {
    ending.stop();
    ending.stop = () => {};
    const room = ending.room;
    ending.room = null;
    if (room) void room.leave().catch(() => {});
  }

  function forget() {
    if (fight) leaveRoom(fight);
    fight = null;
    controls.reset();
    clearInterval(sender);
    sender = undefined;
    options.changed();
  }

  function finish() {
    forget();
  }

  function seated(target: Fight, room: ArenaRoom) {
    if (fight !== target) {
      void room.leave().catch(() => {});
      return;
    }
    target.room = room;
    // Inputs are the fight's own pace: one kept through a drop would arrive late, out of its tick.
    room.reconnection.maxEnqueuedMessages = 0;
    const stops = [
      room.onMessage(ARENA_MESSAGES.started, (message: ArenaStartedMessage) => {
        target.started = message;
        target.book = fightBook(message, options.progress());
        // Also on a reconnection, whose input stream starts again from nothing.
        target.predictor = createPredictor(message.side, ARENA, SEND_MS);
        target.echo = createCastEcho(message.side);
      }),
      room.onMessage(ARENA_MESSAGES.events, (message: ArenaEventsMessage) => {
        target.events.push(...(target.echo ? target.echo.settle(message.events, performance.now()) : message.events));
        target.book.saw(message.events);
      }),
    ];
    room.onLeave(() => {
      if (target.room === room) target.room = null;
    });
    target.stop = () => {
      for (const stop of stops) stop();
    };
    clearInterval(sender);
    sender = setInterval(send, SEND_MS);
  }

  function join({ fightId, reservation }: ArenaJoinMessage) {
    const connection = options.connection();
    if (!connection) return;
    if (fight?.id !== fightId) {
      if (fight) leaveRoom(fight);
      fight = { id: fightId, room: null, started: null, result: null, book: fightBook(null, options.progress()), events: [], inputs: 0, presses: 0, stop: () => {}, predictor: null, echo: null, follower: createFollower(), pingMs: null, skipped: false };
      controls.reset();
      options.started();
      options.changed();
    } else leaveRoom(fight);
    const target = fight;
    // A seat that cannot be taken is lost to the server too, which sends a new arena.join.
    connection.joinFight(reservation).then(
      (room) => seated(target, room),
      () => {},
    );
  }

  function ended(result: ArenaResultMessage) {
    options.learned(result.learned);
    if (fight?.id !== result.fightId) return;
    fight.result = result;
    controls.reset();
    clearInterval(sender);
    sender = undefined;
  }

  function cards(): [CardView | null, CardView | null] {
    const now = shown();
    if (!now) return [null, null];
    const card = (side: Side): CardView | null => {
      const body = now.state.bodies.at(side);
      return body ? { species: body.species, level: body.level, health: body.health, max: body.max, turtle: body.turtle } : null;
    };
    return [card(now.side), card(now.side === 0 ? 1 : 0)];
  }

  function buttons(): ButtonState[] {
    const now = shown();
    const mine = now?.state.bodies.at(now.side);
    if (!fight || !now || !mine) return buttonStates({ level: 0, loadout: null, cooldowns: [], treat: false, swap: false });
    const wild = now.state.mode === 'wild' ? now.state.bodies.at(now.side === 0 ? 1 : 0) : undefined;
    const progress = options.progress();
    const treat = wild !== undefined && treatUsable(wild, fight.book.bag(progress), now.state.treat.item !== '');
    return buttonStates({ level: mine.level, loadout: fight.book.loadout(mine.id, progress), cooldowns: [...mine.cooldowns], treat, swap: now.state.mode === 'wild' && fight.book.canSwap(mine.id) });
  }

  return {
    scene,
    joined: (room) => {
      if (fight) forget();
      const stops = [room.onMessage(SERVER_MESSAGES.arenaJoin, join), room.onMessage(SERVER_MESSAGES.arenaResult, ended)];
      return () => {
        for (const stop of stops) stop();
      };
    },
    frame: (now) => {
      const language = options.language();
      if (fight) track(fight);
      netPanel?.render(fight && fight.result === null ? meters(fight) : null, language);
      const view = fight && { cards: cards(), result: fight.result, team: options.progress()?.team ?? [] };
      screen.render(view, language);
      if (fight) controls.render(buttons(), language, now, fighting() && shown()?.state.mode === 'wild');
      const game = options.game();
      const running = game.scene.isActive(ARENA_SCENE);
      if (fight && !running) game.scene.run(ARENA_SCENE);
      else if (!fight && running) game.scene.stop(ARENA_SCENE);
    },
    overlay: () => (fight ? 'arena' : null),
    reset: () => {
      if (fight) forget();
    },
    snapshot: () => {
      if (!fight) return { arena: null };
      const now = shown();
      const body = (side: Side) => {
        const at = now?.state.bodies.at(side);
        return at ? { species: at.species, level: at.level, health: at.health, max: at.max, turtle: at.turtle, x: at.x, y: at.y } : null;
      };
      const side = fight.started?.side ?? null;
      return {
        arena: {
          fightId: fight.id,
          joined: fight.room !== null,
          mode: fight.started?.mode ?? null,
          side,
          phase: now?.state.phase ?? null,
          tick: now?.state.tick ?? 0,
          radius: now?.state.radius ?? 0,
          mine: side === null ? null : body(side),
          theirs: side === null ? null : body(side === 0 ? 1 : 0),
          buttons: buttons().map(({ action, move, shown: visible, locked, ring }) => ({ action, move, shown: visible, locked, ring })),
          leave: controls.leaving(),
          inputs: fight.inputs,
          presses: fight.presses,
          drawn: scene.drawn(),
          result: fight.result,
          net: meters(fight),
        },
      };
    },
  };
}
