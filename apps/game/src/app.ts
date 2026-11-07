import { WorldSettings, samePoint, walkMessage, type Language, type LoginResponse, type Point, type StringId } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import worldSettings from '../../../content/world.json';
import { addPin, listProfiles, logout } from './api.ts';
import { createBattles } from './battles.ts';
import { connect, type ConnectionStatus, type WorldConnection, type WorldRoom } from './connection.ts';
import { initialControls, otherControls, saveControls, type Controls } from './controls-choice.ts';
import { element } from './dom.ts';
import { createHud } from './hud.ts';
import { createInput } from './input.ts';
import { initialLanguage, otherLanguage, saveLanguage } from './language.ts';
import { loadMap } from './map-loader.ts';
import { createNameTags } from './names.ts';
import { createOutbox } from './outbox.ts';
import { createPinSetup } from './pin-setup.ts';
import { createProfileScreen } from './profile-screen.ts';
import { forgetSession, saveSession, storedSession, type StoredSession } from './session.ts';
import type { Command } from './self-walker.ts';
import { createSettings } from './settings.ts';
import { talkControls } from './talk-controls.ts';
import { createTalkHint } from './talk-hint.ts';
import { createTalks } from './talks.ts';
import { createWalkHint } from './walk-hint.ts';
import { installTestHook, type Screen, type TestPlayer } from './test-hook.ts';
import { feedWorldView } from './world-feed.ts';
import { WorldScene } from './world-scene.ts';
import { createWorldView } from './world-view.ts';
import { integerView } from './zoom.ts';

/** Shown behind the profile screens, before the server has said which map the player is on. */
const START_MAP = WorldSettings.parse(worldSettings).startMap;

let language: Language = initialLanguage();
let controls: Controls = initialControls();
let room: WorldRoom | null = null;
let session = storedSession();
let inWorld = false;
let world: WorldConnection | null = null;
let connection: ConnectionStatus | null = null;
let settled = false;
let protocol: number | null = null;
let playerCount: number | null = null;
let roomMap: string | null = null;
let mapFailed = false;
/** Whether the signed-in profile is known to have no PIN yet, so the settings offer to add one. */
let canAddPin = false;
let stopFeed: () => void = () => {};
let stopBattles: () => void = () => {};
let stopTalks: () => void = () => {};

const view = createWorldView();
const names = createNameTags(element<HTMLElement>('#names'));
const scene = new WorldScene({
  view,
  frame: (now) => frame(now),
  labels: (labels) => names.place(inWorld ? labels : []),
  npcLook: (npc, at) => talks.look(npc, at, view.predicted()?.tile ?? null),
});
const hud = createHud(language);
const battles = createBattles({
  game: () => game,
  language: () => language,
  toast: (id, kind) => hud.toast(id, kind),
  changed: () => {
    input.release();
    showScreen();
  },
  battleStarted: () => startClean(),
  standing: () => view.standing(),
  starterOffered: () => talks.offersStarter(),
});
const talks = createTalks({
  language: () => language,
  progress: () => battles.progress(),
  changed: () => {
    input.release();
    if (scene.mapId !== null) scene.setMarker(null);
    showScreen();
  },
});
const hint = createWalkHint(element<HTMLElement>('.walk-hint'));
const talkHint = createTalkHint(element<HTMLElement>('.talk-hint'));
const settings = createSettings(language, controls, {
  onLanguage: () => setLanguage(otherLanguage(language)),
  onControls: () => setControls(otherControls(controls)),
  onAddPin: () => {
    pinSetup.open();
    showScreen();
  },
  onSwitchPlayer: () => void switchPlayer(),
});
const pinSetup = createPinSetup(element<HTMLElement>('#pin-setup'), {
  language: () => language,
  submit: async (pin) => {
    if (!session) return 'signedOut';
    const added = await addPin(session.token, pin);
    if (added.ok) setCanAddPin(false);
    return added.ok ? null : added.error;
  },
  ended: (end) => {
    showScreen();
    if (end === 'signedOut') sessionEnded('connection.signedOut');
    else if (end === 'hasPin') {
      setCanAddPin(false);
      hud.toast('profile.error.hasPin');
    }
  },
});
const profiles = createProfileScreen(element<HTMLElement>('#profiles'), {
  language: () => language,
  signedIn: (login: LoginResponse) => {
    saveSession(login);
    session = storedSession();
    enterWorld();
  },
});

