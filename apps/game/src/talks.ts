import { CLIENT_MESSAGES, SERVER_MESSAGES, type Direction, type Language, type Point, type ProgressMessage, type StoryMessage, type TalkCue, type TalkNode } from '@nebotok/core';
import type { WorldRoom } from './connection.ts';
import { element } from './dom.ts';
import type { Speech } from './speech.ts';
import { talkCueKey } from './storm-plan.ts';
import { text } from './strings.ts';
import { createTalkBox } from './talk-box.ts';
import { STORY } from './talk-content.ts';
import { roomTalkLink, type TalkClientMessage, type TalkLink, type TalkServerMessage } from './talk-link.ts';
import { facingToward, headMarks, starterNpc, talkLine, typedLength, type HeadMark, type TalkLine } from './talk.ts';

/** A `talk.start` with no answer is given up after this long, so a lost one never blocks the next. */
const ASK_MS = 3_000;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

/** The talk on screen, for the test hook. */
export type TestTalk = {
  conversation: number;
  npc: string;
  node: string;
  cue: TalkCue | null;
  /** Who says the line, or null for the narrator. */
  speaker: string | null;
  line: string;
  /** The whole line is shown, so a tap goes on and the choices are up. */
  typed: boolean;
  /** The choices on screen, each with the index the server answers by (the button's `data-choice`). */
  choices: { index: number; say: string }[];
  waiting: boolean;
};

export type TalksOptions = {
  language(): Language;
  /** Your creatures, as the server last sent them: a player with none gets the starter. */
  progress(): ProgressMessage | null;
  /** A talk opened or closed, so the page shows another screen and input may change. */
  changed(): void;
  /** Says each line as it starts. */
  speech: Speech;
  /** A node with a cue opened (`talkCueKey` is its key): the starter screen, or a story cue to play. */
  cue(cue: TalkCue, key: string): void;
};

export type Talks = {
  /** Listens to a joined room. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** Asks to talk to `npc`, unless a talk is open or already asked for. */
  start(npc: string): void;
  /** Called every frame: types the line on. */
  frame(now: number): void;
  isOpen(): boolean;
  /** The talk is at the node that offers the starter, so the starter screen goes over it. */
  offersStarter(): boolean;
  /** How a character on `at` looks: turned to you while you talk to them, else down, and their head mark. */
  look(npc: string, at: Point, self: Point | null): { facing: Direction; mark: HeadMark | null };
  /** The character a new player goes to for their first creature, or null once they have one. */
  starterNpc(): string | null;
  /** Forgets the talk and the story, as when the player leaves the world. */
  reset(): void;
  snapshot(now: number): TestTalk | null;
};

