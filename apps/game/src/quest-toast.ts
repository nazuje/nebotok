import type { ItemCount, Language, QuestChanged } from '@nebotok/core';
import { itemName } from './battle-content.ts';
import { el } from './dom.ts';
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
    const hint = STORY.quests.get(change.quest)?.steps[change.step]?.hint[language];
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

/** Other news the toast carries: something gained (`good`) or a start turned down (`refused`). */
export type NewsTone = 'good' | 'refused';

/** A toast's lines, worked out in whatever language is shown when it shows. */
export type NewsLines = (language: Language) => string[];

type Entry = { readonly kind: 'quest'; readonly change: QuestChanged } | { readonly kind: 'news'; readonly tone: NewsTone; readonly lines: NewsLines };

/** The toast showing: a quest change (with its quest), or other news (`quest` null, `change` its tone). */
export type QuestToastState = { readonly quest: string | null; readonly change: QuestChanged['change'] | NewsTone; readonly lines: readonly string[] };

const entryLines = (entry: Entry, language: Language): string[] => (entry.kind === 'quest' ? questToastLines(entry.change, language) : entry.lines(language));
const entryChange = (entry: Entry): QuestToastState['change'] => (entry.kind === 'quest' ? entry.change.change : entry.tone);

export type QuestToast = {
  /** Shows a quest change for QUEST_TOAST_MS of the world being in view, after any shown or waiting before it. */
  show(change: QuestChanged): void;
  /** Shows other news the same way, in the same queue: what a skill gave, a level up, a refused start. */
  news(lines: NewsLines, tone: NewsTone): void;
  clear(): void;
  /** Redraws in the current language when it changed. While `inView` is false (a screen covers the world) the toast waits. */
  render(inView: boolean): void;
  state(): QuestToastState | null;
};

/**
 * The quest news at the top of the world, one change at a time, so a step that starts the next
 * quest shows both. News that comes during a battle or over a screen waits for the world, where it
 * would not cover the screen's title, and then stays its full time. Skill news shares the queue.
 */
export function createQuestToast(root: HTMLElement, language: () => Language): QuestToast {
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
    if (visible && !showing) timer = setTimeout(next, QUEST_TOAST_MS);
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
    const key = JSON.stringify([language(), entryChange(current), lines]);
    if (key === shown) return;
    shown = key;
    const [head, ...rest] = lines;
    root.dataset.change = entryChange(current);
    root.replaceChildren(el('strong', { className: 'quest-toast-head', text: head ?? '' }), ...rest.map((line) => el('span', { className: 'quest-toast-line', text: line })));
  }

  return {
    show: (change) => {
      waiting.push({ kind: 'quest', change });
    },
    news: (lines, tone) => {
      waiting.push({ kind: 'news', tone, lines });
    },
    clear: () => {
      waiting.length = 0;
      next();
      root.hidden = true;
      shown = '';
    },
    render,
    state: () => (current && showing ? { quest: current.kind === 'quest' ? current.change.quest : null, change: entryChange(current), lines: entryLines(current, language()) } : null),
  };
}
