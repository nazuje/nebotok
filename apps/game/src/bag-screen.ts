import { bagView, frameNames, spriteFor, type ItemKind, type Language, type Progress, type StringId } from '@nebotok/core';
import { CONTENT, itemName } from './battle-content.ts';
import { button, el } from './dom.ts';
import { paintFrame, sprite } from './sprites.ts';
import { questName, STORY } from './story-content.ts';
import { format, text } from './strings.ts';

const KIND_TITLE: Readonly<Record<ItemKind, StringId>> = { quest: 'bag.kind.quest', treat: 'bag.kind.treat', material: 'bag.kind.material' };

/** What a tap on an item says: its description, and for a quest item which quest it is for. */
export function itemAbout(id: string, language: Language): { readonly description: string; readonly quest: string | null } {
  const item = CONTENT.items.get(id);
  const description = item?.description?.[language] ?? (item?.kind === 'treat' ? text('bag.treatAbout', language) : '');
  const quest = item?.kind === 'quest' ? format('bag.forQuest', language, { quest: questName(item.quest, language) }) : null;
  return { description, quest };
}

/** An item's picture, `items/<id>` in content/art/, for HTML screens; CSS scales it up crisply. */
export function itemIcon(id: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = 'item-icon';
  canvas.setAttribute('aria-hidden', 'true');
  const art = spriteFor.item(id);
  paintFrame(canvas, art, frameNames(sprite(art))[0] ?? '');
  return canvas;
}

export type BagScreenOptions = {
  language(): Language;
  progress(): Progress | null;
  /** The player closed the screen. */
  closed(): void;
};

export type BagScreen = {
  open(): void;
  close(): void;
  /** Draws the latest bag, rebuilding only when it changed. */
  render(): void;
  state(): { readonly selected: string | null };
};

/**
 * What you carry, opened from the world: a section per kind of item in content/inventory.json's
 * order, empty ones left out, each item with its picture, name and count. Tapping one says what it
 * is. Nothing can be thrown away.
 */
export function createBagScreen(root: HTMLElement, options: BagScreenOptions): BagScreen {
  const t = (id: StringId) => text(id, options.language());
  let open = false;
  let selected: string | null = null;
  let shown = '';

  function itemCard(item: string, count: number): HTMLElement {
    const language = options.language();
    const pick = button('bag-item', '', () => {
      selected = selected === item ? null : item;
      render(true);
    });
    pick.setAttribute('aria-expanded', String(selected === item));
    pick.dataset.item = item;
    pick.append(itemIcon(item), el('span', { className: 'bag-name', text: itemName(item, language) }), el('span', { className: 'bag-count', text: format('bag.count', language, { count }) }));
    const parts: HTMLElement[] = [pick];
    if (selected === item) {
      const about = itemAbout(item, language);
      const lines = [el('p', { text: about.description })];
      if (about.quest) lines.push(el('p', { className: 'bag-quest', text: about.quest }));
      parts.push(el('div', { className: 'bag-about' }, lines));
    }
    return el('li', { className: 'bag-entry' }, parts);
  }

  function build() {
    const progress = options.progress();
    const sections = progress ? bagView(progress, STORY).filter((section) => section.items.length > 0) : [];
    const before = root.querySelector<HTMLElement>('.team-scroll');
    const keepScroll = before?.scrollTop ?? 0;
    const parts: Node[] =
      sections.length === 0
        ? [el('p', { className: 'hint centred', text: t('bag.empty') })]
        : [
            el('p', { className: 'hint centred', text: t('bag.hint') }),
            ...sections.map((section) =>
              el('section', { className: 'bag-section', attrs: { 'data-kind': section.kind } }, [
                el('h3', { className: 'bag-kind', text: t(KIND_TITLE[section.kind]) }),
                el('ul', { className: 'bag-list' }, section.items.map((entry) => itemCard(entry.item, entry.count))),
              ]),
            ),
          ];
    const scroll = el('div', { className: 'team-scroll', attrs: { role: 'group' } }, parts);
    const foot = el('div', { className: 'team-foot' }, [
      button('primary bag-close', t('team.close'), () => {
        close();
        options.closed();
      }),
    ]);
    root.replaceChildren(el('div', { className: 'screen-body team-body' }, [el('div', { className: 'team-head' }, [el('h2', { className: 'screen-title', text: t('bag.title') })]), scroll, foot]));
    scroll.scrollTop = keepScroll;
  }

  function render(force = false) {
    root.hidden = !open;
    if (!open) return;
    const key = JSON.stringify([options.language(), options.progress()?.inventory, selected]);
    if (!force && key === shown) return;
    shown = key;
    build();
  }

  function close() {
    open = false;
    selected = null;
    shown = '';
    render();
  }

  return {
    open: () => {
      open = true;
      selected = null;
      render(true);
    },
    close,
    render: () => render(),
    state: () => ({ selected }),
  };
}
