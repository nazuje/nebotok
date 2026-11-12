import { frameNames, jobRewards, spriteFor, type ItemCount, type JobChanged, type JobView, type Language, type StringId } from '@nebotok/core';
import { itemIcon } from './bag-screen.ts';
import { itemName } from './battle-content.ts';
import { button, el } from './dom.ts';
import { paintFrame, sprite } from './sprites.ts';
import { STORY } from './story-content.ts';
import { format, text } from './strings.ts';
import { portraitFrame } from './talk.ts';

/**
 * Gather jobs are headed by the skill that gathers their item: a fish is caught, a berry gathered.
 * The strings have one verb per kind of gathering, so the skill picks among them.
 */
const GATHER_VERBS: Readonly<Record<string, StringId>> = { fishing: 'jobs.verb.catch' };
const KIND_VERBS: Readonly<Record<JobView['kind'], StringId>> = { gather: 'jobs.verb.gather', cook: 'jobs.verb.cook', deliver: 'jobs.verb.deliver' };

/** The heading a job's card shows: Deliver, Cook, Gather, or Catch for a gather job of something fished. */
export function jobVerb(job: Pick<JobView, 'kind' | 'item'>): StringId {
  if (job.kind !== 'gather') return KIND_VERBS[job.kind];
  const skill = [...(STORY.skills?.spots.values() ?? [])].find((spot) => spot.item === job.item)?.skill;
  return (skill && GATHER_VERBS[skill]) ?? KIND_VERBS.gather;
}

const skillName = (skill: string, language: Language) => STORY.skills?.skills.get(skill)?.name[language] ?? skill;
export const npcName = (npc: string, language: Language) => STORY.npcs.get(npc)?.name[language] ?? npc;
const carried = (inventory: readonly ItemCount[], item: string) => inventory.find((entry) => entry.item === item)?.count ?? 0;

/** One card on the board, in words: never a sentence built from parts, since Slovenian counts change the noun. */
export type JobCardView = {
  readonly job: number;
  readonly kind: JobView['kind'];
  readonly heading: string;
  readonly item: string;
  readonly itemName: string;
  readonly count: string;
  /** For a delivery: who to, and the line beside their portrait. */
  readonly to: { readonly npc: string; readonly line: string } | null;
  readonly progress: string;
  /** A delivery whose items are all in the bag, so only the walk to the character is left. */
  readonly ready: boolean;
  readonly rewards: { readonly items: readonly { readonly item: string; readonly count: string }[]; readonly xp: readonly string[] };
};

/** What a job's card says in `language`; a delivery's progress counts what the bag holds now. */
export function jobCard(job: JobView, inventory: readonly ItemCount[], language: Language): JobCardView {
  const have = Math.min(carried(inventory, job.item), job.count);
  const deliver = job.kind === 'deliver' && job.to !== null;
  const rewards = STORY.skills ? jobRewards(job, STORY.skills) : { items: [], xp: [] };
  return {
    job: job.job,
    kind: job.kind,
    heading: text(jobVerb(job), language),
    item: job.item,
    itemName: itemName(job.item, language),
    count: format('jobs.count', language, { count: job.count }),
    to: deliver && job.to !== null ? { npc: job.to, line: format('jobs.to', language, { npc: npcName(job.to, language) }) } : null,
    progress: deliver ? format('jobs.inBag', language, { count: have, of: job.count }) : format('jobs.progress', language, { count: job.progress, of: job.count }),
    ready: deliver && have >= job.count,
    rewards: {
      items: rewards.items.map(({ item, count }) => ({ item, count: format('bag.count', language, { count }) })),
      xp: rewards.xp.map(({ skill, xp }) => format('jobs.rewardXp', language, { skill: skillName(skill, language), xp })),
    },
  };
}

const itemList = (items: readonly ItemCount[], language: Language) => items.map(({ item, count }) => format('quest.rewardItem', language, { item: itemName(item, language), count })).join(', ');

