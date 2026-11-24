import { CLIENT_MESSAGES, SERVER_MESSAGES, type BoardJob, type Direction, type Language, type Point, type ProgressMessage, type StoryMessage, type TalkCue, type TalkNode } from '@nebotok/core';
import type { WorldRoom } from './connection.ts';
import { element } from './dom.ts';
import { ANSWER_MS, type RequestPacer } from './request-pacer.ts';
import type { SoundPlayer } from './sound.ts';
import { createBabble } from './sounds-talk.ts';
import { talkSound } from './sounds-world.ts';
import type { Speech, Spoken, Voice } from './speech.ts';
import { talkCueKey } from './storm-plan.ts';
import { text } from './strings.ts';
import { createTalkBox } from './talk-box.ts';
import { STORY } from './talk-content.ts';
import { roomTalkLink, type TalkClientMessage, type TalkLink, type TalkServerMessage } from './talk-link.ts';
import { facingToward, headMarks, starterNpc, talkLine, typedLength, type HeadMark, type TalkLine } from './talk.ts';

/** A `talk.start` with no answer is given up after this long, so a lost one never blocks the next. */
const ASK_MS = 3_000;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

/** The voice a line is said in: its speaker's, or null for the narrator. */
const voiceOf = (shown: TalkLine): Voice | null => (shown.speaker ? (STORY.npcs.get(shown.speaker)?.voice ?? null) : null);
const choiceWords = (shown: TalkLine): string[] => shown.choices.map((choice) => choice.say);

/** The choice being read aloud now, by its index, or null. Choices are read in the narrator's voice. */
function choiceRead(shown: TalkLine, speaking: Spoken | null): number | null {
  if (speaking === null || speaking.voice !== null) return null;
  return shown.choices.find((choice) => choice.say === speaking.text)?.index ?? null;
}

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
  /** The choices on screen, each with the index the server answers by (the button's `data-choice`), its picture and kind. */
  choices: { index: number; say: string; picture: string | null; kind: string | null }[];
  /** The choice being read aloud now, by its index, or null. */
  reading: number | null;
  waiting: boolean;
  /** How many syllables of babble the line has played. */
  babble: number;
};

