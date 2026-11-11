import { questLog, type Goal, type Language, type Point, type Progress, type QuestLog, type QuestLogEntry, type QuestStep, type StringId } from '@nebotok/core';
import { button, el } from './dom.ts';
import { questName, STORY } from './story-content.ts';
import { format, text } from './strings.ts';

const COUNTED: Partial<Record<QuestStep['kind'], StringId>> = { winBattles: 'journal.battles', befriend: 'journal.befriends' };

/** The progress line under an active quest's hint, such as "1 of 2 battles", for a step that counts more than one event. */
export function stepProgress(kind: QuestStep['kind'] | undefined, count: number, of: number, language: Language): string | null {
  const id = kind === undefined || of <= 1 ? undefined : COUNTED[kind];
  return id ? format(id, language, { count, of }) : null;
}

/** The hint of the step an active quest is on. */
export function stepHint(entry: QuestLogEntry, language: Language): string | null {
  return STORY.quests.get(entry.quest)?.steps[entry.step]?.hint[language] ?? null;
}

/** Whether the player has done the last chapter there is, so the journal says the story goes on later. */
export function toBeContinued(log: QuestLog): boolean {
  // Side chapters stand beside the main story, so only the last main chapter decides this.
  const last = STORY.chapters.findLast((chapter) => !chapter.side)?.id;
  return last !== undefined && log.chapters.some((chapter) => chapter.chapter === last && chapter.done);
}

const chapterName = (id: string, language: Language): string => STORY.chapters.find((chapter) => chapter.id === id)?.name[language] ?? id;

export type JournalScreenOptions = {
  language(): Language;
  /** The player's progress with their story, or null before the server has sent the story. */
  progress(): Progress | null;
  /** Where a goal is on the map the player is on, or null when it is not on it. */
  goalTile(goal: Goal): Point | null;
  /** "Where next?" was tapped. */
  whereNext(tile: Point): void;
  /** The player closed the screen. */
  closed(): void;
};

export type JournalScreen = {
  open(): void;
  close(): void;
  /** Draws the latest journal, rebuilding only when it changed. */
  render(): void;
  state(): { readonly unfolded: string[]; readonly goal: Point | null };
};

/**
 * What you are doing, opened from the world (core `questLog`): each chapter begun, its active quests
 * with the step's hint and how far along it is, and its done quests folded away under one button.
 * "Where next?" shows the next goal (core `nextGoal`) on the map.
 */
export function createJournalScreen(root: HTMLElement, options: JournalScreenOptions): JournalScreen {
  const t = (id: StringId) => text(id, options.language());
  let open = false;
  let shown = '';
  let goal: Point | null = null;
  const unfolded = new Set<string>();

  function activeQuest(entry: QuestLogEntry): HTMLElement {
    const language = options.language();
    const parts = [el('p', { className: 'journal-name', text: questName(entry.quest, language) })];
    const hint = stepHint(entry, language);
    if (hint) parts.push(el('p', { className: 'journal-hint', text: hint }));
    const counted = stepProgress(STORY.quests.get(entry.quest)?.steps[entry.step]?.kind, entry.count, entry.of, language);
    if (counted) parts.push(el('p', { className: 'journal-progress', text: counted }));
    return el('li', { className: 'journal-quest', attrs: { 'data-quest': entry.quest } }, parts);
  }

  function doneQuests(chapter: string, done: readonly QuestLogEntry[]): HTMLElement[] {
    if (done.length === 0) return [];
    const language = options.language();
    const isOpen = unfolded.has(chapter);
    const listId = `journal-done-${chapter}`;
    const fold = button('secondary journal-fold', format('journal.done', language, { count: done.length }), () => {
      if (isOpen) unfolded.delete(chapter);
      else unfolded.add(chapter);
      render(true);
    });
    fold.setAttribute('aria-expanded', String(isOpen));
    fold.setAttribute('aria-controls', listId);
    const list = el('ul', { className: 'journal-done-list', attrs: { id: listId } }, done.map((entry) => el('li', { className: 'journal-done', attrs: { 'data-quest': entry.quest }, text: questName(entry.quest, language) })));
    list.hidden = !isOpen;
    return [fold, list];
  }

  function chapterPart(chapter: QuestLog['chapters'][number]): HTMLElement {
    const language = options.language();
    const head: HTMLElement[] = [el('h3', { className: 'journal-chapter-title', text: chapterName(chapter.chapter, language) })];
    if (chapter.done) head.push(el('span', { className: 'journal-chapter-done', text: t('journal.chapterDone') }));
    const active = chapter.quests.filter((entry) => entry.state === 'active');
    const parts: HTMLElement[] = [el('div', { className: 'journal-chapter-head' }, head)];
    if (active.length > 0) parts.push(el('ul', { className: 'journal-quests' }, active.map(activeQuest)));
    parts.push(...doneQuests(chapter.chapter, chapter.quests.filter((entry) => entry.state === 'done')));
    return el('section', { className: 'journal-chapter', attrs: { 'data-chapter': chapter.chapter } }, parts);
  }

  function build(log: QuestLog | null) {
    const parts: Node[] = !log || log.chapters.length === 0 ? [el('p', { className: 'hint centred journal-empty', text: t('journal.empty') })] : log.chapters.map(chapterPart);
    if (log && toBeContinued(log)) parts.push(el('p', { className: 'journal-continued', text: t('journal.continued') }));
    const before = root.querySelector<HTMLElement>('.team-scroll');
    const keepScroll = before?.scrollTop ?? 0;
    const scroll = el('div', { className: 'team-scroll', attrs: { role: 'group' } }, parts);
    const foot: HTMLElement[] = [];
    const target = goal;
    if (target) foot.push(button('secondary journal-where', t('journal.whereNext'), () => options.whereNext(target)));
    foot.push(
      button('primary journal-close', t('team.close'), () => {
        close();
        options.closed();
      }),
    );
    root.replaceChildren(el('div', { className: 'screen-body team-body' }, [el('div', { className: 'team-head' }, [el('h2', { className: 'screen-title', text: t('journal.title') })]), scroll, el('div', { className: 'team-foot' }, foot)]));
    scroll.scrollTop = keepScroll;
  }

  function render(force = false) {
    root.hidden = !open;
    if (!open) return;
    const progress = options.progress();
    const log = progress ? questLog(progress, STORY) : null;
    goal = log?.next ? options.goalTile(log.next) : null;
    const key = JSON.stringify([options.language(), log, goal, [...unfolded]]);
    if (!force && key === shown) return;
    shown = key;
    build(log);
  }

  function close() {
    open = false;
    shown = '';
    render();
  }

  return {
    open: () => {
      open = true;
      render(true);
    },
    close,
    render: () => render(),
    state: () => ({ unfolded: [...unfolded], goal }),
  };
}
