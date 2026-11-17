import { MAX_TEAM, maxHpOf, type CreatureInstance, type Language, type ProgressMessage, type StorageMessage, type StringId } from '@nebotok/core';
import { CONTENT } from './battle-content.ts';
import type { ClientMessage } from './battle-link.ts';
import { creaturePortrait } from './creature-art.ts';
import { creatureDetails, creatureSummary, type CardCreature } from './creature-card.ts';
import { button, el, pictureButton, withPicture } from './dom.ts';
import { closeButton, pictureIcon, shrineIcon, teamIcon } from './pictures.ts';
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
  /** `swapHint`: the hint showing two cards trading places is up. */
  state(): { readonly selected: number | null; readonly tab: TeamTab; readonly swapHint: boolean };
};

/** At a shrine the screen shows the team or the creatures waiting there, one at a time. */
export type TeamTab = 'team' | 'storage';

const cardOf = (creature: CreatureInstance): CardCreature => ({ ...creature, maxHp: maxHpOf(creature, CONTENT) });

const SWAP_HINT_KEY = 'nebotok:swapHint';

function swappedBefore(): boolean {
  try {
    return localStorage.getItem(SWAP_HINT_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberSwapped(): void {
  try {
    localStorage.setItem(SWAP_HINT_KEY, JSON.stringify('swapped'));
  } catch {
    // Private browsing can refuse storage; the hint then shows again on the next visit.
  }
}

const swapCard = (creature: CreatureInstance, side: 'a' | 'b') => el('span', { className: `swap-card swap-${side}` }, [creaturePortrait(creature.species)]);

/** Two little cards of the first two creatures trading places, over arrows both ways: what tapping two cards does. */
function swapHint(first: CreatureInstance, second: CreatureInstance): HTMLElement {
  const arrows = el('span', { className: 'swap-arrows' }, [pictureIcon('arrow', 32), pictureIcon('arrow', 32, { mirrored: true })]);
  return el('div', { className: 'swap-hint', attrs: { 'aria-hidden': 'true' } }, [swapCard(first, 'a'), arrows, swapCard(second, 'b')]);
}

/**
 * Your creatures, opened from the world: each one's health, level, weather type and moves. Tap one,
 * then another, and they swap places; the first that can battle goes out first. At a shrine a second
 * tab lists the creatures waiting there, to take along or to leave in their place. The title and
 * tabs stay at the top and Close at the bottom; only the cards between them scroll. Until the first
 * swap on this device, two little cards trade places above the team to show how. Leave here and
 * Take along point toward the tab the creature goes to.
 */
export function createTeamScreen(root: HTMLElement, options: TeamScreenOptions): TeamScreen {
  const t = (id: StringId) => text(id, options.language());
  let open = false;
  let selected: number | null = null;
  let tab: TeamTab = 'team';
  let shown = '';
  let swapped = swappedBefore();

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
    if (!swapped) {
      swapped = true;
      rememberSwapped();
    }
    send({ type: 'team.reorder', payload: { order: swappedOrder(team.length, selected, index) } });
  }

  /** `alone`: the server never lets the team's only creature stay behind (core `swapStorage`). */
  function teamCard(creature: CreatureInstance, index: number, atShrine: boolean, alone: boolean): HTMLElement {
    const language = options.language();
    const pick = button('team-pick', '', () => tap(index));
    pick.setAttribute('aria-pressed', String(selected === index));
    pick.append(...creatureSummary(cardOf(creature), language, { labelled: true }));
    const parts: HTMLElement[] = [pick, creatureDetails(creature, language)];
    if (atShrine && alone) parts.push(el('p', { className: 'hint team-keep', text: t('storage.keepOne') }));
    else if (atShrine) parts.push(pictureButton('secondary team-store', pictureIcon('arrow', 32), t('storage.store'), () => send({ type: 'storage.swap', payload: { team: index, storage: null } })));
    return el('li', { className: 'team-card' }, parts);
  }

  /** `blocked`: with the team full, taking one along needs a team creature picked to swap with. */
  function storageCard(creature: CreatureInstance, index: number, blocked: boolean): HTMLElement {
    const language = options.language();
    const take = pictureButton('secondary storage-take', pictureIcon('arrow', 32, { mirrored: true }), t('storage.take'), () => send({ type: 'storage.swap', payload: { team: selected, storage: index } }));
    take.disabled = blocked;
    return el('li', { className: 'team-card stored' }, [el('div', { className: 'team-pick' }, creatureSummary(cardOf(creature), language, { labelled: true })), creatureDetails(creature, language), take]);
  }

  function tabButton(which: TeamTab, label: string, count: number): HTMLElement {
    const choose = button('team-tab', '', () => {
      tab = which;
      render(true);
    });
    choose.setAttribute('role', 'tab');
    choose.setAttribute('aria-selected', String(tab === which));
    choose.dataset.tab = which;
    choose.append(el('span', { text: label }), el('span', { className: 'tab-count', text: String(count) }));
    return withPicture(choose, which === 'team' ? teamIcon(32) : shrineIcon(32));
  }

  const hintShown = (team: readonly CreatureInstance[]) => !swapped && team.length >= 2;

  function teamPart(team: readonly CreatureInstance[], atShrine: boolean): Node[] {
    const [first, second] = team;
    const hint: Node[] = hintShown(team) && first && second ? [swapHint(first, second)] : [];
    return [...hint, el('p', { className: 'hint centred', text: t('team.hint') }), el('ul', { className: 'team-list' }, team.map((creature, index) => teamCard(creature, index, atShrine, team.length <= 1)))];
  }

  function storagePart(storage: StorageMessage, team: readonly CreatureInstance[]): Node[] {
    if (storage.storage.length === 0) return [el('p', { className: 'hint centred', text: t('storage.empty') })];
    const blocked = selected === null && team.length >= MAX_TEAM;
    const list = el('ul', { className: 'team-list' }, storage.storage.map((creature, index) => storageCard(creature, index, blocked)));
    return blocked ? [el('p', { className: 'hint centred storage-reason', text: t('storage.pickFirst') }), list] : [list];
  }

  function build() {
    const team = options.progress()?.team ?? [];
    const storage = options.storage();
    const showing: TeamTab = storage ? tab : 'team';
    const head: Node[] = [el('h2', { className: 'screen-title', text: t('team.title') })];
    if (storage) head.push(el('div', { className: 'team-tabs', attrs: { role: 'tablist' } }, [tabButton('team', t('battle.team'), team.length), tabButton('storage', t('storage.title'), storage.storage.length)]));
    const before = root.querySelector<HTMLElement>('.team-scroll');
    const keepScroll = before?.dataset.tab === showing ? before.scrollTop : 0;
    const scroll = el('div', { className: 'team-scroll', attrs: { role: storage ? 'tabpanel' : 'group', 'data-tab': showing } }, showing === 'storage' && storage ? storagePart(storage, team) : teamPart(team, storage !== null));
    const foot = el('div', { className: 'team-foot' }, [
      closeButton('primary team-close', t('team.close'), () => {
        close();
        options.closed();
      }),
    ]);
    root.replaceChildren(el('div', { className: 'screen-body team-body' }, [el('div', { className: 'team-head' }, head), scroll, foot]));
    scroll.scrollTop = keepScroll;
  }

  function render(force = false) {
    root.hidden = !open;
    if (!open) return;
    const key = JSON.stringify([options.language(), options.progress()?.team, options.storage(), selected, tab]);
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
      tab = 'team';
      render(true);
    },
    close,
    isOpen: () => open,
    render: () => render(),
    state: () => {
      const showing: TeamTab = options.storage() ? tab : 'team';
      return { selected, tab: showing, swapHint: showing === 'team' && hintShown(options.progress()?.team ?? []) };
    },
  };
}
