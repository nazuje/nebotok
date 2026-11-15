import { frameNames, jobRewards, spriteFor, type ItemCount, type JobChanged, type JobView, type Language, type SkillsMessage, type StringId } from '@nebotok/core';
import { itemIcon } from './bag-screen.ts';
import { itemName } from './battle-content.ts';
import { button, el } from './dom.ts';
import { pictureIcon, spriteIcon } from './pictures.ts';
import { showFrame } from './skill-games/mini-game.ts';
import { paintFrame, sprite } from './sprites.ts';
import { STORY } from './story-content.ts';
import { format, text } from './strings.ts';
import { portraitFrame } from './talk.ts';

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Gather jobs are headed by the skill that gathers their item: a fish is caught, a berry gathered.
 * The strings have one verb per kind of gathering, so the skill picks among them.
 */
const GATHER_VERBS: Readonly<Record<string, StringId>> = { fishing: 'jobs.verb.catch' };
const KIND_VERBS: Readonly<Record<JobView['kind'], StringId>> = { gather: 'jobs.verb.gather', cook: 'jobs.verb.cook', deliver: 'jobs.verb.deliver' };

/** The skill whose work a job asks for: the one gathering its item, or the one cooking a dish. Null for a delivery. */
export function jobSkill(job: Pick<JobView, 'kind' | 'item'>): string | null {
  const skills = STORY.skills;
  if (!skills || job.kind === 'deliver') return null;
  if (job.kind === 'cook') return [...skills.skills].find(([, skill]) => skill.uses === 'recipes')?.[0] ?? null;
  return [...skills.spots.values()].find((spot) => spot.item === job.item)?.skill ?? null;
}

/** The heading a job's card shows: Deliver, Cook, Gather, or Catch for a gather job of something fished. */
export function jobVerb(job: Pick<JobView, 'kind' | 'item'>): StringId {
  if (job.kind !== 'gather') return KIND_VERBS[job.kind];
  const skill = jobSkill(job);
  return (skill === null ? undefined : GATHER_VERBS[skill]) ?? KIND_VERBS.gather;
}

/** The verb as a picture: the skill's action, playing (`actions/<skill>`), or the envelope for a delivery. */
export function jobArt(job: Pick<JobView, 'kind' | 'item'>): JobArt | null {
  if (job.kind === 'deliver') return { sprite: spriteFor.picture('envelope'), animation: null };
  const skill = jobSkill(job);
  return skill === null ? null : { sprite: spriteFor.action(skill), animation: 'play' };
}

export type JobArt = { readonly sprite: string; readonly animation: string | null };

/** The smallest share of the bar a reward fills, so even a little XP shows. */
const MIN_GAIN_PERCENT = 4;

/**
 * A skill XP reward as a bar of the skill's current level, in percent: what the player has
 * already earned toward the next level, and what the reward adds. Full at the top level. Before
 * the server has said, the player is taken to be at the start of level 1.
 */
export function xpBar(skill: string, xp: number, skills: SkillsMessage | null): { readonly before: number; readonly gain: number } {
  const entry = skills?.skills.find((each) => each.skill === skill);
  const of = entry ? entry.xp + entry.toNext : (STORY.skills?.levelCosts[0] ?? 0);
  if (entry?.toNext === 0 || of <= 0) return { before: 100, gain: 0 };
  const before = Math.min(100, Math.floor(((entry?.xp ?? 0) * 100) / of));
  return { before, gain: Math.min(100 - before, Math.max(MIN_GAIN_PERCENT, Math.round((xp * 100) / of))) };
}

const skillName = (skill: string, language: Language) => STORY.skills?.skills.get(skill)?.name[language] ?? skill;
export const npcName = (npc: string, language: Language) => STORY.npcs.get(npc)?.name[language] ?? npc;
const carried = (inventory: readonly ItemCount[], item: string) => inventory.find((entry) => entry.item === item)?.count ?? 0;

export type JobXpReward = { readonly skill: string; readonly xp: number; readonly line: string; readonly bar: ReturnType<typeof xpBar> };

