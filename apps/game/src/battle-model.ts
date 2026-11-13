import { SERVER_MESSAGES, samePoint, shrineAt, type BattleResult, type BattleView, type BefriendResult, type Point, type ProgressMessage, type StorageMessage, type StringId, type WorldMap } from '@nebotok/core';
import { isTreat } from './battle-content.ts';
import type { ServerMessage } from './battle-link.ts';
import { ANSWER_MS } from './request-pacer.ts';
import { QUICK_TAP_MS, TAP_GRACE_MS, lineAt, nextLineAt, playback, playbackMs, shownOf, stepAt, type Effect, type Line, type Shown, type Step } from './battle-playback.ts';

/** What the menu under the field offers. Moves are listed by slot. */
export type Menu = {
  readonly moves: readonly string[];
  readonly team: boolean;
  readonly treat: boolean;
  /** Why a treat cannot be offered now, said under the buttons, or null. */
  readonly treatReason: StringId | null;
  readonly run: boolean;
};


/** The part of the battle screen below the field: the menu, a picker, or how the battle went. */
export type Panel = 'menu' | 'team' | 'treats' | 'result';
export type Picker = 'menu' | 'team' | 'treats';

export type BattleScreenState = {
  readonly view: BattleView;
  /** What the field shows now: part way through the playback, or the view itself. */
  readonly shown: Shown;
  readonly playing: boolean;
  /** The step on screen, with a key that changes for every step, so each effect is drawn once. */
  readonly step: { readonly key: string; readonly effect: Effect | null } | null;
  readonly line: Line | null;
  /** Null while a turn plays or the battle waits for its result. */
  readonly panel: Panel | null;
  readonly menu: Menu;
  /** A choice was sent and the server has not answered yet. */
  readonly waiting: boolean;
  readonly befriended: BefriendResult | null;
  readonly result: BattleResult | null;
};

const NO_MENU: Menu = { moves: [], team: false, treat: false, treatReason: null, run: false };

/** While choosing, `canTreat` is false only until the wild creature is worn down. */
function treatReasonOf(view: BattleView, treats: boolean): StringId | null {
  if (!view.canTreat) return view.phase === 'choose' ? 'battle.treatLater' : null;
  return treats ? null : 'battle.noTreats';
}

/**
 * Which buttons the view allows: moves and switching only while choosing, a treat from `canTreat`
 * when the player has `treats`, running (or leaving a fainted wild creature) from `canRun`.
 */
export function menuFor(view: BattleView, treats: boolean): Menu {
  if (view.phase === 'over' || view.outcome !== null) return NO_MENU;
  if (view.mustSwap) return { ...NO_MENU, team: true };
  const treat = { treat: view.canTreat && treats, treatReason: treatReasonOf(view, treats) };
  if (view.phase === 'befriend') return { ...NO_MENU, ...treat, run: view.canRun };
  if (view.phase !== 'choose') return NO_MENU;
  const { active, creatures } = view.team;
  const others = creatures.some((creature, at) => at !== active && creature.hp > 0);
  return { moves: creatures[active]?.moves ?? [], team: others, ...treat, run: view.canRun };
}

/** Whether the progress lists a treat; before any progress arrives, it is assumed so. */
const hasTreats = (progress: ProgressMessage | null): boolean => progress === null || progress.inventory.some((entry) => isTreat(entry.item) && entry.count > 0);

/** What the screen says once a battle is over, in order: how it ended, then each creature's experience and level. */
export function resultLines(result: BattleResult, befriended: BefriendResult | null, view: BattleView): Line[] {
  const lines: Line[] = [];
  const { outcome } = result;
  if (outcome.reason === 'befriended' && befriended) {
    lines.push({ id: befriended.placedIn === 'team' ? 'battle.befriended' : 'battle.befriendedStored', species: befriended.species });
  } else if (outcome.reason === 'ran') lines.push({ id: 'battle.ranAway' });
  else if (result.woke !== null || outcome.winner === 1) lines.push({ id: 'battle.teamFainted' });
  else if (outcome.winner === 0) lines.push({ id: 'battle.won' });
  else lines.push({ id: 'battle.over' });
  for (const reward of result.rewards) {
    const creature = view.team.creatures[reward.index];
    if (!creature) continue;
    if (reward.xp > 0) lines.push({ id: 'battle.xp', creature: creature.id, xp: reward.xp });
    if (reward.level > creature.level) lines.push({ id: 'battle.levelUp', creature: creature.id, level: reward.level });
    for (const { move } of result.learned.filter((learned) => learned.index === reward.index)) lines.push({ id: 'battle.learned', creature: creature.id, move });
  }
  return lines;
}