/** Talking to characters: the server's talk messages, the talk box, and the marks over heads. */
export function createTalks(options: TalksOptions): Talks {
  const { speech } = options;
  let link: TalkLink | null = null;
  let talk: TalkNode | null = null;
  let story: StoryMessage | null = null;
  /** When the line on screen began typing, and whether a tap showed all of it. */
  let typingFrom = 0;
  let skipped = false;
  let waiting = false;
  let asked: { npc: string; at: number } | null = null;
  let marks: { progress: ProgressMessage | null; story: StoryMessage | null; marks: ReadonlyMap<string, HeadMark> } = { progress: null, story: null, marks: new Map() };

  const box = createTalkBox(element<HTMLElement>('#talk'), {
    tap: () => tap(performance.now()),
    choose: (index) => choose(index, performance.now()),
    close: () => close(),
  });

  const send = (message: TalkClientMessage) => link?.send(message);
  const line = (): TalkLine | null => (talk ? talkLine(talk, STORY, options.language()) : null);
  const typed = (shown: TalkLine, now: number) => (skipped || REDUCED_MOTION.matches ? shown.say.length : typedLength(shown.say.length, now - typingFrom, shown.pace));

  function show(next: TalkNode | null) {
    const opened = (talk === null) !== (next === null);
    const same = talk !== null && next !== null && talk.conversation === next.conversation && talk.node === next.node;
    talk = next;
    waiting = false;
    if (next) asked = null;
    // A reconnection sends the same node again; it goes on where it was.
    if (next && !same) {
      typingFrom = performance.now();
      skipped = false;
      const shown = line();
      const voice = shown?.speaker ? (STORY.npcs.get(shown.speaker)?.voice ?? null) : null;
      if (shown) speech.onLine(voice, shown.say, shown.mood);
      if (next.cue !== null) options.cue(next.cue, talkCueKey(next));
    }
    if (opened) options.changed();
  }

  function receive(message: TalkServerMessage) {
    if (message.type === SERVER_MESSAGES.talkNode) show(message.payload);
    else if (message.type === SERVER_MESSAGES.talkEnded) {
      if (talk?.conversation === message.payload.conversation) show(null);
    } else if (message.type === SERVER_MESSAGES.story) story = message.payload;
    else if (message.payload.request === CLIENT_MESSAGES.talkStart) asked = null;
    else if (message.payload.request === CLIENT_MESSAGES.talkNext || message.payload.request === CLIENT_MESSAGES.talkEnd) waiting = false;
  }

  function tap(now: number) {
    const shown = line();
    if (!talk || !shown || waiting || talk.cue === 'offerStarter') return;
    if (typed(shown, now) < shown.say.length) {
      skipped = true;
      return;
    }
    if (shown.choices.length > 0) return;
    waiting = true;
    send({ type: CLIENT_MESSAGES.talkNext, payload: { conversation: talk.conversation, choice: null } });
  }

  function choose(index: number, now: number) {
    const shown = line();
    if (!talk || !shown || waiting || typed(shown, now) < shown.say.length || !talk.choices.includes(index)) return;
    waiting = true;
    send({ type: CLIENT_MESSAGES.talkNext, payload: { conversation: talk.conversation, choice: index } });
  }

  function close() {
    if (!talk) return;
    if (!link) {
      show(null);
      return;
    }
    waiting = true;
    send({ type: CLIENT_MESSAGES.talkEnd, payload: { conversation: talk.conversation } });
  }

  window.addEventListener('keydown', (event) => {
    if (!talk || event.repeat || event.altKey || event.ctrlKey || event.metaKey || talk.cue === 'offerStarter') return;
    // A focused button answers Space and Enter itself.
    if (event.target instanceof HTMLButtonElement && (event.code === 'Space' || event.code === 'Enter')) return;
    const now = performance.now();
    const digit = /^Digit([1-3])$/.exec(event.code)?.[1];
    if (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') tap(now);
    else if (event.code === 'Escape') close();
    else if (digit !== undefined) {
      const index = talk.choices[Number(digit) - 1];
      if (index !== undefined) choose(index, now);
    } else return;
    event.preventDefault();
  });

  function currentMarks(): ReadonlyMap<string, HeadMark> {
    const progress = options.progress();
    if (marks.progress !== progress || marks.story !== story) marks = { progress, story, marks: headMarks(progress, story, STORY) };
    return marks.marks;
  }

  return {
    joined: (room) => {
      // A fresh join starts a new seat, and the server has ended any talk the old one had.
      show(null);
      story = null;
      asked = null;
      const roomSide = roomTalkLink(room);
      link = roomSide;
      const stop = roomSide.listen(receive);
      return () => {
        stop();
        if (link === roomSide) link = null;
      };
    },
    start: (npc) => {
      const now = performance.now();
      if (!link || talk || (asked && now - asked.at < ASK_MS)) return;
      asked = { npc, at: now };
      send({ type: CLIENT_MESSAGES.talkStart, payload: { npc } });
    },
    frame: (now) => {
      const shown = line();
      box.render(talk && shown ? { key: `${talk.conversation}:${talk.node}:${options.language()}`, line: shown, typed: typed(shown, now), waiting, closeLabel: text('talk.close', options.language()) } : null);
    },
    isOpen: () => talk !== null,
    offersStarter: () => talk?.cue === 'offerStarter',
    look: (npc, at, self) => ({ facing: talk?.npc === npc && self ? facingToward(at, self) : 'down', mark: currentMarks().get(npc) ?? null }),
    starterNpc: () => starterNpc(options.progress(), story, STORY),
    reset: () => {
      show(null);
      story = null;
      asked = null;
    },
    snapshot: (now) => {
      const shown = line();
      if (!talk || !shown) return null;
      return {
        conversation: talk.conversation,
        npc: talk.npc,
        node: talk.node,
        cue: talk.cue,
        speaker: shown.speaker,
        line: shown.say,
        typed: typed(shown, now) >= shown.say.length,
        choices: shown.choices.map(({ index, say }) => ({ index, say })),
        waiting,
      };
    },
  };
}
