import type { Language, LoginResponse, StringId } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import { logout } from './api.ts';
import { connect, type ConnectionStatus, type WorldConnection } from './connection.ts';
import { element } from './dom.ts';
import { createHud } from './hud.ts';
import { ISLAND_SCENE, IslandScene } from './island-scene.ts';
import { initialLanguage, otherLanguage, saveLanguage } from './language.ts';
import { createProfileScreen } from './profile-screen.ts';
import { forgetSession, saveSession, storedSession } from './session.ts';
import { createSettings } from './settings.ts';
import { installTestHook, type Screen } from './test-hook.ts';
import { integerView } from './zoom.ts';

let language: Language = initialLanguage();
let session = storedSession();
let inWorld = false;
let world: WorldConnection | null = null;
let connection: ConnectionStatus | null = null;
let settled = false;
let protocol: number | null = null;
let playerCount: number | null = null;

const hud = createHud(language);
const settings = createSettings(language, {
  onLanguage: () => setLanguage(otherLanguage(language)),
  onSwitchPlayer: () => void switchPlayer(),
});
const profiles = createProfileScreen(element<HTMLElement>('#profiles'), {
  language: () => language,
  signedIn: (login: LoginResponse) => {
    saveSession(login);
    session = storedSession();
    enterWorld();
  },
});

function setLanguage(next: Language) {
  language = next;
  saveLanguage(next);
  hud.setLanguage(next);
  settings.setLanguage(next);
  profiles.setLanguage(next);
}

function setInWorld(next: boolean) {
  inWorld = next;
  document.body.dataset.screen = next ? 'world' : 'profiles';
  settings.setSignedIn(next);
}

async function leaveWorld() {
  const leaving = world;
  world = null;
  connection = null;
  await leaving?.leave();
}

function showProfiles(notice: StringId | null) {
  setInWorld(false);
  hud.setWelcome(undefined);
  profiles.show(notice);
}

/** A session that no longer works is forgotten, and the profile screen says why. */
function sessionEnded(notice: StringId) {
  void leaveWorld();
  forgetSession();
  session = null;
  showProfiles(notice);
}

function enterWorld() {
  if (!session) {
    showProfiles(null);
    return;
  }
  profiles.hide();
  setInWorld(true);
  settled = false;
  protocol = null;
  playerCount = null;
  world = connect(session.token, () => language, {
    status: (status) => {
      connection = status;
      if (status !== 'connecting') settled = true;
      hud.setStatus(status);
      if (status === 'signedOut') sessionEnded('connection.signedOut');
      else if (status === 'replaced') sessionEnded('connection.replaced');
    },
    welcome: (welcome) => {
      protocol = welcome.protocol;
      hud.setWelcome(welcome);
    },
    players: (count) => {
      playerCount = count;
    },
    room: () => {},
  });
}

async function switchPlayer() {
  const ending = session;
  await leaveWorld();
  forgetSession();
  session = null;
  if (ending) await logout(ending.token);
  showProfiles(null);
}

const view = integerView(window.innerWidth, window.innerHeight);
const game = new Game({
  type: AUTO,
  parent: 'world',
  pixelArt: true,
  backgroundColor: '#8fd3ff',
  banner: false,
  // Nothing may ever play sound unasked, and there is no sound yet.
  audio: { noAudio: true },
  scale: { mode: Scale.NONE, width: view.width, height: view.height, zoom: view.zoom },
  scene: [IslandScene],
});

window.addEventListener('resize', () => {
  const next = integerView(window.innerWidth, window.innerHeight);
  game.scale.setZoom(next.zoom);
  game.scale.resize(next.width, next.height);
});

// A device that signed in before goes straight back into the world.
if (session) enterWorld();
else showProfiles(null);

const screen = (): Screen => (inWorld ? 'world' : profiles.state().view);
const drawn = () => game.scene.getScene<IslandScene>(ISLAND_SCENE)?.drawn === true;

installTestHook(
  () => {
    const shown = profiles.state();
    return {
      screen: screen(),
      connection,
      language,
      protocol,
      playerCount,
      scene: game.scene.getScenes(true)[0]?.scene.key ?? null,
      profile: session?.profile ?? null,
      profiles: shown.profiles,
      notice: inWorld ? null : shown.notice,
      pinFor: shown.pinFor,
      pinDigits: shown.pinDigits,
      settingsOpen: settings.isOpen(),
    };
  },
  () => {
    if (!drawn()) return false;
    if (inWorld) return settled && (connection !== 'connected' || protocol !== null);
    const shown = profiles.state();
    return shown.view !== 'loading' && !shown.busy;
  },
);
