import type { BattleOutcome, BattleView, CreatureReward, Direction, Language, LearnedMove, Point, ProgressMessage, StorageMessage, StringId, WakePoint, WelcomeMessageKey } from '@nebotok/core';
import type { ArenaOverlay, TestArena } from './arena/arena-link.ts';
import type { BattleScreenState, Menu } from './battle-model.ts';
import type { BattleDrawn } from './battle-scene.ts';
import type { BattleOverlay } from './battles.ts';
import type { ConnectionStatus } from './connection.ts';
import type { TestVoice } from './clip-player.ts';
import type { TestSounds } from './sound.ts';
import type { Controls } from './controls-choice.ts';
import type { DuelOverlay, TestDuel } from './duels.ts';
import type { Input } from './input.ts';
import type { JobsOverlay, TestJobs } from './jobs-link.ts';
import type { LearnState } from './learn-prompt.ts';
import type { LoadoutPickerState } from './loadout-picker.ts';
import type { NewMove } from './new-move-toast.ts';
import type { TagBox } from './names.ts';
import type { SkillOverlay, TestSkills } from './skills-link.ts';
import type { StoryOverlay, TestStory } from './story-link.ts';
import type { TestTalk } from './talks.ts';
import type { TeamTab } from './team-screen.ts';
import type { TestStorm } from './storm-cue.ts';
import type { DrawnNpc, DrawnSpot } from './world-scene.ts';
import type { WorldView } from './world-view.ts';
import type { PinSetupState } from './pin-setup.ts';
import type { ProfileScreenState, ProfileView } from './profile-screen.ts';

export type Screen = ProfileView | 'world' | 'pinSetup' | ArenaOverlay | BattleOverlay | DuelOverlay | StoryOverlay | SkillOverlay | JobsOverlay;

type TestCreature = { species: string; level: number; hp: number; maxHp: number };

/** The battle on screen: the server's view of it, and what the page shows of it right now. */
export type TestBattle = {
  id: string;
  phase: BattleView['phase'];
  turn: number;
  /** The weather the field shows now, part way through a turn's playback. */
  weather: string | null;
  /** A turn is playing; a tap moves on to its next line, a second quick tap to its end. */
  playing: boolean;
  panel: BattleScreenState['panel'];
  /** A choice was sent and the server has not answered. */
  waiting: boolean;
  line: StringId | null;
  lineText: string | null;
  menu: Menu;
  mustSwap: boolean;
  team: TestCreature[];
  active: number;
  opponent: TestCreature | null;
  /** The species the Phaser field drew last frame, yours then the wild one, and its background sprite. */
  drawn: BattleDrawn | null;
  outcome: BattleOutcome | null;
  rewards: readonly CreatureReward[];
  learned: readonly LearnedMove[];
  woke: WakePoint | null;
  befriended: { species: string; placedIn: 'team' | 'storage' } | null;
};

export type TestTeamScreen = { selected: number | null; tab: TeamTab; swapHint: boolean };

/** A player as the server last told this page, and where the page draws them. */
export type TestPlayer = {
  name: string;
  avatar: string;
  self: boolean;
  connected: boolean;
  /** In a battle, so the world marks them. */
  inBattle: boolean;
  /** Fighting a duel: the world shows the duel mark, which others tap to watch. */
  duelling: boolean;
  /** Watching a duel, standing still. */
  watching: boolean;
  /** Wearing the trophy of a duel won a short while ago. */
  trophy: boolean;
  /** Talking to a character, so the world shows a speech mark on their name. */
  talking: boolean;
  /** The skill they are doing, or `''`: the world draws its action beside them. */
  skill: string;
  x: number;
  y: number;
  moving: boolean;
  facing: Direction;
  /** In tiles, between two tiles while a step is drawn. */
  drawn: Point;
  walking: boolean;
};

