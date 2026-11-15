import { el, icon } from '../dom.ts';

/**
 * The prototype's two settings, kept in the page address: "Easier" (a turtle: wider timing windows
 * and a slower game) and the level gap, which makes the wild creature a few levels above or below
 * yours.
 */

export type Settings = {
  /** Null where the look has nothing to make easier. */
  readonly easier: boolean | null;
  readonly gap: number;
  setEasier(on: boolean): void;
  setGap(gap: number): void;
};

export const GAPS = [0, 2, 4, -2] as const;
const TURTLE_PATH = 'M2.5 16a8 7 0 0 1 16 0zM18.8 12.6a2.3 2.3 0 1 0 4.6 0a2.3 2.3 0 1 0 -4.6 0zM4.5 16.6h3.2v3.6h-3.2zM13.3 16.6h3.2v3.6h-3.2zM2.6 15.2l-2.2 2l3 0.2z';

export function nextGap(gap: number): number {
  const at = GAPS.findIndex((known) => known === gap);
  return GAPS[(at + 1) % GAPS.length] ?? 0;
}

export function easierButton(settings: Settings): HTMLButtonElement | null {
  if (settings.easier === null) return null;
  const on = settings.easier;
  const made = el('button', { className: `proto-round proto-turtle${on ? ' on' : ''}`, attrs: { type: 'button', 'aria-label': 'Easier', 'aria-pressed': String(on) } }, [icon(TURTLE_PATH)]);
  made.addEventListener('click', () => settings.setEasier(!on));
  return made;
}

export function gapButton(settings: Settings): HTMLButtonElement {
  const { gap } = settings;
  const shown = gap === 0 ? '+0' : gap > 0 ? `+${gap}` : `−${-gap}`;
  const made = el('button', { className: `proto-gap${gap > 0 ? ' up' : gap < 0 ? ' down' : ''}`, attrs: { type: 'button', 'aria-label': 'Wild creature level' } }, [
    el('span', { className: 'proto-gap-lv', text: 'Lv' }),
    el('span', { className: 'proto-gap-value', text: shown }),
  ]);
  made.addEventListener('click', () => settings.setGap(nextGap(gap)));
  return made;
}

/** The bar along the top: the log, the settings this look offers, and a new battle. */
export function topBar(logButton: HTMLButtonElement, settings: Settings, newBattle: HTMLButtonElement): HTMLElement {
  const easier = easierButton(settings);
  const left = el('div', { className: 'proto-top-left' }, [logButton, ...(easier ? [easier] : []), gapButton(settings)]);
  return el('div', { className: 'proto-top' }, [left, newBattle]);
}