/** `startedAt` is where the playback's clock starts, moved back when a tap jumps ahead; `began` is when it really began. */
type Playing = { readonly steps: readonly Step[]; readonly startedAt: number; readonly began: number; readonly tappedAt: number | null; readonly update: number };

type Battle = {
  view: BattleView;
  playing: Playing | null;
  picker: Picker;
  waiting: boolean;
  /** When the choice being waited for went out (`sent`). */
  sentAt: number;
  befriended: BefriendResult | null;
  result: BattleResult | null;
  /** The last line a finished playback left, so it stays up while the player chooses. */
  line: Line | null;
};

const fresh = (view: BattleView): Battle => ({ view, playing: null, picker: 'menu', waiting: false, sentAt: 0, befriended: null, result: null, line: null });

export type BattleModel = {
  /** Takes in one message from the server, at page time `now`. */
  receive(message: ServerMessage, now: number): void;
  /**
   * The player's choice went out at page time `now` (again once it leaves the request pacer). The
   * menu waits for the answer, or ANSWER_MS, after which it takes the choice as lost and lets the
   * player choose again.
   */
  sent(now: number): void;
  /** Opens the menu, the team or the treats under the field. */
  pick(picker: Picker): void;
  /**
   * A tap at page time `now` while a turn plays: moves on to its next line, or to its end after
   * the last line or when it comes quickly after a tap that moved on.
   */
  advance(now: number): void;
  /** Puts the battle screen away after its result. */
  close(): void;
  /** Forgets everything, as when the world is left. */
  reset(): void;
  /**
   * Your courier stands on `tile`, as the server last said. Once it moves on to a tile out of reach
   * of the shrine whose storage was sent, that storage is forgotten: the server swaps only at a
   * shrine, and sends its storage again when the courier comes back.
   */
  standingAt(map: WorldMap, tile: Point): void;
  progress(): ProgressMessage | null;
  /** The creatures waiting at the shrine the courier stands by, if the server sent them. */
  storage(): StorageMessage | null;
  battle(now: number): BattleScreenState | null;
};

/** How many characters a line has in the words the player sees now. */
export type LineLength = (line: Line, view: BattleView) => number;

/**
 * The battle screen's state, fed by the server's messages. It always draws from the latest
 * `BattleView` and uses a message's events only to animate the way there, so a lost message or a
 * reconnection (`battle.view`) still ends on the truth. Each line plays for as long as
 * `lineLength` says it takes to read.
 */
