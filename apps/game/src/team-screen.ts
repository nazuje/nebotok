import { maxHpOf, type CreatureInstance, type Language, type ProgressMessage, type StorageMessage, type StringId } from '@nebotok/core';
import { CONTENT } from './battle-content.ts';
import type { ClientMessage } from './battle-link.ts';
import { creatureDetails, creatureSummary, type CardCreature } from './creature-card.ts';
import { button, el } from './dom.ts';
import { text } from './strings.ts';

/** The team order after swapping places `a` and `b`, as `team.reorder` wants it. */
export function swappedOrder(size: number, a: number, b: number): number[] {
  const order = Array.from({ length: size }, (_, at) => at);
  order[a] = b;
  order[b] = a;
  return order;
}

export type TeamScreenOptions = {
  language(): Language;
  progress(): ProgressMessage | null;
  /** What waits at the shrine the player is at, or null away from one. */
  storage(): StorageMessage | null;
  send(message: ClientMessage): void;
  /** The player closed the screen. */
  closed(): void;
};

export type TeamScreen = {
  open(): void;
  /** Closes without telling `closed`, as when a battle starts. */
  close(): void;
  isOpen(): boolean;
  /** Draws the latest team, rebuilding only when it changed. */
  render(): void;
  state(): { readonly selected: number | null };
};

const cardOf = (creature: CreatureInstance): CardCreature => ({ ...creature, maxHp: maxHpOf(creature, CONTENT) });

/**
 * Your creatures, opened from the world: each one's health, level, weather type and moves. Tap one,
 * then another, and they swap places; the first that can battle goes out first. At a shrine it also
 * lists the creatures waiting there, to take along or to leave in their place.
 */
export function createTeamScreen(root: HTMLElement, options: TeamScreenOptions): TeamScreen {
  const t = (id: StringId) => text(id, options.language());
  let open = false;
  let selected: number | null = null;
  let shown = '';

  const send = (message: ClientMessage) => {
    selected = null;
    options.send(message);
    render(true);
  };

  function tap(index: number) {
    const team = options.progress()?.team ?? [];
    if (selected === null || selected === index) {
      selected = selected === index ? null : index;
      render(true);
      return;
    }
    send({ type: 'team.reorder', payload: { order: swappedOrder(team.length, selected, index) } });
  }

  function teamCard(creature: CreatureInstance, index: number, atShrine: boolean): HTMLElement {
    const language = options.language();
    const pick = button('team-pick', '', () => tap(index));
    pick.setAttribute('aria-pressed', String(selected === index));
    pick.append(...creatureSummary(cardOf(creature), language, { labelled: true }));
    const parts: HTMLElement[] = [pick, creatureDetails(creature, language)];
    if (atShrine) parts.push(button('secondary team-store', t('storage.store'), () => send({ type: 'storage.swap', payload: { team: index, storage: null } })));
    return el('li', { className: 'team-card' }, parts);
  }

  function storageCard(creature: CreatureInstance, index: number): HTMLElement {
    const language = options.language();
    const take = button('secondary storage-take', t('storage.take'), () => send({ type: 'storage.swap', payload: { team: selected, storage: index } }));
    return el('li', { className: 'team-card stored' }, [el('div', { className: 'team-pick' }, creatureSummary(cardOf(creature), language, { labelled: true })), creatureDetails(creature, language), take]);
  }

  function build() {
    const team = options.progress()?.team ?? [];
    const storage = options.storage();
    const parts: Node[] = [
      el('h2', { className: 'screen-title', text: t('team.title') }),
      el('p', { className: 'hint centred', text: t('team.hint') }),
      el('ul', { className: 'team-list' }, team.map((creature, index) => teamCard(creature, index, storage !== null))),
    ];
    if (storage) {
      parts.push(el('h3', { className: 'label', text: t('storage.title') }));
      parts.push(storage.storage.length > 0 ? el('ul', { className: 'team-list' }, storage.storage.map(storageCard)) : el('p', { className: 'hint centred', text: t('storage.empty') }));
    }
    parts.push(button('primary team-close', t('team.close'), () => {
      close();
      options.closed();
    }));
    root.replaceChildren(el('div', { className: 'screen-body' }, parts));
  }

  function render(force = false) {
    root.hidden = !open;
    if (!open) return;
    const key = JSON.stringify([options.language(), options.progress()?.team, options.storage(), selected]);
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
    isOpen: () => open,
    render: () => render(),
    state: () => ({ selected }),
  };
}
