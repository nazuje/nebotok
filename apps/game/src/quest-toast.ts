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

export type QuestToastState = { readonly quest: string; readonly change: QuestChanged['change']; readonly lines: readonly string[] };

export type QuestToast = {
  /** Shows a quest change for QUEST_TOAST_MS of the world being in view, after any shown or waiting before it. */
  show(change: QuestChanged): void;
  clear(): void;
  /** Redraws in the current language when it changed. While `inView` is false (a screen covers the world) the toast waits. */
  render(inView: boolean): void;
  state(): QuestToastState | null;
};

/**
 * The quest news at the top of the world, one change at a time, so a step that starts the next
 * quest shows both. News that comes during a battle or over a screen waits for the world, where it
 * would not cover the screen's title, and then stays its full time.
 */
export function createQuestToast(root: HTMLElement, language: () => Language): QuestToast {
  const waiting: QuestChanged[] = [];
  let current: QuestChanged | null = null;
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
    const key = JSON.stringify([language(), current]);
    if (key === shown) return;
    shown = key;
    const [head, ...rest] = questToastLines(current, language());
    root.dataset.change = current.change;
    root.replaceChildren(el('strong', { className: 'quest-toast-head', text: head ?? '' }), ...rest.map((line) => el('span', { className: 'quest-toast-line', text: line })));
  }

  return {
    show: (change) => {
      waiting.push(change);
    },
    clear: () => {
      waiting.length = 0;
      next();
      root.hidden = true;
      shown = '';
    },
    render,
    state: () => (current && showing ? { quest: current.quest, change: current.change, lines: questToastLines(current, language()) } : null),
  };
}
