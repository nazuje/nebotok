import type { StringId } from '@nebotok/core';
import type { Screen } from './test-hook.ts';

/** A button that goes back or closes what it sits on, by its class: a `…-close` or `…-back` button, or a tiny game's Close. */
const BACK_BUTTON = /(^|\s)([a-z-]+-(close|back)|skill-done)(\s|$)/;

/** The sound a tap on a button with these classes plays: `ui.back` for one that goes back or closes, else `ui.tap`. */
export const tapSoundOf = (className: string): string => (BACK_BUTTON.test(className) ? 'ui.back' : 'ui.tap');

/** Screens a button opens over the world, which open and close with a sound. Fights, talks, duels and tiny games make their own. */
const PANELS: ReadonlySet<Screen> = new Set<Screen>(['team', 'loadout', 'bag', 'journal', 'recipeBook', 'jobBoard', 'pinSetup']);
/** Screens that come and go over a panel without closing it: a dish's tiny game over the recipe book. */
const OVER_PANELS: ReadonlySet<Screen> = new Set<Screen>(['skillGame']);

/** The sound of the screen changing from `from` to `to`: a panel opening over the world or closing back to it, else none. */
export function panelSound(from: Screen, to: Screen): string | null {
  if (from === 'world' && PANELS.has(to)) return 'ui.open';
  if (PANELS.has(from) && to === 'world') return 'ui.close';
  return null;
}

/** Plays `panelSound` each time the page shows another screen. The first screen the page shows makes no sound. */
export function createPanelSounds(play: (id: string) => void): (screen: Screen) => void {
  let last: Screen | null = null;
  return (screen) => {
    if (OVER_PANELS.has(screen)) return;
    const id = last === null ? null : panelSound(last, screen);
    last = screen;
    if (id !== null) play(id);
  };
}

/** Toasts whose news has a sound of its own; every other toast plays `ui.toast`. */
const TOAST_SOUNDS: Partial<Readonly<Record<StringId, string>>> = { 'shrine.rested': 'world.shrine-rest', 'duel.no': 'world.duel.declined' };

/** The sound a toast at the bottom of the screen plays as it shows. */
export const toastSound = (id: StringId): string => TOAST_SOUNDS[id] ?? 'ui.toast';
