import type { ItemCount, Language, QuestChanged } from '@nebotok/core';
import { itemName } from './battle-content.ts';
import { el } from './dom.ts';
import { pictureIcon } from './pictures.ts';
import { giverPortrait, goalPictures, itemRow, questGiver, questGoal, questPips, questSteps } from './quest-pictures.ts';
import { questName, STORY } from './story-content.ts';
import { format } from './strings.ts';

/** How long each quest toast stays. Longer than a refusal's, since it has more to read. */
export const QUEST_TOAST_MS = 4_500;

const itemList = (items: readonly ItemCount[], language: Language) => items.map(({ item, count }) => format('quest.rewardItem', language, { item: itemName(item, language), count })).join(', ');

/**
 * What a toast says about a `quest.changed`: a headline, then for a new quest or a new step what to
 * do now, and for a done quest what it gave and what did not fit in the bag.
 */
export function questToastLines(change: QuestChanged, language: Language): string[] {
  const quest = questName(change.quest, language);
  if (change.change !== 'done') {
    const head = format(change.change === 'started' ? 'quest.started' : 'quest.stepDone', language, { quest });
    const hint = questHint(change, language);
    return hint ? [head, hint] : [head];
  }
  const lines = [format('quest.done', language, { quest })];
  const rewards = change.rewards;
  if (!rewards) return lines;
  const given = rewards.items.length > 0 ? [itemList(rewards.items, language)] : [];
  if (rewards.xp > 0) given.push(format('quest.rewardXp', language, { xp: rewards.xp }));
  if (given.length > 0) lines.push(given.join(', '));
  if (rewards.extra.length > 0) lines.push(format('quest.noRoom', language, { items: itemList(rewards.extra, language) }));
  return lines;
}

/** What to do now after a quest started or a step was done, the line read aloud for it; null once the quest is done. */
export function questHint(change: QuestChanged, language: Language): string | null {
  return change.change === 'done' ? null : (STORY.quests.get(change.quest)?.steps[change.step]?.hint[language] ?? null);
}

/**
 * What a quest banner shows without words: who gave the quest, the pictures of what to do now
 * (none once it is done), a dot per step with how many are done, and the items it gives (once done,
 * what it gave, and `extra`, what did not fit in the bag).
 */
export type QuestBanner = {
  readonly giver: string | null;
  readonly goal: readonly string[];
  readonly done: number;
  readonly of: number;
  readonly rewards: readonly ItemCount[];
  readonly extra: readonly ItemCount[];
};

export function questBanner(change: QuestChanged): QuestBanner {
  const of = questSteps(change.quest);
  const giver = questGiver(change.quest);
  if (change.change === 'done') return { giver, goal: [], done: of, of, rewards: change.rewards?.items ?? [], extra: change.rewards?.extra ?? [] };
  const rewards = STORY.quests.get(change.quest)?.rewards.items ?? [];
  return { giver, goal: questGoal(change.quest, change.step), done: change.step, of, rewards, extra: [] };
}

/** Other news the toast carries: something gained (`good`) or a start turned down (`refused`). */
export type NewsTone = 'good' | 'refused';

/** A toast's lines, worked out in whatever language is shown when it shows. */
export type NewsLines = (language: Language) => string[];

/** A picture leading a toast's lines, so a player who cannot read gets the news too. */
export type NewsPicture = (language: Language) => HTMLElement | null;

/** `heard`: the banner has come into view once, so coming back after a screen covered it is not news again. */
type Entry = { readonly kind: 'quest'; readonly change: QuestChanged; heard: boolean } | { readonly kind: 'news'; readonly tone: NewsTone; readonly lines: NewsLines; readonly picture: NewsPicture | null };

/** The toast showing: a quest change (with its quest and banner), or other news (`quest` and `banner` null, `change` its tone). */
export type QuestToastState = { readonly quest: string | null; readonly change: QuestChanged['change'] | NewsTone; readonly lines: readonly string[]; readonly banner: QuestBanner | null };

const entryLines = (entry: Entry, language: Language): string[] => (entry.kind === 'quest' ? questToastLines(entry.change, language) : entry.lines(language));
const entryChange = (entry: Entry): QuestToastState['change'] => (entry.kind === 'quest' ? entry.change.change : entry.tone);

export type QuestToastOptions = {
  /**
   * A button for the banner's speaker slot, at its top right, such as one that reads the quest
   * aloud: called each time a quest banner is laid out, with the change it shows and the language.
   * Without it, or when it returns null, the slot stays empty and takes no room. The banner lets
   * taps through to the world everywhere but this slot.
   */
  readonly speaker?: (change: QuestChanged, language: Language) => HTMLElement | null;
  /** A quest banner came into view for the first time, such as to read its hint aloud. */
  readonly shown?: (change: QuestChanged, language: Language) => void;
};