export function createBattleModel(lineLength: LineLength): BattleModel {
  let progress: ProgressMessage | null = null;
  let storage: StorageMessage | null = null;
  // The tile the courier stood on when storage last arrived, or since; the message can come before
  // the state that moves the courier onto the shrine, so only a step after it counts.
  let storageSeenFrom: Point | null = null;
  let battle: Battle | null = null;
  let updates = 0;

  const finish = (current: Battle) => {
    if (!current.playing) return;
    const { steps } = current.playing;
    current.line = lineAt(steps, steps.length - 1) ?? current.line;
    current.playing = null;
  };

  const settle = (now: number) => {
    if (!battle?.playing) return;
    if (now - battle.playing.startedAt >= playbackMs(battle.playing.steps)) finish(battle);
  };

  const update = (view: BattleView, events: Parameters<typeof playback>[2], now: number, started: boolean) => {
    const before = !started && battle && battle.view.id === view.id ? battle.view : null;
    if (battle) finish(battle);
    const next = before && battle ? battle : fresh(view);
    updates += 1;
    next.view = view;
    next.picker = 'menu';
    next.waiting = false;
    const steps = playback(before, view, events, (line) => lineLength(line, view));
    next.playing = steps.length > 0 ? { steps, startedAt: now, began: now, tappedAt: null, update: updates } : null;
    battle = next;
  };

  const followingLine = (current: Battle): Line | null => {
    if (current.result) return null;
    if (current.view.mustSwap) return { id: 'battle.chooseNext' };
    if (current.view.phase === 'befriend') return { id: 'battle.treatOrDone' };
    return current.line;
  };

  const panelOf = (current: Battle, menu: Menu): Panel | null => {
    if (current.result) return 'result';
    if (current.view.mustSwap) return 'team';
    if (current.view.phase === 'over') return null;
    if (current.picker === 'treats' && !menu.treat) return 'menu';
    if (current.picker === 'team' && !menu.team) return 'menu';
    return current.picker;
  };

  return {
    receive: (message, now) => {
      settle(now);
      switch (message.type) {
        case SERVER_MESSAGES.progress:
          progress = message.payload;
          break;
        case SERVER_MESSAGES.storage:
          storage = message.payload;
          storageSeenFrom = null;
          break;
        case SERVER_MESSAGES.battleStarted:
          update(message.payload.battle, message.payload.events, now, true);
          break;
        case SERVER_MESSAGES.battleTurn:
          update(message.payload.battle, message.payload.events, now, false);
          break;
        case SERVER_MESSAGES.battleView:
          if (battle?.view.id === message.payload.battle.id) {
            finish(battle);
            battle.view = message.payload.battle;
            battle.waiting = false;
          } else battle = fresh(message.payload.battle);
          break;
        case SERVER_MESSAGES.battleBefriend:
          if (battle?.view.id === message.payload.battle) battle.befriended = message.payload;
          break;
        case SERVER_MESSAGES.battleResult:
          if (battle?.view.id === message.payload.battle) {
            battle.result = message.payload;
            battle.waiting = false;
          }
          break;
        case SERVER_MESSAGES.refused:
          // The server has no battle for this player, so one still waiting for its result is gone
          // there, as after the server restarted: drawing it on would refuse every tap.
          if (battle && message.payload.reason === 'notInBattle' && !battle.result) battle = null;
          else if (battle) battle.waiting = false;
          break;
      }
    },
    sent: (now) => {
      if (!battle) return;
      battle.waiting = true;
      battle.sentAt = now;
    },
    pick: (picker) => {
      if (battle) battle.picker = picker;
    },
    advance: (now) => {
      settle(now);
      const playing = battle?.playing;
      if (!battle || !playing || now - playing.began < TAP_GRACE_MS) return;
      const next = playing.tappedAt !== null && now - playing.tappedAt < QUICK_TAP_MS ? null : nextLineAt(playing.steps, now - playing.startedAt);
      if (next === null) finish(battle);
      else battle.playing = { ...playing, startedAt: now - next, tappedAt: now };
    },
    close: () => {
      if (battle?.result) battle = null;
    },
    reset: () => {
      progress = null;
      storage = null;
      storageSeenFrom = null;
      battle = null;
    },
    standingAt: (map, tile) => {
      if (!storage || (storageSeenFrom && samePoint(storageSeenFrom, tile))) return;
      const moved = storageSeenFrom !== null;
      storageSeenFrom = tile;
      if (moved && shrineAt(map, tile) !== storage.shrine) storage = null;
    },
    progress: () => progress,
    storage: () => storage,
    battle: (now) => {
      settle(now);
      if (!battle) return null;
      const current = battle;
      if (current.waiting && now - current.sentAt >= ANSWER_MS) current.waiting = false;
      const menu = menuFor(current.view, hasTreats(progress));
      const playing = current.playing;
      const index = playing ? stepAt(playing.steps, now - playing.startedAt) : null;
      const step = playing && index !== null ? playing.steps[index] : undefined;
      if (playing && step && index !== null) {
        return {
          view: current.view,
          shown: step.shown,
          playing: true,
          step: { key: `${playing.update}:${index}`, effect: step.effect },
          line: lineAt(playing.steps, index) ?? current.line,
          panel: null,
          menu,
          waiting: current.waiting,
          befriended: current.befriended,
          result: current.result,
        };
      }
      return {
        view: current.view,
        shown: shownOf(current.view),
        playing: false,
        step: null,
        line: followingLine(current),
        panel: panelOf(current, menu),
        menu,
        waiting: current.waiting,
        befriended: current.befriended,
        result: current.result,
      };
    },
  };
}