export type TestSnapshot = TestStory &
  TestSkills &
  TestJobs & {
  /** The gathering spots on the map, and whether each shows resting for you. */
  spots: DrawnSpot[];
  /** The tile the camera went to show for "Where next?", while it shows it. */
  looking: Point | null;
  /** Which screen is up: the profile list, the new-player form, the PIN pad, the world, or adding a PIN over it. */
  screen: Screen;
  connection: ConnectionStatus | null;
  language: Language;
  protocol: number | null;
  playerCount: number | null;
  /** The welcome line shown at the bottom, if any. */
  welcome: WelcomeMessageKey | null;
  /** The short message shown at the bottom, such as refused.tooFar, if any. */
  toast: StringId | null;
  /** The sprite shown beside that message, if any. */
  toastPicture: string | null;
  /** The first-visit walking hint, for the controls it shows, if it is up. */
  hint: Controls | null;
  /** The character the new player's hint points at, if it is up. */
  talkHint: string | null;
  /** The characters on the map, the way each faces and the mark over their head. */
  npcs: DrawnNpc[];
  /** The talk box, if a talk is open. */
  talk: TestTalk | null;
  /** The story cue playing, how many have played, and whether the storm band shows. */
  storm: TestStorm;
  scene: string | null;
  /** The map whose tiles are drawn, if any. */
  map: string | null;
  players: TestPlayer[];
  /** Other players' name tags as placed on the page, in CSS pixels. */
  tags: Omit<TagBox, 'id'>[];
  controls: Controls;
  /** The tile the walk marker shows, if any. */
  marker: Point | null;
  /** The tile the short "can't go there" cross flashes on, while it shows. */
  refusedMarker: Point | null;
  /** The shrine tile the flag of the shrine you wake at stands on, if it is on this map. */
  wakeFlag: Point | null;
  /** Your own courier as this page predicts it, before the server confirms. */
  predicted: ReturnType<WorldView['predicted']>;
  input: ReturnType<Input['state']>;
  /** The profile this device is signed in as, if any. */
  profile: { id: number; name: string; avatar: string } | null;
  profiles: ProfileScreenState['profiles'];
  /** The message the profile screens, or the screen adding a PIN, show (a string id), if any. */
  notice: StringId | null;
  pinFor: ProfileScreenState['pinFor'];
  nameWanted: ProfileScreenState['nameWanted'];
  /** Digits typed on whichever number pad is up. */
  pinDigits: number;
  /** Where adding a PIN from the settings has got to, if it is open. */
  pinStep: PinSetupState['step'];
  /** Whether the settings offer "Add a PIN". */
  canAddPin: boolean;
  settingsOpen: boolean;
  /** "Read to me" (null before the server has said), the last clip asked for and how many have been. */
  voice: TestVoice & { readToMe: boolean | null };
  /** The player's turtle setting, null before the server has said. */
  turtle: boolean | null;
  /** The sounds setting as the page applies it (on until the server says otherwise), whether a tap has let the page make sound, and the last 30 sounds asked for while on. */
  sounds: TestSounds;
  /** The battle on screen, if any. */
  battle: TestBattle | null;
  /** The arena fight on screen, from `arena.join` until Continue on its result, if any. */
  arena: TestArena | null;
  /** The duel card up, if any: the menu, your ask waiting, or an ask to answer. */
  duel: TestDuel | null;
  /** Your creatures, treats and whether you still choose a starter, as the server last sent them. */
  progress: ProgressMessage | null;
  /** The creatures waiting at the shrine the server last said the player rests at, if any. */
  storage: StorageMessage | null;
  /** The team screen, if it is open. */
  teamScreen: TestTeamScreen | null;
  /** The loadout picker, if it is open. */
  loadout: LoadoutPickerState | null;
  /** The move the new-move toast shows, while it shows. */
  newMove: NewMove | null;
  /** The starter chosen and not yet confirmed, if any. */
  starterChosen: string | null;
  /** The move a level up offers and whether the answer is on its way, if one is waiting. */
  learning: LearnState | null;
};

export type TestHook = {
  ready: boolean;
  stateAsText(): string;
  /** Where the centre of a map tile is on the page, in CSS pixels, or null before a map is drawn. */
  tileToScreen(x: number, y: number): Point | null;
};

declare global {
  interface Window {
    __nebotok?: TestHook;
  }
}

export type TestHookSources = {
  snapshot(): TestSnapshot;
  isReady(): boolean;
  tileToScreen(x: number, y: number): Point | null;
};

/** Only with ?test=1 in the URL: a read-only window for automated checks. */
export function installTestHook({ snapshot, isReady, tileToScreen }: TestHookSources): void {
  if (new URLSearchParams(location.search).get('test') !== '1') return;
  const hook: TestHook = {
    get ready() {
      return isReady();
    },
    stateAsText: () => JSON.stringify(snapshot()),
    tileToScreen: (x, y) => tileToScreen(x, y),
  };
  Object.defineProperty(window, '__nebotok', { value: Object.freeze(hook), configurable: false });
}