/**
 * What a toast says about a `job.changed`: for progress the item and how far ("Pebblefish 2 / 3"),
 * for a done job that it is done, what it gave and what did not fit. `job` is the job as the board
 * had it before the change; with none to name, a progress toast says nothing.
 */
export function jobToastLines(change: JobChanged, job: Pick<JobView, 'item' | 'count'> | null, language: Language): string[] {
  if (change.change === 'progress') return job ? [format('jobs.toastProgress', language, { item: itemName(job.item, language), count: change.progress, of: job.count })] : [];
  const lines = [text('jobs.toastDone', language)];
  const rewards = change.rewards;
  if (!rewards) return lines;
  const given = rewards.items.length > 0 ? [itemList(rewards.items, language)] : [];
  for (const gain of rewards.skills) if (gain.xp > 0) given.push(format('jobs.rewardXp', language, { skill: skillName(gain.skill, language), xp: gain.xp }));
  if (given.length > 0) lines.push(given.join(', '));
  if (rewards.extra.length > 0) lines.push(format('quest.noRoom', language, { items: itemList(rewards.extra, language) }));
  return lines;
}

/** The board after a `job.changed`, before the `jobs` that may follow: progress counted, or a done job gone and its successor in. */
export function applyJobChange(board: readonly JobView[], change: JobChanged): JobView[] {
  if (change.change === 'progress') return board.map((job) => (job.job === change.job ? { ...job, progress: change.progress } : job));
  const left = board.filter((job) => job.job !== change.job);
  const next = change.next;
  return next && !left.some((job) => job.job === next.job) ? [...left, next] : left;
}

/**
 * The board's jobs in the places the cards had: a job still on the board keeps its place, a new
 * job takes the place of one that went, and any more go at the end. The server appends each new
 * job, so without this a finished card would jump to the end instead of turning over in place.
 */
export function placeJobs(order: readonly number[], board: readonly JobView[]): JobView[] {
  const byNumber = new Map(board.map((job) => [job.job, job]));
  const fresh = board.filter((job) => !order.includes(job.job));
  const placed = order.flatMap((number) => {
    const kept = byNumber.get(number);
    if (kept) return [kept];
    const next = fresh.shift();
    return next ? [next] : [];
  });
  return [...placed, ...fresh];
}

export type JobBoardOptions = {
  language(): Language;
  /** The board as the server last sent it, with any `job.changed` since applied. */
  board(): readonly JobView[];
  /** What the bag holds, so a delivery shows how much of it you carry. */
  inventory(): readonly ItemCount[];
  /** The station the board was opened at, for its name. */
  station(): string | null;
  /** The first visit: one line says how the board works. */
  hint(): boolean;
  /** The player closed the screen. */
  closed(): void;
};

export type JobBoardState = { readonly cards: readonly number[]; readonly flipped: readonly number[]; readonly hint: boolean };

export type JobBoardScreen = {
  open(): void;
  close(): void;
  /** Draws the latest board, rebuilding only when it changed. */
  render(): void;
  /** Forgets which jobs the player has seen, as when they leave the world. */
  forget(): void;
  state(): JobBoardState;
};

/** A character's face beside a delivery, at their `neutral` frame. */
function portrait(npc: string): HTMLCanvasElement {
  const canvas = el('canvas', { className: 'job-portrait', attrs: { 'aria-hidden': 'true' } });
  const id = spriteFor.portrait(npc);
  paintFrame(canvas, id, portraitFrame(frameNames(sprite(id)), null));
  return canvas;
}

