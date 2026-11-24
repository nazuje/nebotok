import { nextGoal, SERVER_MESSAGES, type Goal, type Language, type Point, type ProgressMessage, type QuestChanged, type SkillsMessage, type StationKind, type StoryMessage, type WorldMap } from '@nebotok/core';
import { createBagScreen } from './bag-screen.ts';
import type { WorldRoom } from './connection.ts';
import { element } from './dom.ts';
import { createStoryButtons } from './hud.ts';
import { createJournalScreen } from './journal-screen.ts';
import { createQuestToast, questHint, type NewsLines, type NewsPicture, type NewsTone, type QuestToastState } from './quest-toast.ts';
import { speakerButton } from './speaker-button.ts';
import type { SoundPlayer } from './sound.ts';
import type { Speech } from './speech.ts';
import { STORY, storyProgress } from './story-content.ts';
import { text } from './strings.ts';

/** A screen over the world that the bag and the journal put up. */
export type StoryOverlay = 'bag' | 'journal';

export type StoryOptions = {
  language(): Language;
  /** Something else is in front of the world (a battle, the starter, the profile list), so the bag and journal stay shut. */
  blocked(): boolean;
  /** The map and your own courier's tile on it, as the server last said, once both are known. */
  standing(): { map: WorldMap; tile: Point } | null;
  /** The player's skills, as the server last sent them. */
  skills(): SkillsMessage | null;
  /** Shows the player a tile on the map: the compass, and the journal's "Where next?". */
  lookAt(tile: Point): void;
  /** Which overlay is up changed, so the page shows another screen and input may change. */
  changed(): void;
  /** Reads a new quest banner's hint aloud, and again from its speaker button. */
  speech: Speech;
  /** Plays the fanfare of a quest done. */
  sound: Pick<SoundPlayer, 'play'>;
};

export type TestStory = {
  story: StoryMessage | null;
  /** The journal has news the player has not opened it for. */
  journalNews: boolean;
  questToast: QuestToastState | null;
  /** The tile the compass button shows, while it is on screen. */
  compass: Point | null;
  /** The item the bag shows about, if the bag is open. */
  bag: { selected: string | null } | null;
  journal: { unfolded: string[]; goal: Point | null } | null;
};

export type Story = {
  /** Listens to a joined room. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** Called every frame. */
  frame(): void;
  overlay(): StoryOverlay | null;
  /** Forgets the player's story, as when they leave the world. */
  reset(): void;
  /** Shows other news in the quest toast's queue, led by a picture when it has one. */
  news(lines: NewsLines, tone: NewsTone, picture?: NewsPicture): void;
  snapshot(): TestStory;
};

/**
 * The bag, the journal and the quest toasts: the `progress`, `story` and `quest.changed` messages
 * from the server (docs/protocol.md "Talking, quests and the bag"), the two HUD buttons, and the
 * screens they open over the world.
 */
