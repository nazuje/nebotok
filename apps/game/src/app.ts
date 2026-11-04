import type { Language } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import { connect, type ConnectionStatus } from './connection.ts';
import { createHud } from './hud.ts';
import { ISLAND_SCENE, IslandScene } from './island-scene.ts';
import { initialLanguage, saveLanguage } from './language.ts';
import { installTestHook } from './test-hook.ts';
import { integerView } from './zoom.ts';

let language: Language = initialLanguage();
let connection: ConnectionStatus = 'connecting';
let settled = false;
let protocol: number | null = null;
let playerCount: number | null = null;

const hud = createHud(language, (next) => {
  language = next;
  saveLanguage(next);
  hud.setLanguage(next);
});

const view = integerView(window.innerWidth, window.innerHeight);
const game = new Game({
  type: AUTO,
  parent: 'world',
  pixelArt: true,
  backgroundColor: '#8fd3ff',
  banner: false,
  // Phase 0 has no sound, and nothing may ever play sound unasked.
  audio: { noAudio: true },
  scale: { mode: Scale.NONE, width: view.width, height: view.height, zoom: view.zoom },
  scene: [IslandScene],
});

window.addEventListener('resize', () => {
  const next = integerView(window.innerWidth, window.innerHeight);
  game.scale.setZoom(next.zoom);
  game.scale.resize(next.width, next.height);
});

connect({
  status: (status) => {
    connection = status;
    if (status !== 'connecting') settled = true;
    hud.setStatus(status);
  },
  welcome: (welcome) => {
    protocol = welcome.protocol;
    hud.setWelcome(welcome);
  },
  players: (count) => {
    playerCount = count;
  },
});

installTestHook(
  () => ({
    connection,
    language,
    protocol,
    playerCount,
    scene: game.scene.getScenes(true)[0]?.scene.key ?? null,
  }),
  () => game.scene.getScene<IslandScene>(ISLAND_SCENE)?.drawn === true && settled && (connection !== 'connected' || protocol !== null),
);