/** One card on the board, in words and pictures: never a sentence built from parts, since Slovenian counts change the noun. */
export type JobCardView = {
  readonly job: number;
  readonly kind: JobView['kind'];
  readonly heading: string;
  readonly art: JobArt | null;
  readonly item: string;
  readonly itemName: string;
  readonly count: string;
  /** For a delivery: who to, and the line beside their portrait. */
  readonly to: { readonly npc: string; readonly line: string } | null;
  readonly progress: string;
  /** One pip per item the job wants, `filled` of them done (or, for a delivery, in the bag). */
  readonly pips: { readonly filled: number; readonly of: number };
  /** A delivery whose items are all in the bag, so only the walk to the character is left. */
  readonly ready: boolean;
  readonly rewards: { readonly items: readonly { readonly item: string; readonly count: string }[]; readonly xp: readonly JobXpReward[] };
};

/** What a job's card shows in `language`; a delivery's progress counts what the bag holds now. */
export function jobCard(job: JobView, inventory: readonly ItemCount[], skills: SkillsMessage | null, language: Language): JobCardView {
  const have = Math.min(carried(inventory, job.item), job.count);
  const deliver = job.kind === 'deliver' && job.to !== null;
  const rewards = STORY.skills ? jobRewards(job, STORY.skills) : { items: [], xp: [] };
  return {
    job: job.job,
    kind: job.kind,
    heading: text(jobVerb(job), language),
    art: jobArt(job),
    item: job.item,
    itemName: itemName(job.item, language),
    count: format('jobs.count', language, { count: job.count }),
    to: deliver && job.to !== null ? { npc: job.to, line: format('jobs.to', language, { npc: npcName(job.to, language) }) } : null,
    progress: deliver ? format('jobs.inBag', language, { count: have, of: job.count }) : format('jobs.progress', language, { count: job.progress, of: job.count }),
    pips: { filled: deliver ? have : Math.min(job.progress, job.count), of: job.count },
    ready: deliver && have >= job.count,
    rewards: {
      items: rewards.items.map(({ item, count }) => ({ item, count: format('bag.count', language, { count }) })),
      xp: rewards.xp.map(({ skill, xp }) => ({ skill, xp, line: format('jobs.rewardXp', language, { skill: skillName(skill, language), xp }), bar: xpBar(skill, xp, skills) })),
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

/** Past this many, pips shrink to keep a card short. */
const MANY_PIPS = 8;

/** One small copy of the item per item a job wants, the first `filled` in colour and the rest faded. */
function pips(item: string, filled: number, of: number): HTMLElement {
  const each = Array.from({ length: of }, (_, at) => {
    const pip = el('span', { className: 'job-pip' }, [itemIcon(item)]);
    if (at < filled) pip.dataset.filled = '';
    return pip;
  });
  return el('span', { className: of > MANY_PIPS ? 'job-pips many' : 'job-pips', attrs: { 'aria-hidden': 'true', 'data-filled': String(filled), 'data-of': String(of) } }, each);
}

/** An item with how many, as the rewards show it. */
const countedItem = (className: string, item: string, count: string) => el('span', { className, attrs: { 'data-item': item } }, [itemIcon(item), el('span', { text: count })]);

/**
 * Job news as pictures, for a player who cannot read: the item with its pips filling for
 * progress, and for a done job a stamp coming down beside what it gave (item pictures, each skill's
 * icon with its XP) and, after the full bag, what did not fit. Null when a progress has no job to show.
 */
export function jobNewsPicture(change: JobChanged, job: Pick<JobView, 'item' | 'count'> | null, language: Language): HTMLElement | null {
  if (change.change === 'progress') {
    if (!job) return null;
    return el('span', { className: 'job-news', attrs: { 'data-change': 'progress', 'aria-hidden': 'true' } }, [itemIcon(job.item), pips(job.item, Math.min(change.progress, job.count), job.count)]);
  }
  const parts: HTMLElement[] = [pictureIcon('stamp', 48, { className: 'job-stamp' })];
  const rewards = change.rewards;
  if (rewards) {
    for (const { item, count } of rewards.items) parts.push(countedItem('job-news-reward', item, format('bag.count', language, { count })));
    for (const gain of rewards.skills) {
      if (gain.xp > 0) parts.push(el('span', { className: 'job-news-reward job-news-xp', attrs: { 'data-skill': gain.skill } }, [spriteIcon(spriteFor.skill(gain.skill), 32), el('span', { text: format('jobs.xpGain', language, { xp: gain.xp }) })]));
    }
    if (rewards.extra.length > 0) {
      parts.push(
        el('span', { className: 'job-news-extra' }, [pictureIcon('bag-full', 32), ...rewards.extra.map(({ item, count }) => countedItem('job-news-reward', item, format('bag.count', language, { count })))]),
      );
    }
  }
  return el('span', { className: 'job-news', attrs: { 'data-change': 'done', 'aria-hidden': 'true' } }, parts);
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
  /** The player's skills, so each XP reward shows how far it takes them. */
  skills(): SkillsMessage | null;
  /** The station the board was opened at, for its name. */
  station(): string | null;
  /** The first visit: one line says how the board works. */
  hint(): boolean;
  /** The player closed the screen. */
  closed(): void;
};

export type JobBoardState = { readonly cards: readonly number[]; readonly flipped: readonly number[]; readonly hint: boolean; readonly more: boolean };

export type JobBoardScreen = {
  open(): void;
  close(): void;
  /** Draws the latest board, rebuilding only when it changed, and plays the verbs' pictures. */
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

/** A picture that plays `animation` of its sprite while the board is open. */
type Playing = { readonly canvas: HTMLCanvasElement; readonly sprite: string; readonly frames: readonly string[]; readonly ms: readonly number[]; readonly total: number };

function verbPicture(art: JobArt, playing: Playing[]): HTMLCanvasElement {
  const canvas = spriteIcon(art.sprite, 48, { className: 'job-verb-art' });
  const animation = art.animation === null ? undefined : sprite(art.sprite).animations?.[art.animation];
  if (animation) playing.push({ canvas, sprite: art.sprite, frames: animation.frames, ms: animation.ms, total: animation.ms.reduce((sum, ms) => sum + ms, 0) });
  return canvas;
}

/** Shows each playing picture's frame for `now`. */
function play(playing: readonly Playing[], now: number) {
  for (const each of playing) {
    let left = now % each.total;
    const at = each.ms.findIndex((ms) => (left -= ms) < 0);
    showFrame(each.canvas, each.sprite, each.frames[at] ?? null);
  }
}

function xpReward(reward: JobXpReward, language: Language): HTMLElement {
  const before = el('span', { className: 'job-xp-before' });
  before.style.width = `${reward.bar.before}%`;
  const gain = el('span', { className: 'job-xp-gain' });
  gain.style.width = `${reward.bar.gain}%`;
  return el('li', { className: 'job-reward job-xp', attrs: { 'data-skill': reward.skill } }, [
    spriteIcon(spriteFor.skill(reward.skill), 32, { label: reward.line }),
    el('span', { className: 'job-xp-bar', attrs: { 'aria-hidden': 'true' } }, [before, gain]),
    el('span', { className: 'job-xp-text', text: format('jobs.xpGain', language, { xp: reward.xp }), attrs: { 'aria-hidden': 'true' } }),
  ]);
}

/**
 * A card: the verb's picture, the item and how many in a row of pictures along the top, then the
 * same in small words for readers, who a delivery is for, the pips filling as the job goes, and the
 * rewards as pictures. The top right corner stays free for a read-aloud button.
 */
function cardElement(card: JobCardView, language: Language, flipped: boolean, playing: Playing[]): HTMLElement {
  const head: HTMLElement[] = [];
  if (card.art) head.push(verbPicture(card.art, playing));
  head.push(itemIcon(card.item), el('span', { className: 'job-count', text: card.count }));
  if (card.to) head.push(el('span', { className: 'job-to', attrs: { 'data-npc': card.to.npc } }, [pictureIcon('arrow', 32, { className: 'job-to-arrow' }), portrait(card.to.npc)]));
  const words = [el('h3', { className: 'job-verb', text: card.heading }), el('span', { className: 'job-item-name', text: card.itemName })];
  if (card.to) words.push(el('span', { className: 'job-to-name', text: card.to.line }));
  const progress: HTMLElement[] = [pips(card.item, card.pips.filled, card.pips.of)];
  if (card.ready) progress.push(pictureIcon('check', 32, { className: 'job-ready-check' }));
  progress.push(el('span', { className: 'job-progress', text: card.progress }));
  const parts: HTMLElement[] = [el('div', { className: 'job-head' }, head), el('div', { className: 'job-words' }, words), el('div', { className: 'job-progress-row' }, progress)];
  const rewards = [
    ...card.rewards.items.map(({ item, count }) => el('li', { className: 'job-reward', attrs: { 'data-item': item } }, [itemIcon(item), el('span', { text: count })])),
    ...card.rewards.xp.map((reward) => xpReward(reward, language)),
  ];
  if (rewards.length > 0) parts.push(el('div', { className: 'job-rewards' }, [pictureIcon('trophy', 32, { label: text('jobs.rewards', language), className: 'job-rewards-title' }), el('ul', { className: 'job-reward-list' }, rewards)]));
  const attrs: Record<string, string> = { 'data-job': String(card.job), 'data-kind': card.kind };
  if (card.ready) attrs['data-ready'] = '';
  if (flipped) attrs['data-flipped'] = '';
  return el('li', { className: 'job-card', attrs }, parts);
}
/** A card hidden below the board by more than a sliver. */
const MORE_BELOW_PX = 8;

/**
 * The Sky Post job board, opened by tapping the board in the world: a cork board with a card per
 * job. A job finished since the player last looked turns over in its place to show the new one
 * (with no movement under reduced motion, which the stylesheet decides). Rewards already came by
 * themselves, so the screen only shows; it has nothing to collect. While cards are hidden below,
 * an arrow at the bottom of the board says so, and a tap on it scrolls them up.
 */
export function createJobBoard(root: HTMLElement, options: JobBoardOptions): JobBoardScreen {
  let open = false;
  let shown = '';
  /** Job numbers in the order the cards stand, kept across visits so a new job takes its old card's place. */
  let order: number[] = [];
  /** Jobs the player has seen on an open board; one not seen yet turns over the first time it shows. */
  const seen = new Set<number>();
  let flipped: number[] = [];
  let playing: Playing[] = [];
  let scroll: HTMLElement | null = null;
  let more: HTMLButtonElement | null = null;

  function build(jobs: readonly JobView[]) {
    const language = options.language();
    const station = options.station();
    const title = (station && STORY.skills?.stations.get(station)?.name[language]) ?? '';
    const inventory = options.inventory();
    const skills = options.skills();
    const head = [el('h2', { className: 'screen-title', text: title })];
    if (options.hint()) head.push(el('p', { className: 'hint centred job-hint', text: text('jobs.hint', language) }));
    playing = [];
    const cards = el(
      'ol',
      { className: 'job-cards' },
      jobs.map((job) => cardElement(jobCard(job, inventory, skills, language), language, flipped.includes(job.job), playing)),
    );
    const scrolled = el('div', { className: 'team-scroll job-board-scroll', attrs: { role: 'group' } }, [cards]);
    const down = el('button', { className: 'job-more', attrs: { type: 'button', 'aria-label': text('jobs.more', language) } }, [pictureIcon('arrow', 32, { className: 'job-more-arrow' })]);
    down.hidden = true;
    down.addEventListener('click', () => scrolled.scrollBy({ top: scrolled.clientHeight * 0.75, behavior: reducedMotion() ? 'auto' : 'smooth' }));
    scroll = scrolled;
    more = down;
    const foot = el('div', { className: 'team-foot' }, [
      button('primary job-board-close', text('team.close', language), () => {
        close();
        options.closed();
      }),
    ]);
    root.replaceChildren(el('div', { className: 'screen-body team-body job-board-body' }, [el('div', { className: 'team-head' }, head), el('div', { className: 'job-board-frame' }, [scrolled, down]), foot]));
  }

  /** Shows the arrow while the last card is not all in view. */
  function showMore() {
    const last = scroll?.querySelector('.job-card:last-child');
    if (!scroll || !more || !last) return;
    const below = last.getBoundingClientRect().bottom - scroll.getBoundingClientRect().bottom > MORE_BELOW_PX;
    if (more.hidden === below) more.hidden = !below;
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
    const key = JSON.stringify([options.language(), options.station(), options.hint(), jobs, counts, options.skills()?.skills, flipped]);
    if (force || key !== shown) {
      shown = key;
      build(jobs);
    }
    if (!reducedMotion()) play(playing, performance.now());
    showMore();
  }

  function close() {
    open = false;
    flipped = [];
    shown = '';
    playing = [];
    scroll = null;
    more = null;
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
    state: () => ({ cards: [...order], flipped: [...flipped], hint: options.hint(), more: more !== null && !more.hidden }),
  };
}