export function createStory(options: StoryOptions): Story {
  let progress: ProgressMessage | null = null;
  let saved: StoryMessage | null = null;
  let overlay: StoryOverlay | null = null;
  let news = false;

  const current = () => (progress ? storyProgress(progress, saved, options.skills()) : null);
  const { speech } = options;
  const toast = createQuestToast(element<HTMLElement>('.quest-toast'), options.language, {
    speaker: (change, language) => {
      const hint = questHint(change, language);
      return hint !== null && speech.has(null, hint) ? speakerButton('quest-speaker', text('speech.play', language), () => speech.say(null, hint)) : null;
    },
    shown: (change, language) => {
      const hint = questHint(change, language);
      if (hint !== null) speech.onHint(hint);
    },
  });
  const close = () => open(null);
  const bag = createBagScreen(element<HTMLElement>('#bag'), { language: options.language, progress: current, closed: close });
  const tileOf = (goal: Goal): Point | null => {
    const standing = options.standing();
    return standing ? goalTile(goal, standing.map, { from: standing.tile, usable: (spot) => spotUsable(spot, options.skills()) }) : null;
  };
  const journal = createJournalScreen(element<HTMLElement>('#journal'), {
    language: options.language,
    progress: () => (saved ? current() : null),
    skills: options.skills,
    goalTile: tileOf,
    whereNext: (tile) => {
      close();
      options.lookAt(tile);
    },
    closed: close,
  });
  // The compass's goal is worked out again only when the story, the skills or where the player stands changed.
  let compassFrom: readonly unknown[] = [];
  let compassTile: Point | null = null;
  function compassGoal(): Point | null {
    const standing = options.standing();
    const from = [progress, saved, options.skills(), standing?.map, standing?.tile.x, standing?.tile.y];
    if (from.length === compassFrom.length && from.every((value, at) => value === compassFrom[at])) return compassTile;
    compassFrom = from;
    const story = saved ? current() : null;
    const goal = story ? nextGoal(story, STORY) : null;
    compassTile = goal ? tileOf(goal) : null;
    return compassTile;
  }
  let compass: Point | null = null;
  const buttons = createStoryButtons({
    bag: () => open('bag'),
    journal: () => open('journal'),
    whereNext: () => {
      if (compass) options.lookAt(compass);
    },
  });

  function open(next: StoryOverlay | null) {
    if (next !== null && (options.blocked() || progress === null)) return;
    // Opening the journal reads the news, so its toasts have said what they had to.
    if (next === 'journal') {
      news = false;
      toast.clear();
    }
    if (next === overlay) return;
    overlay = next;
    if (next === 'bag') bag.open();
    else bag.close();
    if (next === 'journal') journal.open();
    else journal.close();
    options.changed();
  }

  function changedQuest(change: QuestChanged) {
    if (change.change === 'done') options.sound.play('quest.done');
    toast.show(change);
    if (overlay !== 'journal') news = true;
  }

  return {
    joined: (room) => {
      const stops = [
        room.onMessage(SERVER_MESSAGES.progress, (message: ProgressMessage) => {
          progress = message;
        }),
        room.onMessage(SERVER_MESSAGES.story, (message: StoryMessage) => {
          saved = message;
        }),
        room.onMessage(SERVER_MESSAGES.questChanged, changedQuest),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
    frame: () => {
      if (overlay !== null && options.blocked()) close();
      compass = overlay === null && !options.blocked() ? compassGoal() : null;
      buttons.render(progress !== null, news, compass !== null, options.language());
      bag.render();
      journal.render();
      toast.render(overlay === null && !options.blocked());
    },
    overlay: () => overlay,
    reset: () => {
      progress = null;
      saved = null;
      news = false;
      toast.clear();
      close();
    },
    news: (lines, tone, picture) => toast.news(lines, tone, picture),
    snapshot: () => ({
      story: saved,
      journalNews: news,
      questToast: toast.state(),
      compass,
      bag: overlay === 'bag' ? bag.state() : null,
      journal: overlay === 'journal' ? journal.state() : null,
    }),
  };
}

/** The middle of the tall grass a step needs, or of the first tall grass on the map for any. */
function grassTile(map: WorldMap, zone: string | undefined): Point | null {
  const area = map.encounterAreas.find((each) => zone === undefined || each.zone === zone);
  return area ? { x: area.x + Math.floor(area.width / 2), y: area.y + Math.floor(area.height / 2) } : null;
}

/** Whether the player's skill level is high enough for a spot. */
export function spotUsable(spot: string, skills: SkillsMessage | null): boolean {
  const found = STORY.skills?.spots.get(spot);
  if (!found) return false;
  const level = skills?.skills.find((entry) => entry.skill === found.skill)?.level ?? 1;
  return level >= found.level;
}

/** Where the player stands and which spots they can use, so a gather goal goes to the nearest one. */
export type GoalSearch = { readonly from: Point; usable(spot: string): boolean };

/** The nearest spot on `map` that gives `item`, among those usable when there are any. */
function spotTile(map: WorldMap, item: string, near: GoalSearch | undefined): Point | null {
  const spots = Object.entries(map.spots).filter(([id]) => STORY.skills?.spots.get(id)?.item === item);
  const usable = spots.filter(([id]) => near?.usable(id) ?? true);
  const from = near?.from;
  const distance = (at: Point) => (from ? Math.abs(at.x - from.x) + Math.abs(at.y - from.y) : 0);
  return (usable.length > 0 ? usable : spots).map(([, at]) => at).toSorted((a, b) => distance(a) - distance(b))[0] ?? null;
}

/** The first station of a kind on `map`. */
const stationTile = (map: WorldMap, kind: StationKind): Point | null => Object.entries(map.stations).find(([id]) => STORY.skills?.stations.get(id)?.kind === kind)?.[1] ?? null;

/**
 * Where on `map` the player goes for a goal (core `nextGoal`): the character, shrine, mark or tall
 * grass it names, the nearest usable spot of an item to gather, the cooking pot or the job board.
 * Null when it is on no spot of this map.
 */
export function goalTile(goal: Goal, map: WorldMap, near?: GoalSearch): Point | null {
  if (goal.kind !== 'step') return map.npcs[goal.npc] ?? null;
  const { step } = goal;
  if (step.kind === 'talk') return map.npcs[step.npc] ?? null;
  if (step.kind === 'deliver') return map.npcs[step.to] ?? null;
  if (step.kind === 'visitShrine') return map.shrines[step.shrine] ?? null;
  if (step.kind === 'reach') return map.marks[step.mark] ?? null;
  if (step.kind === 'gather') return spotTile(map, step.item, near);
  if (step.kind === 'cook') return stationTile(map, 'cookingPot');
  if (step.kind === 'finishJobs') return stationTile(map, 'jobBoard');
  return grassTile(map, step.kind === 'winBattles' ? step.zone : undefined);
}