/** A command reaches the server only when the prediction accepts it too, so the two agree. */
function deliver(command: Command) {
  if (connection !== 'connected') return;
  const from = room ? view.command(command) : null;
  if (!room || !from) return;
  const message = walkMessage(command, from);
  room.send(message.type, message.payload);
  if (command.kind !== 'stop') hint.walked();
}

const outbox = createOutbox({
  deliver,
  now: () => performance.now(),
  later: (run, ms) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
});

const input = createInput({
  surface: element<HTMLElement>('#world'),
  joystick: { base: element<HTMLElement>('.joystick'), knob: element<HTMLElement>('.joystick-knob') },
  outbox,
  controls: () => controls,
  active: () => inWorld && room !== null && connection === 'connected' && !settings.isOpen() && !pinSetup.isOpen() && battles.overlay() === null && !talks.isOpen(),
  screenToTile: (x, y) => scene.screenToTile(x, y),
  canReach: (tile) => view.canReach(tile),
  marker: (tile, refused) => {
    scene.setMarker(tile, refused);
    if (refused) hud.toast('walk.blocked');
  },
  ...talkControls(view, talks),
});

/** Where the new player's hint points: at the character who gives the first creature, while nothing else is up. */
function talkHintSpot(): { npc: string; at: Point } | null {
  const npc = talks.starterNpc();
  if (npc === null || !inWorld || connection !== 'connected' || settings.isOpen() || pinSetup.isOpen() || battles.overlay() !== null || talks.isOpen()) return null;
  const at = scene.npcOnScreen(npc);
  return at ? { npc, at } : null;
}

function frame(now: number) {
  view.tick(now);
  battles.frame(now);
  talks.frame(now);
  input.frame();
  if (inWorld && playerCount !== null) hud.setCompany(playerCount > 1 || view.others() > 0);
  const pointing = talkHintSpot();
  talkHint.update(pointing?.at ?? null);
  // A new player is shown whom to tap first; the walking hint waits until then.
  hint.update(inWorld && connection === 'connected' && view.predicted() !== null && !settings.isOpen() && !pinSetup.isOpen() && battles.overlay() === null && !talks.isOpen() && pointing === null, controls);
  const predicted = view.predicted();
  const marked = scene.markerTile;
  if (marked && predicted && predicted.intent === 'idle' && !predicted.moving && samePoint(predicted.tile, marked)) scene.setMarker(null);
}

function setControls(next: Controls) {
  controls = next;
  saveControls(next);
  input.release();
  settings.setControls(next);
}

function setLanguage(next: Language) {
  language = next;
  saveLanguage(next);
  hud.setLanguage(next);
  settings.setLanguage(next);
  profiles.setLanguage(next);
  pinSetup.setLanguage(next);
}

function showScreen() {
  document.body.dataset.screen = !inWorld ? 'profiles' : pinSetup.isOpen() ? 'pinSetup' : (battles.overlay() ?? 'world');
}

function setCanAddPin(next: boolean) {
  canAddPin = next;
  settings.setCanAddPin(next);
}

/** The stored session does not say whether the profile has a PIN, so the list is asked. */
async function learnPin(signedIn: StoredSession) {
  const id = signedIn.profile?.id;
  if (id === undefined) return;
  const listed = await listProfiles();
  if (!listed.ok || session?.token !== signedIn.token) return;
  setCanAddPin(listed.value.find((profile) => profile.id === id)?.hasPin === false);
}

function setInWorld(next: boolean) {
  inWorld = next;
  if (!next) {
    pinSetup.close();
    setCanAddPin(false);
  }
  showScreen();
  settings.setSignedIn(next);
}

async function showMap(id: string) {
  try {
    const map = await loadMap(id);
    await scene.booted;
    await scene.showMap(map);
    if (id === roomMap) view.setMap(map.world);
    mapFailed = false;
  } catch {
    // The badge or the profile screen already says when the server cannot be reached; the next
    // join asks for the map again.
    mapFailed = true;
  }
}

