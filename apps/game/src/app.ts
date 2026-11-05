import { WorldSettings, type Language, type LoginResponse, type StringId } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import worldSettings from '../../../content/world.json';
import { logout } from './api.ts';
import { connect, type ConnectionStatus, type WorldConnection } from './connection.ts';
import { element } from './dom.ts';
import { createHud } from './hud.ts';
import { initialLanguage, otherLanguage, saveLanguage } from './language.ts';
import { loadMap } from './map-loader.ts';
import { createNameTags } from './names.ts';
import { createProfileScreen } from './profile-screen.ts';
import { forgetSession, saveSession, storedSession } from './session.ts';
import { createSettings } from './settings.ts';
import { installTestHook, type Screen, type TestPlayer } from './test-hook.ts';
import { feedWorldView } from './world-feed.ts';
import { WorldScene } from './world-scene.ts';
import { createWorldView } from './world-view.ts';
import { integerView } from './zoom.ts';

/** Shown behind the profile screens, before the server has said which map the player is on. */
const START_MAP = WorldSettings.parse(worldSettings).startMap;

let language: Language = initialLanguage();
let session = storedSession();
let inWorld = false;
let world: WorldConnection | null = null;
let connection: ConnectionStatus | null = null;
let settled = false;
let protocol: number | null = null;
let playerCount: number | null = null;
let roomMap: string | null = null;
let mapFailed = false;
let stopFeed: () => void = () => {};

const view = createWorldView();
const names = createNameTags(element<HTMLElement>('#names'));
const scene = new WorldScene({ view, labels: (labels) => names.place(inWorld ? labels : []) });
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

async function showMap(id: string) {
  try {
    const map = await loadMap(id);
    await scene.booted;
    await scene.showMap(map);
    mapFailed = false;
  } catch {
    // The badge or the profile screen already says when the server cannot be reached; the next
    // join asks for the map again.
    mapFailed = true;
  }
}

function forgetRoom() {
  stopFeed();
  stopFeed = () => {};
  view.reset();
  roomMap = null;
}

async function leaveWorld() {
  const leaving = world;
  world = null;
  connection = null;
  forgetRoom();
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
    room: (room) => {
      forgetRoom();
      stopFeed = feedWorldView(room, view, {
        map: (id) => {
          roomMap = id;
          void showMap(id);
        },
      });
    },
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

const initialView = integerView(window.innerWidth, window.innerHeight);
const game = new Game({
  type: AUTO,
  parent: 'world',
  pixelArt: true,
  backgroundColor: '#8fd3ff',
  banner: false,
  // Nothing may ever play sound unasked, and there is no sound yet.
  audio: { noAudio: true },
  scale: { mode: Scale.NONE, width: initialView.width, height: initialView.height, zoom: initialView.zoom },
  scene: [scene],
});

window.addEventListener('resize', () => {
  const next = integerView(window.innerWidth, window.innerHeight);
  game.scale.setZoom(next.zoom);
  game.scale.resize(next.width, next.height);
});

void showMap(START_MAP);
// A device that signed in before goes straight back into the world.
if (session) enterWorld();
else showProfiles(null);

const screen = (): Screen => (inWorld ? 'world' : profiles.state().view);
const round = (value: number) => Math.round(value * 100) / 100;
const players = (): TestPlayer[] =>
  view.shown(performance.now()).map((player) => ({
    name: player.name,
    avatar: player.avatar,
    self: player.self,
    connected: player.connected,
    x: player.tile.x,
    y: player.tile.y,
    moving: player.moving,
    facing: player.facing,
    drawn: { x: round(player.at.x), y: round(player.at.y) },
    walking: player.walking,
  }));
const worldDrawn = () => roomMap !== null && scene.mapId === roomMap && view.shown(performance.now()).some((player) => player.self);

installTestHook({
  snapshot: () => {
    const shown = profiles.state();
    return {
      screen: screen(),
      connection,
      language,
      protocol,
      playerCount,
      scene: game.scene.getScenes(true)[0]?.scene.key ?? null,
      map: scene.mapId,
      players: players(),
      profile: session?.profile ?? null,
      profiles: shown.profiles,
      notice: inWorld ? null : shown.notice,
      pinFor: shown.pinFor,
      pinDigits: shown.pinDigits,
      settingsOpen: settings.isOpen(),
    };
  },
  isReady: () => {
    if (inWorld) return settled && (connection !== 'connected' || (protocol !== null && (worldDrawn() || mapFailed)));
    const shown = profiles.state();
    return shown.view !== 'loading' && !shown.busy && (scene.mapId !== null || mapFailed);
  },
  tileToScreen: (x, y) => (scene.mapId === null ? null : scene.tileToScreen(x, y)),
});
