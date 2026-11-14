import { SERVER_MESSAGES, battleStep, battleView, createRng, greedyPolicy, startBattle, type BattleAction, type BattleEvent, type BattleState, type Language } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import { CONTENT } from '../battle-content.ts';
import type { ClientMessage, ServerMessage } from '../battle-link.ts';
import { createBattleModel } from '../battle-model.ts';
import { BATTLE_SCENE, BattleScene } from '../battle-scene.ts';
import { createBattleScreen, lineText } from '../battle-screen.ts';
import { el } from '../dom.ts';
import { integerView } from '../zoom.ts';
import { newBattleButton } from './prototype-log.ts';
import { setupOf } from './prototype-sim.ts';

/** How long the stand-in server takes to answer, so the menu waits the way it does online. */
const FAKE_SERVER_MS = 120;
const BATTLE_ID = 'prototype';

function actionOf(message: ClientMessage): BattleAction | null {
  switch (message.type) {
    case 'battle.move':
      return { kind: 'move', slot: message.payload.slot };
    case 'battle.run':
      return { kind: 'run' };
    case 'battle.treat':
      return { kind: 'treat', item: message.payload.itemId };
    default:
      return null;
  }
}

/**
 * Variant 0: today's battle, drawn by the game's own battle model, screen and Phaser scene, with
 * core's battle engine standing in for the server and the greedy bot playing the wild side.
 */
export function mountToday(root: HTMLElement, options: { seed: number; language: Language; newBattle(): void }): void {
  const setup = setupOf(options.seed);
  const rng = createRng(`prototype-today:${options.seed}`);
  const botRng = createRng(`prototype-today-bot:${options.seed}`);
  const started = startBattle(
    {
      sides: [{ creatures: [{ species: setup.species[0], level: setup.level }] }, { creatures: [{ species: setup.species[1], level: setup.level }] }],
      weather: setup.weather,
      wild: true,
    },
    CONTENT,
  );
  let state: BattleState = started.state;
  const language = options.language;
  const model = createBattleModel((line, view) => lineText(line, view, language).length);
  const world = el('div', { attrs: { id: 'world', 'aria-hidden': 'true' } });
  const section = el('section', { className: 'battle', attrs: { id: 'battle' } });
  const top = el('div', { className: 'proto-top today' }, [newBattleButton(options.newBattle)]);
  root.append(world, section, top);
  document.body.dataset.screen = 'battle';

  const deliver = (message: ServerMessage) => model.receive(message, performance.now());
  const answer = (events: readonly BattleEvent[]) => {
    deliver({ type: SERVER_MESSAGES.battleTurn, payload: { battle: battleView(BATTLE_ID, state), events } });
    if (state.outcome) deliver({ type: SERVER_MESSAGES.battleResult, payload: { battle: BATTLE_ID, outcome: state.outcome, rewards: [], learned: [], woke: null } });
  };
  const send = (message: ClientMessage) => {
    const mine = actionOf(message);
    if (!mine) return;
    model.sent(performance.now());
    setTimeout(() => {
      const theirs = state.phase === 'choose' ? greedyPolicy(state, 1, botRng, CONTENT) : null;
      const step = battleStep(state, [mine, theirs], rng, CONTENT);
      state = step.state;
      answer(step.events);
    }, FAKE_SERVER_MS);
  };
  const screen = createBattleScreen(section, {
    language: () => language,
    progress: () => null,
    send,
    pick: (picker) => model.pick(picker),
    advance: () => model.advance(performance.now()),
    close: () => {
      model.close();
      options.newBattle();
    },
  });
  const scene = new BattleScene({ state: (now) => model.battle(now), field: () => screen.field() });
  const view = integerView(window.innerWidth, window.innerHeight);
  const game = new Game({
    type: AUTO,
    parent: world,
    pixelArt: true,
    backgroundColor: '#8fd3ff',
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Scale.NONE, width: view.width, height: view.height, zoom: view.zoom },
    scene: [scene],
  });
  window.addEventListener('resize', () => {
    const next = integerView(window.innerWidth, window.innerHeight);
    game.scale.setZoom(next.zoom);
    game.scale.resize(next.width, next.height);
  });
  deliver({ type: SERVER_MESSAGES.battleStarted, payload: { battle: battleView(BATTLE_ID, state), events: started.events } });
  game.events.once('ready', () => game.scene.run(BATTLE_SCENE));
  const frame = () => {
    const battle = model.battle(performance.now());
    screen.render(battle);
    document.body.dataset.turn = battle?.playing ? 'playing' : 'idle';
    requestAnimationFrame(frame);
  };
  frame();
  Object.assign(window, { __prototype: { game, model } });
}
