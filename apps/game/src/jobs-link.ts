import { CLIENT_MESSAGES, SERVER_MESSAGES, type JobChanged, type JobsMessage, type JobView, type Language, type ProgressMessage, type Refused, type StringId } from '@nebotok/core';
import type { WorldRoom } from './connection.ts';
import { element } from './dom.ts';
import { applyJobChange, createJobBoard, jobToastLines, type JobBoardState } from './job-board.ts';
import type { RequestPacer } from './request-pacer.ts';

/** A `board.open` with no answer is given up after this long, so a lost one never blocks the next. */
const ASK_MS = 3_000;

/** The screen over the world that the job board puts up. */
export type JobsOverlay = 'jobBoard';

export type JobsOptions = {
  language(): Language;
  /** Your bag, as the server last sent it, for how much of a delivery you carry. */
  progress(): ProgressMessage | null;
  /** Something else is in front of the world (a battle, a talk, another screen), so the board stays shut. */
  blocked(): boolean;
  /** Job news for the quest toast's queue, worked out in whatever language shows when it shows. */
  news(lines: (language: Language) => string[]): void;
  /** A short refusal at the bottom of the screen. */
  refused(id: StringId): void;
  /** The board opened or closed, so the page shows another screen and input may change. */
  changed(): void;
  /** Paces `board.open` with the page's other requests, under the server's limit. */
  requests: RequestPacer;
};

export type TestJobs = {
  /** Your board as the server last sent it (with any `job.changed` since), or null before it was ever opened. */
  jobs: { board: readonly JobView[] | null; screen: (JobBoardState & { station: string }) | null };
};

export type Jobs = {
  /** Listens to a joined room. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** Asks the server to open the job board `station`; its `jobs` answer opens the screen. */
  open(station: string): void;
  /** The board's jobs, for the marks over characters with a delivery ready. */
  board(): readonly JobView[] | null;
  /** Called every frame. */
  frame(): void;
  overlay(): JobsOverlay | null;
  /** Forgets the board, as when the player leaves the world. */
  reset(): void;
  snapshot(): TestJobs;
};

/**
 * The job board: the `jobs` and `job.changed` messages (docs/protocol.md "Skills and the job
 * board"), `board.open` when the board in the world is tapped, the board screen it answers with,
 * and a toast for each job's progress and each job done, whose rewards are already in the bag.
 */
export function createJobs(options: JobsOptions): Jobs {
  let room: WorldRoom | null = null;
  let board: readonly JobView[] | null = null;
  let asked: { station: string; at: number; first: boolean } | null = null;
  let opened: { station: string; first: boolean } | null = null;

  const screen = createJobBoard(element<HTMLElement>('#job-board'), {
    language: options.language,
    board: () => board ?? [],
    inventory: () => options.progress()?.inventory ?? [],
    station: () => opened?.station ?? null,
    hint: () => opened?.first ?? false,
    closed: () => show(null),
  });

  function show(next: { station: string; first: boolean } | null) {
    if ((opened === null) === (next === null)) {
      opened = next;
      return;
    }
    opened = next;
    if (next) screen.open();
    else screen.close();
    options.changed();
  }

  function received(message: JobsMessage) {
    board = message.board;
    if (!asked) return;
    const { station, first } = asked;
    asked = null;
    if (!options.blocked()) show({ station, first });
  }

  function changedJob(change: JobChanged) {
    const job = board?.find((each) => each.job === change.job) ?? null;
    options.news((language) => jobToastLines(change, job, language));
    if (board) board = applyJobChange(board, change);
  }

  function refusedRequest(message: Refused) {
    if (message.request !== CLIENT_MESSAGES.boardOpen) return;
    asked = null;
    options.refused(`refused.${message.reason}`);
  }

  window.addEventListener('keydown', (event) => {
    if (opened === null || event.code !== 'Escape' || event.repeat) return;
    event.preventDefault();
    show(null);
  });

  return {
    joined: (joined) => {
      room = joined;
      asked = null;
      const stops = [
        joined.onMessage(SERVER_MESSAGES.jobs, received),
        joined.onMessage(SERVER_MESSAGES.jobChanged, changedJob),
        joined.onMessage(SERVER_MESSAGES.refused, refusedRequest),
      ];
      return () => {
        for (const stop of stops) stop();
        if (room === joined) room = null;
      };
    },
    open: (station) => {
      const now = performance.now();
      if (!room || opened || options.blocked() || (asked && now - asked.at < ASK_MS)) return;
      asked = { station, at: now, first: board === null };
      options.requests.send(() => room?.send(CLIENT_MESSAGES.boardOpen, { station }));
    },
    board: () => board,
    frame: () => {
      if (opened !== null && options.blocked()) show(null);
      screen.render();
    },
    overlay: () => (opened ? 'jobBoard' : null),
    reset: () => {
      board = null;
      asked = null;
      screen.forget();
      show(null);
    },
    snapshot: () => ({ jobs: { board, screen: opened ? { ...screen.state(), station: opened.station } : null } }),
  };
}