export type QuestToast = {
  /** Shows a quest change for QUEST_TOAST_MS of the world being in view, after any shown or waiting before it. */
  show(change: QuestChanged): void;
  /** Shows other news the same way, in the same queue: what a skill gave, a level up, a refused start, a job's progress. */
  news(lines: NewsLines, tone: NewsTone, picture?: NewsPicture): void;
  clear(): void;
  /** Redraws in the current language when it changed. While `inView` is false (a screen covers the world) the toast waits. */
  render(inView: boolean): void;
  state(): QuestToastState | null;
};

/** The middle of a banner: the goal's pictures, after a tick and an arrow for a step just done, or a stamp for a quest done. */
function bannerMiddle(change: QuestChanged, banner: QuestBanner): HTMLElement {
  if (change.change === 'done') return el('span', { className: 'quest-banner-goal quest-banner-stamp' }, [pictureIcon('star-burst', 64, { className: 'quest-banner-burst' }), pictureIcon('stamp', 64, { className: 'quest-banner-seal' })]);
  const goal = goalPictures(banner.goal, 48, 'quest-banner-goal');
  if (change.change === 'step') goal.prepend(pictureIcon('check', 48, { className: 'quest-banner-check' }), pictureIcon('arrow', 32, { className: 'quest-banner-arrow' }));
  return goal;
}

/**
 * A quest change as a banner a child can read without reading: the giver's portrait, what to do
 * now (or the stamp of a quest done), the steps as dots, the words smaller under them for readers,
 * and the items it gives.
 */
function bannerParts(change: QuestChanged, lines: readonly string[], language: Language, speaker: HTMLElement | null): HTMLElement[] {
  const banner = questBanner(change);
  const top: HTMLElement[] = [];
  if (banner.giver !== null) top.push(giverPortrait(banner.giver, 64, 'quest-banner-giver'));
  top.push(bannerMiddle(change, banner));
  const slot = el('span', { className: 'quest-banner-speaker' }, speaker ? [speaker] : []);
  const fresh = change.change === 'step' ? change.step - 1 : null;
  const [head, ...rest] = lines;
  const parts = [
    el('div', { className: 'quest-banner' }, top),
    slot,
    questPips(banner.of, banner.done, fresh),
    el('strong', { className: 'quest-toast-head', text: head ?? '' }),
    ...rest.map((line) => el('span', { className: 'quest-toast-line', text: line })),
  ];
  if (banner.rewards.length > 0) parts.push(itemRow(banner.rewards, language, 'quest-banner-rewards'));
  if (banner.extra.length > 0) parts.push(itemRow(banner.extra, language, 'quest-banner-rewards quest-banner-extra', true));
  return parts;
}

/**
 * The quest news at the top of the world, one change at a time, so a step that starts the next
 * quest shows both. A quest change shows as a banner of pictures (`bannerParts`); other news as
 * words. News that comes during a battle or over a screen waits for the world, where it would not
 * cover the screen's title, and then stays its full time. Skill news shares the queue.
 */
export function createQuestToast(root: HTMLElement, language: () => Language, options: QuestToastOptions = {}): QuestToast {
  const waiting: Entry[] = [];
  let current: Entry | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let showing = false;
  let shown = '';

  function next() {
    clearTimeout(timer);
    timer = undefined;
    current = waiting.shift() ?? null;
    showing = false;
  }

  function render(inView: boolean) {
    if (current === null && inView) next();
    const visible = current !== null && inView;
    if (visible && !showing) {
      timer = setTimeout(next, QUEST_TOAST_MS);
      if (current?.kind === 'quest' && !current.heard) {
        current.heard = true;
        options.shown?.(current.change, language());
      }
    }
    if (!visible && showing) {
      clearTimeout(timer);
      timer = undefined;
    }
    showing = visible;
    root.hidden = !visible;
    if (!current || !visible) {
      shown = '';
      return;
    }
    const lines = entryLines(current, language());
    const key = JSON.stringify([language(), entryChange(current), current.kind === 'quest' ? current.change : null, lines]);
    if (key === shown) return;
    shown = key;
    root.dataset.change = entryChange(current);
    root.dataset.kind = current.kind;
    if (current.kind === 'quest') {
      root.replaceChildren(...bannerParts(current.change, lines, language(), options.speaker?.(current.change, language()) ?? null));
      return;
    }
    const [head, ...rest] = lines;
    const picture = current.picture?.(language());
    root.replaceChildren(...(picture ? [picture] : []), el('strong', { className: 'quest-toast-head', text: head ?? '' }), ...rest.map((line) => el('span', { className: 'quest-toast-line', text: line })));
  }

  return {
    show: (change) => {
      waiting.push({ kind: 'quest', change, heard: false });
    },
    news: (lines, tone, picture) => {
      waiting.push({ kind: 'news', tone, lines, picture: picture ?? null });
    },
    clear: () => {
      waiting.length = 0;
      next();
      root.hidden = true;
      shown = '';
    },
    render,
    state: () =>
      current && showing
        ? { quest: current.kind === 'quest' ? current.change.quest : null, change: entryChange(current), lines: entryLines(current, language()), banner: current.kind === 'quest' ? questBanner(current.change) : null }
        : null,
  };
}
