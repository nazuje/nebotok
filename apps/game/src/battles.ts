import { SERVER_MESSAGES, type Language, type Point, type ProgressMessage, type StorageMessage, type StringId, type WorldMap } from '@nebotok/core';
import type { Game } from 'phaser';
import { roomLink, type BattleLink, type ClientMessage, type ServerMessage } from './battle-link.ts';
import { createBattleModel } from './battle-model.ts';
import { BATTLE_SCENE, BattleScene } from './battle-scene.ts';
import { createBattleScreen, lineText } from './battle-screen.ts';
import type { WorldRoom } from './connection.ts';
import { element } from './dom.ts';
import type { ToastKind } from './hud.ts';
import { createLearnModel, createLearnPrompt } from './learn-prompt.ts';
import { createStarterScreen } from './starter-screen.ts';
import { text } from './strings.ts';
import { createTeamScreen } from './team-screen.ts';
import type { LearnState } from './learn-prompt.ts';
import type { TestBattle, TestTeamScreen } from './test-hook.ts';

/** A screen over the world that battles, the team and the starter choice put up. */
export type BattleOverlay = 'battle' | 'team' | 'starter' | 'learn';

export type BattlesOptions = {
  /** The game, made after this, since the game needs the battle scene. */
  game(): Game;
  language(): Language;
  toast(id: StringId, kind?: ToastKind): void;
  /** Which overlay is up changed, so the page shows another screen and input may change. */
  changed(): void;
  /** A battle started: whatever the player was doing with their courier stops. */
  battleStarted(): void;
  /** The map and your own courier's tile on it, as the server last said, once both are known. */
  standing(): { map: WorldMap; tile: Point } | null;
};

export type Battles = {
  readonly scene: BattleScene;
  /** Listens to a joined room. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** Called every frame. */
  frame(now: number): void;
  overlay(): BattleOverlay | null;
  /** Forgets every battle and team, as when the player leaves the world. */
  reset(): void;
  snapshot(now: number): { battle: TestBattle | null; progress: ProgressMessage | null; storage: StorageMessage | null; teamScreen: TestTeamScreen | null; starterChosen: string | null; learning: LearnState | null };
};

/**
 * Everything about creatures in the page: the messages from the server, the battle model, the
 * Phaser battle field, and the battle, team, starter and move-learning screens over the world.
 */
export function createBattles(options: BattlesOptions): Battles {
  const model = createBattleModel();
  let link: BattleLink | null = null;
  let overlay: BattleOverlay | null = null;

  const send = (message: ClientMessage) => {
    if (!link) return;
    model.sent();
    link.send(message);
  };

  const teamButton = element<HTMLButtonElement>('.team-button');
  const battleScreen = createBattleScreen(element<HTMLElement>('#battle'), {
    language: options.language,
    progress: () => model.progress(),
    send,
    pick: (picker) => model.pick(picker),
    skip: () => model.skip(),
    close: () => model.close(),
  });
  const team = createTeamScreen(element<HTMLElement>('#team'), {
    language: options.language,
    progress: () => model.progress(),
    storage: () => model.storage(),
    send: (message) => link?.send(message),
    closed: () => update(),
  });
  const starter = createStarterScreen(element<HTMLElement>('#starter'), { language: options.language, send: (message) => link?.send(message) });
  // A move a level up offers is asked about once the battle screen is put away.
  const learn = createLearnModel();
  const learnPrompt = createLearnPrompt(element<HTMLElement>('#learn'), {
    language: options.language,
    answer: (forget) => {
      const message = learn.answer(forget);
      if (message) link?.send(message);
      update();
    },
  });
  const scene = new BattleScene({ state: (now) => model.battle(now), field: () => battleScreen.field() });

  teamButton.addEventListener('click', () => {
    if (overlay !== null) return;
    team.open();
    update();
  });

  function receive(message: ServerMessage) {
    model.receive(message, performance.now());
    learn.receive(message);
    if (message.type === SERVER_MESSAGES.refused) options.toast(`refused.${message.payload.reason}`);
    if (message.type === SERVER_MESSAGES.storage) options.toast('shrine.rested', 'news');
  }

  function update(now = performance.now()) {
    const battle = model.battle(now);
    const progress = model.progress();
    const offer = battle ? null : learn.current();
    if (battle || offer) team.close();
    starter.render(battle ? null : progress);
    battleScreen.render(battle);
    learnPrompt.render(offer);
    team.render();
    teamButton.hidden = battle !== null || offer !== null || (progress?.team.length ?? 0) === 0;
    teamButton.setAttribute('aria-label', text('team.title', options.language()));
    const running = options.game().scene.isActive(BATTLE_SCENE);
    if (battle && !running) {
      options.game().scene.run(BATTLE_SCENE);
      options.battleStarted();
    } else if (!battle && running) options.game().scene.stop(BATTLE_SCENE);
    const next: BattleOverlay | null = battle ? 'battle' : offer ? 'learn' : starter.isOpen() ? 'starter' : team.isOpen() ? 'team' : null;
    if (next !== overlay) {
      overlay = next;
      options.changed();
    }
  }

  return {
    scene,
    joined: (room) => {
      const roomSide = roomLink(room);
      link = roomSide;
      const stop = roomSide.listen(receive);
      return () => {
        stop();
        if (link === roomSide) link = null;
      };
    },
    frame: (now) => {
      const standing = options.standing();
      if (standing) model.standingAt(standing.map, standing.tile);
      update(now);
    },
    overlay: () => overlay,
    reset: () => {
      model.reset();
      learn.reset();
      team.close();
      update();
    },
    snapshot: (now) => {
      const state = model.battle(now);
      const language = options.language();
      const battle: TestBattle | null = state && {
        id: state.view.id,
        phase: state.view.phase,
        turn: state.view.turn,
        weather: state.shown.weather,
        playing: state.playing,
        panel: state.panel,
        waiting: state.waiting,
        line: state.line?.id ?? null,
        lineText: state.line ? lineText(state.line, state.view, language) : null,
        menu: state.menu,
        mustSwap: state.view.mustSwap,
        team: state.view.team.creatures.map(({ species, level, hp, maxHp }) => ({ species, level, hp, maxHp })),
        active: state.view.team.active,
        opponent: state.view.opponent.creatures.map(({ species, level, hp, maxHp }) => ({ species, level, hp, maxHp }))[0] ?? null,
        drawn: scene.drawn(),
        outcome: state.result?.outcome ?? null,
        rewards: state.result?.rewards ?? [],
        learned: state.result?.learned ?? [],
        woke: state.result?.woke ?? null,
        befriended: state.befriended && { species: state.befriended.species, placedIn: state.befriended.placedIn },
      };
      return { battle, progress: model.progress(), storage: model.storage(), teamScreen: team.isOpen() ? team.state() : null, starterChosen: starter.chosen(), learning: learn.current() };
    },
  };
}