/**
 * Whatever the page was doing with your courier is dropped: held keys, anything waiting to be sent,
 * the prediction and the marker. Done when a drop begins and again when it ends, so a tap from
 * before or during a drop never sets the courier walking later.
 */
function startClean() {
  input.release();
  outbox.reset();
  view.restart();
  if (scene.mapId !== null) scene.setMarker(null);
}

function forgetRoom() {
  stopFeed();
  stopFeed = () => {};
  stopBattles();
  stopBattles = () => {};
  stopTalks();
  stopTalks = () => {};
  room = null;
  input.release();
  outbox.reset();
  view.reset();
  if (scene.mapId !== null) scene.setMarker(null);
  roomMap = null;
}

async function leaveWorld() {
  const leaving = world;
  world = null;
  connection = null;
  forgetRoom();
  battles.reset();
  talks.reset();
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
  void learnPin(session);
  settled = false;
  protocol = null;
  playerCount = null;
  world = connect(session.token, () => language, {
    status: (status) => {
      const was = connection;
      connection = status;
      if (status !== 'connecting') settled = true;
      // A drop stands the courier still on the server, so after a reconnect what the outbox last
      // sent no longer holds: the same walk asked again is a new request, not a repeat to swallow.
      if (status !== was) startClean();
      hud.setStatus(status);
      if (status === 'signedOut') sessionEnded('connection.signedOut');
      else if (status === 'replaced') sessionEnded('profile.takenOver');
    },
    welcome: (welcome) => {
      protocol = welcome.protocol;
      hud.setWelcome(welcome);
    },
    players: (count) => {
      playerCount = count;
    },
    room: (joined) => {
      forgetRoom();
      // The count comes from the room's state alone. `welcome` carries the count from when the
      // server seated this page, but it arrives after the state, which another player joining in
      // between may already have raised: taking it would set the count back for good.
      playerCount = null;
      room = joined;
      stopBattles = battles.joined(joined);
      stopTalks = talks.joined(joined);
      stopFeed = feedWorldView(joined, view, {
        map: (id) => {
          roomMap = id;
          void showMap(id);
        },
        refused: () => {
          scene.setMarker(null);
          hud.toast('walk.blocked');
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
  scene: [scene, battles.scene],
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

const screen = (): Screen => (!inWorld ? profiles.state().view : pinSetup.isOpen() ? 'pinSetup' : (battles.overlay() ?? 'world'));
const round = (value: number) => Math.round(value * 100) / 100;
const players = (): TestPlayer[] =>
  view.shown(performance.now()).map((player) => ({
    name: player.name,
    avatar: player.avatar,
    self: player.self,
    connected: player.connected,
    inBattle: player.inBattle,
    talking: player.talking,
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
    const adding = pinSetup.state();
    return {
      screen: screen(),
      connection,
      language,
      protocol,
      playerCount,
      welcome: hud.state().welcome,
      toast: hud.state().toast,
      hint: hint.shown(),
      talkHint: talkHint.shown() ? talks.starterNpc() : null,
      npcs: scene.drawnNpcs(),
      talk: talks.snapshot(performance.now()),
      scene: game.scene.getScenes(true)[0]?.scene.key ?? null,
      map: scene.mapId,
      players: players(),
      tags: names.boxes().map(({ name, x, y, width, height }) => ({ name, x: round(x), y: round(y), width: round(width), height: round(height) })),
      controls,
      marker: scene.markerTile,
      predicted: view.predicted(),
      input: input.state(),
      profile: session?.profile ?? null,
      profiles: shown.profiles,
      notice: inWorld ? adding.notice : shown.notice,
      pinFor: shown.pinFor,
      pinDigits: inWorld ? adding.pinDigits : shown.pinDigits,
      pinStep: adding.step,
      canAddPin,
      settingsOpen: settings.isOpen(),
      ...battles.snapshot(performance.now()),
    };
  },
  isReady: () => {
    if (inWorld) return settled && !pinSetup.state().busy && (connection !== 'connected' || (protocol !== null && (worldDrawn() || mapFailed)));
    const shown = profiles.state();
    return shown.view !== 'loading' && !shown.busy && (scene.mapId !== null || mapFailed);
  },
  tileToScreen: (x, y) => (scene.mapId === null ? null : scene.tileToScreen(x, y)),
});
