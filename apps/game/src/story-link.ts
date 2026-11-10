import { SERVER_MESSAGES, type Goal, type Language, type Point, type ProgressMessage, type QuestChanged, type StoryMessage, type WorldMap } from '@nebotok/core';
import { createBagScreen } from './bag-screen.ts';
import type { WorldRoom } from './connection.ts';
import { element } from './dom.ts';
import { createStoryButtons } from './hud.ts';
import { createJournalScreen } from './journal-screen.ts';
import { createQuestToast, type QuestToastState } from './quest-toast.ts';
import { storyProgress } from './story-content.ts';

/** A screen over the world that the bag and the journal put up. */
export type StoryOverlay = 'bag' | 'journal';

export type StoryOptions = {
  language(): Language;
  /** Something else is in front of the world (a battle, the starter, the profile list), so the bag and journal stay shut. */
  blocked(): boolean;
  /** The map and your own courier's tile on it, as the server last said, once both are known. */
  standing(): { map: WorldMap; tile: Point } | null;
  /** Shows the player a tile on the map: the journal's "Where next?". */
  lookAt(tile: Point): void;
  /** Which overlay is up changed, so the page shows another screen and input may change. */
  changed(): void;
};

export type TestStory = {
  story: StoryMessage | null;
  /** The journal has news the player has not opened it for. */
  journalNews: boolean;
  questToast: QuestToastState | null;
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

  const current = () => (progress ? storyProgress(progress, saved) : null);
  const toast = createQuestToast(element<HTMLElement>('.quest-toast'), options.language);
  const close = () => open(null);
  const bag = createBagScreen(element<HTMLElement>('#bag'), { language: options.language, progress: current, closed: close });
  const journal = createJournalScreen(element<HTMLElement>('#journal'), {
    language: options.language,
    progress: () => (saved ? current() : null),
    goalTile: (goal) => {
      const standing = options.standing();
      return standing ? goalTile(goal, standing.map) : null;
    },
    whereNext: (tile) => {
      close();
      options.lookAt(tile);
    },
    closed: close,
  });
  const buttons = createStoryButtons({ bag: () => open('bag'), journal: () => open('journal') });

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
      buttons.render(progress !== null, news, options.language());
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
    snapshot: () => ({
      story: saved,
      journalNews: news,
      questToast: toast.state(),
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

/** Where on `map` the player goes for a goal (core `nextGoal`): the character, shrine, mark or tall grass it names. Null when it is on no spot of this map. */
export function goalTile(goal: Goal, map: WorldMap): Point | null {
  if (goal.kind !== 'step') return map.npcs[goal.npc] ?? null;
  const { step } = goal;
  if (step.kind === 'talk') return map.npcs[step.npc] ?? null;
  if (step.kind === 'deliver') return map.npcs[step.to] ?? null;
  if (step.kind === 'visitShrine') return map.shrines[step.shrine] ?? null;
  if (step.kind === 'reach') return map.marks[step.mark] ?? null;
  return grassTile(map, step.kind === 'winBattles' ? step.zone : undefined);
}
