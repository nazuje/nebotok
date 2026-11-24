import {
  ARENA_CLIENT_MESSAGES,
  ARENA_MESSAGES,
  SERVER_MESSAGES,
  SUBUNITS,
  arenaInputOf,
  otherSide,
  type ArenaJoinMessage,
  type ArenaPickMessage,
  type ArenaResultMessage,
  type ArenaStartedMessage,
  type ArenaEventsMessage,
  type FightEvent,
  type Language,
  type LearnedMove,
  type ProgressMessage,
  type Refused,
  type Side,
  type TeamCreature,
} from '@nebotok/core';
import type { Game } from 'phaser';
import type { ArenaRoom, WorldConnection, WorldRoom } from '../connection.ts';
import { element } from '../dom.ts';
import { cameInHurt } from '../health-level.ts';
import { moveArena } from '../move-arena.ts';
import type { SoundPlayer } from '../sound.ts';
import type { Cries } from '../sounds-creatures.ts';
import { buttonStates, treatUsable, type ButtonState } from './arena-buttons.ts';
import { ARENA } from './arena-content.ts';
import { createArenaControls, type Quit } from './arena-controls.ts';
import { createFollower, type Follower } from './arena-follow.ts';
import { INPUTS_PER_SECOND, leadLimit, wireInput } from './arena-input.ts';
import { createNetPanel, netMetersAsked } from './arena-net.ts';
import { createCastEcho, createPredictor, type CastEcho, type NetMeters, type Predictor } from './arena-predict.ts';
import { badgeTone, buzzFor, motionReduced } from './arena-juice.ts';
import { createRoundsScreen, pipsOf, tappedOrder, type RoundsView } from './arena-rounds.ts';
import { arenaSounds, createPhaseSounds, type ArenaSound } from './arena-sounds.ts';
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
  /** Whether your courier watches a duel, as the world's state says. */
  watcher(): boolean;
  /** The page's sounds and haptics, which the player's sounds setting turns off. */
  sound: Pick<SoundPlayer, 'play' | 'vibrate'>;
  /** Each creature cries as it comes onto the island, and a befriended one as the fight ends. */
  cries: Pick<Cries, 'cry' | 'entered'>;
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
  /** Whether this page watches someone's duel; a duel, the fight waiting for a player, and the corner button shown. */
  watching: boolean;
  duel: boolean;
  waiting: boolean;
  quit: Quit | null;
  /** Inputs sent, and how many asked for a move. */
  inputs: number;
  presses: number;
  /** Buzzes asked of the device, where it can vibrate and sounds are on. */
  buzzes: number;
  /** Each sound this fight played, once, in the order first played (arena-sounds.ts). */
  sounds: string[];
  /** A best of 3's picks by team place, in round order: the ones on the pick screen while picking, then the server's. */
  picks: number[] | null;
  /** The round now, from 0, and the round wins of your side and of the other's. */
  round: number;
  score: [number, number];
  /** Milliseconds left of picking or of the pause between rounds. */
  countdown: number;
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
/** How long the island stays in view after the fight ends, in ms, so a fall or a befriending's hearts play out before the result covers it. */
export const RESULT_HOLD_MS = 1_500;

type Fight = {
  readonly id: string;
  room: ArenaRoom | null;
  /** The room's last state once the server has closed it, so the island stays drawn while the result is held back. */
  last: ShownFight['state'] | null;
  started: ArenaStartedMessage | null;
  result: ArenaResultMessage | null;
  /** When the result card goes up, in page ms. */
  resultAt: number;
  book: FightBook;
  events: FightEvent[];
  inputs: number;
  presses: number;
  buzzes: number;
  /** A best of 3's picks, by team place in round order, once `arena.started` has told the defaults. */
  order: number[] | null;
  /** Whether `order` has gone to the server. */
  sent: boolean;
  /** Whether each of your fighters came onto the island hurt, by fighter id, for its card's arrow to the shrine. */
  entered: Map<string, boolean>;
  stop: () => void;
  /** Your creature, predicted, and the other one, smoothed; made when the room says which side is yours. */
  predictor: Predictor | null;
  echo: CastEcho | null;
  follower: Follower;
  /** The network's round trip, from a ping each second; the input stream's own counts the inputs waiting in the room too. */
  pingMs: number | null;
  /** Whether the last send was skipped to drain the room's buffer: never two in a row. */
  skipped: boolean;
  /** The countdown's ticks and "Go!" from the room's phase, and each sound played so far. */
  phases: ReturnType<typeof createPhaseSounds>;
  sounds: string[];
};

/** The team places of a side's line-up: your own creatures', for a best of 3's picks. */
const placesOf = (started: ArenaStartedMessage): number[] => started.sides[started.side].flatMap(({ place }) => (place === null ? [] : [place]));