export type TalksOptions = {
  language(): Language;
  /** Your creatures, as the server last sent them: a player with none gets the starter. */
  progress(): ProgressMessage | null;
  /** Your job board, as the server last sent it, so a character waiting for a delivery you carry is marked. */
  jobs(): readonly BoardJob[] | null;
  /** A talk opened or closed, so the page shows another screen and input may change. */
  changed(): void;
  /** Says each line and its choices as it starts, and again from the talk box's speaker button. */
  speech: Speech;
  /** A node with a cue opened (`talkCueKey` is its key): the starter screen, or a story cue to play. */
  cue(cue: TalkCue, key: string): void;
  /** Paces every talk request with the page's other requests, under the server's limit. */
  requests: RequestPacer;
  /**
   * A screen is up over the world, such as a trainer's fight and its result, so a node that comes
   * now waits and opens once it is gone: the talk box is hidden under it and would take its keys.
   */
  held(): boolean;
  /** Plays a line's sound as it opens (a trainer's challenge, or a character giving you something) and its babble as it types. */
  sound: Pick<SoundPlayer, 'play' | 'recipe' | 'playRecipe'>;
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
  const babble = createBabble(options.sound);
  let link: TalkLink | null = null;
  let talk: TalkNode | null = null;
  /** A node that came while `held`, shown once it is not. */
  let pending: TalkNode | null = null;
  let story: StoryMessage | null = null;
  /** When the line on screen began typing, and whether a tap showed all of it. */
  let typingFrom = 0;
  let skipped = false;
  let waiting = false;
  /** When the `talk.next` or `talk.end` being waited for went out, or was asked for while it waits its turn. */
  let sentAt = 0;
  let asked: { npc: string; at: number } | null = null;
  let marks: { progress: ProgressMessage | null; story: StoryMessage | null; jobs: readonly BoardJob[] | null; marks: ReadonlyMap<string, HeadMark> } = { progress: null, story: null, jobs: null, marks: new Map() };

  const box = createTalkBox(element<HTMLElement>('#talk'), {
    tap: () => tap(performance.now()),
    choose: (index) => choose(index, performance.now()),
    close: () => close(),
    speak: () => {
      const shown = line();
      if (shown) speech.say(voiceOf(shown), shown.say, choiceWords(shown));
    },
  });

  const send = (message: TalkClientMessage) => options.requests.send(() => link?.send(message));
  /** Sends a request the talk box waits on; one with no answer is given up after ANSWER_MS, so the next tap asks again. */
  function ask(message: TalkClientMessage, now: number) {
    waiting = true;
    sentAt = now;
    options.requests.send(() => {
      sentAt = performance.now();
      link?.send(message);
    });
  }
  const line = (): TalkLine | null => (talk ? talkLine(talk, STORY, options.language()) : null);
  const typed = (shown: TalkLine, now: number) => (skipped || REDUCED_MOTION.matches ? shown.say.length : typedLength(shown.say.length, now - typingFrom, shown.pace));

  function show(next: TalkNode | null) {
    const opened = (talk === null) !== (next === null);
    const same = talk !== null && next !== null && talk.conversation === next.conversation && talk.node === next.node;
    talk = next;
    waiting = false;
    if (next) asked = null;
    else if (opened) speech.stop();
    // A reconnection sends the same node again; it goes on where it was.
    if (next && !same) {
      typingFrom = performance.now();
      skipped = false;
      const shown = line();
      if (shown) speech.onLine(voiceOf(shown), shown.say, shown.mood, choiceWords(shown));
      const heard = talkSound(next, STORY);
      if (heard) options.sound.play(heard);
      if (next.cue !== null) options.cue(next.cue, talkCueKey(next));
    }
    if (opened) options.changed();
  }

  function receive(message: TalkServerMessage) {
    if (message.type === SERVER_MESSAGES.talkNode) {
      if (talk === null && options.held()) pending = message.payload;
      else show(message.payload);
    } else if (message.type === SERVER_MESSAGES.talkEnded) {
      if (pending?.conversation === message.payload.conversation) pending = null;
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
    ask({ type: CLIENT_MESSAGES.talkNext, payload: { conversation: talk.conversation, choice: null } }, now);
  }

  function choose(index: number, now: number) {
    const shown = line();
    if (!talk || !shown || waiting || typed(shown, now) < shown.say.length || !talk.choices.includes(index)) return;
    speech.stop();
    ask({ type: CLIENT_MESSAGES.talkNext, payload: { conversation: talk.conversation, choice: index } }, now);
  }

  function close() {
    if (!talk) return;
    if (!link) {
      show(null);
      return;
    }
    ask({ type: CLIENT_MESSAGES.talkEnd, payload: { conversation: talk.conversation } }, performance.now());
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
    const jobs = options.jobs();
    if (marks.progress !== progress || marks.story !== story || marks.jobs !== jobs) marks = { progress, story, jobs, marks: headMarks(progress, story, STORY, jobs) };
    return marks.marks;
  }

  return {
    joined: (room) => {
      // A fresh join starts a new seat, and the server has ended any talk the old one had.
      pending = null;
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
      if (pending && !options.held()) {
        show(pending);
        pending = null;
      }
      if (waiting && now - sentAt >= ANSWER_MS) waiting = false;
      const shown = line();
      const language = options.language();
      const voice = shown && voiceOf(shown);
      babble.frame(
        talk && shown
          ? { key: `${talk.conversation}:${talk.node}:${language}`, speaker: shown.speaker, voice, say: shown.say, pace: shown.pace, typed: typed(shown, now), voiced: speech.reads(voice, shown.say) || speech.speaking()?.text === shown.say }
          : null,
      );
      box.render(
        talk && shown
          ? {
              key: `${talk.conversation}:${talk.node}:${language}`,
              line: shown,
              typed: typed(shown, now),
              waiting,
              closeLabel: text('talk.close', language),
              speakLabel: speech.has(voiceOf(shown), shown.say) || shown.choices.some((choice) => speech.has(null, choice.say)) ? text('speech.play', language) : null,
              reading: choiceRead(shown, speech.speaking()),
            }
          : null,
      );
    },
    isOpen: () => talk !== null,
    offersStarter: () => talk?.cue === 'offerStarter',
    look: (npc, at, self) => ({ facing: talk?.npc === npc && self ? facingToward(at, self) : 'down', mark: currentMarks().get(npc) ?? null }),
    starterNpc: () => starterNpc(options.progress(), story, STORY),
    reset: () => {
      pending = null;
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
        choices: shown.choices.map(({ index, say, picture, kind }) => ({ index, say, picture, kind })),
        reading: choiceRead(shown, speech.speaking()),
        waiting,
        babble: babble.played(),
      };
    },
  };
}
