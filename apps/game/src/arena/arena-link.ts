import { ARENA_MESSAGES, SERVER_MESSAGES, type ArenaJoinMessage, type ArenaResultMessage, type ArenaStartedMessage, type ArenaEventsMessage, type FightEvent, type Language, type LearnedMove, type ProgressMessage, type Side } from '@nebotok/core';
import type { Game } from 'phaser';
import type { ArenaRoom, WorldConnection, WorldRoom } from '../connection.ts';
import { element } from '../dom.ts';
import { buttonStates, treatUsable, type ButtonState } from './arena-buttons.ts';
import { createArenaControls } from './arena-controls.ts';
import { INPUTS_PER_SECOND, wireInput } from './arena-input.ts';
import { badgeTone, buzzFor, motionReduced } from './arena-juice.ts';
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
  /** Buzzes asked of the device, where it can vibrate. */
  buzzes: number;
  drawn: ArenaDrawn | null;
  result: ArenaResultMessage | null;
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

type Fight = {
  readonly id: string;
  room: ArenaRoom | null;
  started: ArenaStartedMessage | null;
  result: ArenaResultMessage | null;
  book: FightBook;
  events: FightEvent[];
  inputs: number;
  presses: number;
  buzzes: number;
  stop: () => void;
};

/** Buzzes the device where it can (`navigator.vibrate`; Safari on iPhone and iPad has none). Returns whether it asked. */
function buzz(pattern: readonly number[]): boolean {
  if (typeof navigator.vibrate !== 'function') return false;
  navigator.vibrate([...pattern]);
  return true;
}

/**
 * The arena fights of this page (docs/arena.md, "Screens and controls"; docs/protocol.md "Arena
 * fights"): `arena.join` from the world room seats the page in the fight's arena room, whose state
 * the scene draws and whose input stream the controls feed 30 times a second; `arena.result` from
 * the world room puts up how it ended, until Continue.
 */
export function createArena(options: ArenaOptions): Arena {
  const screen = createArenaScreen(element<HTMLElement>('#arena'), { continue: () => finish() });
  let fight: Fight | null = null;
  let sender: ReturnType<typeof setInterval> | undefined;

  const shown = (): ShownFight | null => {
    const state = fight?.room?.state;
    const side = fight?.started?.side;
    return state?.bodies && side !== undefined ? { state, side } : null;
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
    popup: (popup, x, y) => screen.popup(popup, x, y, options.language()),
  });

  /** A hit to your creature, a ring-out or a befriending buzzes the device, unless motion is reduced. */
  function feel(target: Fight, events: readonly FightEvent[]) {
    const side = target.started?.side;
    if (side === undefined) return;
    const motion = !motionReduced();
    for (const event of events) {
      const pattern = buzzFor(event, side, motion);
      if (pattern && buzz(pattern)) target.buzzes += 1;
    }
  }

  function send() {
    const room = fight?.room;
    if (!fight || !room || !fighting()) return;
    const pressed = controls.take();
    const input = room.input();
    Object.assign(input.data, wireInput(controls.direction(), pressed, controls.leaving()));
    input.send();
    fight.inputs += 1;
    if (pressed.press !== null) fight.presses += 1;
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
      }),
      room.onMessage(ARENA_MESSAGES.events, (message: ArenaEventsMessage) => {
        target.events.push(...message.events);
        target.book.saw(message.events);
        feel(target, message.events);
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
      fight = { id: fightId, room: null, started: null, result: null, book: fightBook(null, options.progress()), events: [], inputs: 0, presses: 0, buzzes: 0, stop: () => {} };
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
      const other = now.state.bodies.at(side === 0 ? 1 : 0);
      return body ? { species: body.species, level: body.level, tone: badgeTone(body.level, other?.level ?? null), health: body.health, max: body.max, turtle: body.turtle } : null;
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
      const view = fight && { cards: cards(), weather: shown()?.state.weather ?? '', result: fight.result, team: options.progress()?.team ?? [] };
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
      const [mine, theirs] = cards();
      const body = (side: Side, card: CardView | null) => {
        const at = now?.state.bodies.at(side);
        return at && card ? { ...card, x: at.x, y: at.y } : null;
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
          mine: side === null ? null : body(side, mine),
          theirs: side === null ? null : body(side === 0 ? 1 : 0, theirs),
          buttons: buttons().map(({ action, move, shown: visible, locked, ring }) => ({ action, move, shown: visible, locked, ring })),
          leave: controls.leaving(),
          inputs: fight.inputs,
          presses: fight.presses,
          buzzes: fight.buzzes,
          drawn: scene.drawn(),
          result: fight.result,
        },
      };
    },
  };
}