/** Your team as the pick screen shows it: in a duel at an even level, every creature at the level of the line-up the server sent. */
export function pickTeam(team: readonly TeamCreature[], started: ArenaStartedMessage | null): readonly TeamCreature[] {
  const lineup = started?.sides[started.side] ?? [];
  const even = lineup.find(({ place, level }) => place !== null && team[place] !== undefined && team[place].level !== level);
  return even ? team.map((creature) => ({ ...creature, level: even.level })) : team;
}

/**
 * The arena fights of this page (docs/arena.md, "Screens and controls"; docs/protocol.md "Arena
 * fights"): `arena.join` from the world room seats the page in the fight's arena room, whose state
 * the scene draws and whose input stream the controls feed 30 times a second; `arena.result` from
 * the world room puts up how it ended, until Continue.
 */
export function createArena(options: ArenaOptions): Arena {
  const root = element<HTMLElement>('#arena');
  const screen = createArenaScreen(root, { continue: () => finish(), unwatch: () => forget() });
  const netPanel = netMetersAsked(location.search) ? createNetPanel(root) : null;
  let fight: Fight | null = null;
  let sender: ReturnType<typeof setInterval> | undefined;

  const shown = (): ShownFight | null => {
    const state = fight?.room?.state ?? fight?.last;
    const side = fight?.started?.side;
    if (!fight || !state?.bodies || side === undefined) return null;
    const { predictor, follower } = fight;
    return { state, side, place: (at, now) => (at === side ? (predictor?.at(now) ?? null) : follower.at(now)) };
  };
  const watching = (): boolean => fight?.started?.watching === true;
  const fighting = (): boolean => fight !== null && !watching() && fight.result === null && fight.room !== null && shown()?.state.phase === 'fighting';

  const controls = createArenaControls(screen, { active: fighting });
  const rounds = createRoundsScreen(screen.rounds, {
    tapped: (place) => {
      if (fight?.order && !fight.sent) fight.order = tappedOrder(fight.order, place, pickTeam(options.progress()?.team ?? [], fight.started));
    },
    go: () => {
      const room = fight?.room;
      if (!fight?.order || fight.sent || !room) return;
      room.send(ARENA_CLIENT_MESSAGES.pick, { order: fight.order } satisfies ArenaPickMessage);
      fight.sent = true;
    },
  });
  const scene = new ArenaScene({
    fight: shown,
    events: () => {
      if (!fight) return [];
      const events = fight.events;
      fight.events = [];
      hear(fight, arenaSounds(events, { side: fight.started?.side ?? 0, watching: watching() }));
      return events;
    },
    field: () => screen.field.getBoundingClientRect(),
    popup: (popup, x, y) => screen.popup(popup, x, y, options.language()),
  });

  /** Plays a fight's sounds, while the player's sounds are on and the burst cap lets them start. */
  function hear(target: Fight, sounds: readonly ArenaSound[]) {
    for (const { id, priority } of sounds) {
      if (options.sound.play(id, priority) && !target.sounds.includes(id)) target.sounds.push(id);
    }
  }

  /**
   * A hit to your creature, a ring-out or a befriending buzzes the device (`navigator.vibrate`, which
   * Safari on iPhone and iPad lacks), unless motion is reduced, and only while the player's sounds
   * are on. The sounds come with the scene's frame (`hear`).
   */
  function feel(target: Fight, events: readonly FightEvent[]) {
    const side = target.started?.side;
    if (side === undefined || target.started?.watching) return;
    const motion = !motionReduced();
    for (const event of events) {
      const pattern = buzzFor(event, side, motion);
      if (pattern && options.sound.vibrate(pattern)) target.buzzes += 1;
    }
  }

  function send() {
    const room = fight?.room;
    // A room the server just closed is gone only once its socket has finished closing.
    if (!fight || !room || !room.connection.isOpen || !fighting()) return;
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
        if (message.mode === 'rounds' && target.order === null && !message.watching) target.order = placesOf(message);
        // Also on a reconnection, whose input stream starts again from nothing. A watcher sends
        // nothing, so both creatures are drawn from the room's state, side 0 as it comes.
        target.predictor = message.watching ? null : createPredictor(message.side, ARENA, SEND_MS);
        target.echo = message.watching ? null : createCastEcho(message.side);
      }),
      // A pick the server refused can be changed and sent again.
      room.onMessage(ARENA_MESSAGES.refused, (message: Refused) => {
        if (message.request === ARENA_CLIENT_MESSAGES.pick) target.sent = false;
      }),
      room.onMessage(ARENA_MESSAGES.events, (message: ArenaEventsMessage) => {
        target.events.push(...(target.echo ? target.echo.settle(message.events, performance.now()) : message.events));
        target.book.saw(message.events);
        feel(target, message.events);
      }),
    ];
    room.onLeave(() => {
      if (target.room !== room) return;
      target.last = room.state;
      target.room = null;
      // A watcher's seat is not held: one that is gone before the result watches no more.
      if (target.started?.watching && target.result === null && fight === target) forget();
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
      fight = { id: fightId, room: null, last: null, started: null, result: null, resultAt: 0, book: fightBook(null, options.progress()), events: [], inputs: 0, presses: 0, buzzes: 0, order: null, sent: false, entered: new Map(), stop: () => {}, predictor: null, echo: null, follower: createFollower(), pingMs: null, skipped: false, phases: createPhaseSounds(), sounds: [] };
      controls.reset();
      options.started();
      options.changed();
    } else leaveRoom(fight);
    const target = fight;
    // A seat that cannot be taken is lost to the server too, which sends a new arena.join.
    connection.joinFight(reservation).then(
      (room) => seated(target, room),
      () => {
        // A watcher's seat that cannot be taken is not sent again.
        if (fight === target && target.started === null && options.watcher()) forget();
      },
    );
  }

  /** A creature cries as it comes onto the island: the other side's first as a fight starts, then after a swap and each round. */
  function entrances(target: Fight, now: number) {
    const state = shown()?.state;
    const side = target.started?.side;
    if (state?.phase !== 'fighting' || side === undefined) return;
    for (const at of [otherSide(side), side]) {
      const body = state.bodies.at(at);
      if (body) options.cries.entered(target.id, `${at}:${body.id}`, body.species, now);
    }
  }

  function ended(result: ArenaResultMessage) {
    options.learned(result.learned);
    if (fight?.id !== result.fightId) return;
    if (result.befriended) options.cries.cry(result.befriended.species, performance.now());
    fight.result = result;
    fight.resultAt = performance.now() + RESULT_HOLD_MS;
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
      if (!body) return null;
      const rest = side === now.side && fight !== null && !watching() && cameInHurt(fight.entered, body.id, body.health, body.max);
      return { species: body.species, level: body.level, tone: badgeTone(body.level, other?.level ?? null), health: body.health, max: body.max, turtle: body.turtle, rest };
    };
    return [card(now.side), card(now.side === 0 ? 1 : 0)];
  }

  /** The pick screen while picking, and the score between rounds; a watcher sees only the score. */
  function roundsView(): RoundsView {
    const now = shown();
    if (!fight || !now || fight.result || now.state.mode !== 'rounds') return { pick: null, between: null };
    const { state, side } = now;
    const other = side === 0 ? 1 : 0;
    if (state.phase === 'picking') {
      if (!fight.order) return { pick: null, between: null };
      return { pick: { team: pickTeam(options.progress()?.team ?? [], fight.started), order: fight.order, sent: fight.sent || state.picked.at(side) === true, countdown: state.countdown }, between: null };
    }
    if (state.phase !== 'between') return { pick: null, between: null };
    const species = (of: Side) => state.bodies.at(of)?.species ?? null;
    return { pick: null, between: { pips: pipsOf([...state.rounds], side), score: [state.score.at(side) ?? 0, state.score.at(other) ?? 0], next: [species(side), species(other)] } };
  }

  /** Whether the fight waits for a player who is away, or a watcher for the players to pick. */
  function waiting(): boolean {
    const state = shown()?.state;
    return state !== undefined && (state.waiting || (watching() && state.phase === 'picking'));
  }

  /** The corner button while fighting: Leave in a wild fight, Give up in a duel, none in a trainer's best of 3. */
  function quit(): Quit | null {
    const state = shown()?.state;
    if (!fighting() || !state) return null;
    if (state.mode === 'wild') return 'leave';
    return state.duel ? 'giveUp' : null;
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
      if (fight) {
        track(fight);
        entrances(fight, now);
        const state = shown()?.state;
        hear(fight, fight.phases(state?.phase ?? null, state?.countdown ?? 0));
      }
      netPanel?.render(fight && fight.result === null ? meters(fight) : null, language);
      const view = fight && { cards: cards(), weather: shown()?.state.weather ?? '', result: now >= fight.resultAt ? fight.result : null, team: options.progress()?.team ?? [], watching: watching(), waiting: waiting() };
      screen.render(view, language);
      root.dataset.phase = shown()?.state.phase ?? '';
      rounds.render(roundsView(), language);
      if (fight) controls.render(buttons(), language, now, quit());
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
      const picking = now?.state.phase === 'picking';
      const score: [number, number] = now ? [now.state.score.at(now.side) ?? 0, now.state.score.at(now.side === 0 ? 1 : 0) ?? 0] : [0, 0];
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
          watching: watching(),
          duel: now?.state.duel ?? false,
          waiting: waiting(),
          quit: quit(),
          inputs: fight.inputs,
          presses: fight.presses,
          buzzes: fight.buzzes,
          sounds: [...fight.sounds],
          picks: picking ? fight.order : fight.started?.mode === 'rounds' ? placesOf(fight.started) : null,
          round: now?.state.round ?? 0,
          score,
          countdown: now?.state.countdown ?? 0,
          drawn: scene.drawn(),
          result: fight.result,
          net: meters(fight),
        },
      };
    },
  };
}