function cardElement(card: JobCardView, language: Language, flipped: boolean): HTMLElement {
  const parts: HTMLElement[] = [
    el('h3', { className: 'job-verb', text: card.heading }),
    el('p', { className: 'job-item' }, [itemIcon(card.item), el('span', { className: 'job-item-name', text: card.itemName }), el('span', { className: 'job-count', text: card.count })]),
  ];
  if (card.to) parts.push(el('p', { className: 'job-to', attrs: { 'data-npc': card.to.npc } }, [portrait(card.to.npc), el('span', { className: 'job-to-name', text: card.to.line })]));
  parts.push(el('p', { className: 'job-progress', text: card.progress }));
  const rewards = [
    ...card.rewards.items.map(({ item, count }) => el('li', { className: 'job-reward', attrs: { 'data-item': item } }, [itemIcon(item), el('span', { text: count })])),
    ...card.rewards.xp.map((line) => el('li', { className: 'job-reward job-xp', text: line })),
  ];
  if (rewards.length > 0) parts.push(el('div', { className: 'job-rewards' }, [el('h4', { className: 'job-rewards-title', text: text('jobs.rewards', language) }), el('ul', { className: 'job-reward-list' }, rewards)]));
  const attrs: Record<string, string> = { 'data-job': String(card.job), 'data-kind': card.kind };
  if (card.ready) attrs['data-ready'] = '';
  if (flipped) attrs['data-flipped'] = '';
  return el('li', { className: 'job-card', attrs }, parts);
}

/**
 * The Sky Post job board, opened by tapping the board in the world: a cork board with a card per
 * job. A job finished since the player last looked turns over in its place to show the new one
 * (with no movement under reduced motion, which the stylesheet decides). Rewards already came by
 * themselves, so the screen only shows; it has nothing to collect.
 */
export function createJobBoard(root: HTMLElement, options: JobBoardOptions): JobBoardScreen {
  let open = false;
  let shown = '';
  /** Job numbers in the order the cards stand, kept across visits so a new job takes its old card's place. */
  let order: number[] = [];
  /** Jobs the player has seen on an open board; one not seen yet turns over the first time it shows. */
  const seen = new Set<number>();
  let flipped: number[] = [];

  function build(jobs: readonly JobView[]) {
    const language = options.language();
    const station = options.station();
    const title = (station && STORY.skills?.stations.get(station)?.name[language]) ?? '';
    const inventory = options.inventory();
    const head = [el('h2', { className: 'screen-title', text: title })];
    if (options.hint()) head.push(el('p', { className: 'hint centred job-hint', text: text('jobs.hint', language) }));
    const cards = el(
      'ol',
      { className: 'job-cards' },
      jobs.map((job) => cardElement(jobCard(job, inventory, language), language, flipped.includes(job.job))),
    );
    const scroll = el('div', { className: 'team-scroll job-board-scroll', attrs: { role: 'group' } }, [cards]);
    const foot = el('div', { className: 'team-foot' }, [
      button('primary job-board-close', text('team.close', language), () => {
        close();
        options.closed();
      }),
    ]);
    root.replaceChildren(el('div', { className: 'screen-body team-body job-board-body' }, [el('div', { className: 'team-head' }, head), scroll, foot]));
  }

  function render(force = false) {
    root.hidden = !open;
    if (!open) return;
    const jobs = placeJobs(order, options.board());
    order = jobs.map((job) => job.job);
    const fresh = jobs.filter((job) => !seen.has(job.job)).map((job) => job.job);
    // The board's first jobs simply appear; only a job that took a finished one's place turns over.
    if (fresh.length > 0) {
      if (seen.size > 0) flipped = [...flipped, ...fresh];
      for (const number of fresh) seen.add(number);
    }
    const counts = jobs.map((job) => carried(options.inventory(), job.item));
    const key = JSON.stringify([options.language(), options.station(), options.hint(), jobs, counts, flipped]);
    if (!force && key === shown) return;
    shown = key;
    build(jobs);
  }

  function close() {
    open = false;
    flipped = [];
    shown = '';
    render();
  }

  return {
    open: () => {
      open = true;
      flipped = [];
      render(true);
    },
    close,
    render: () => render(),
    forget: () => {
      seen.clear();
      order = [];
    },
    state: () => ({ cards: [...order], flipped: [...flipped], hint: options.hint() }),
  };
}
