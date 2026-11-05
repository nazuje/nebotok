import type { Controls } from './controls-choice.ts';

const STORAGE_KEY = 'nebotok:walkHint';

function alreadyWalked(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

function rememberWalked(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify('walked'));
  } catch {
    // Private browsing can refuse storage; the hint then shows again on the next visit.
  }
}

export type WalkHint = {
  /** Shows or hides the hint for the chosen controls; once walked on this device it never shows. */
  update(showing: boolean, controls: Controls): void;
  /** The player has walked: the hint goes for good on this device. */
  walked(): void;
  /** The controls the hint is shown for, or null while it is hidden. */
  shown(): Controls | null;
};

/**
 * A wordless first-visit hint, for players who cannot read it yet: a pulsing finger tapping the
 * ground for tap controls, or a thumb on a joystick on the left. Each device sees it until its
 * first walk.
 */
export function createWalkHint(root: HTMLElement): WalkHint {
  let done = alreadyWalked();
  let shown: Controls | null = null;
  const show = (next: Controls | null) => {
    if (next === shown) return;
    shown = next;
    root.hidden = next === null;
    if (next) root.dataset.controls = next;
  };
  return {
    update: (showing, controls) => show(showing && !done ? controls : null),
    walked: () => {
      if (done) return;
      done = true;
      rememberWalked();
      show(null);
    },
    shown: () => shown,
  };
}
