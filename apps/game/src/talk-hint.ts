import type { Point } from '@nebotok/core';

export type TalkHint = {
  /** Points at this spot on the page, in CSS pixels, or hides when null. */
  update(at: Point | null): void;
  shown(): boolean;
};

/**
 * A wordless hint for a new player, like the walking hint: a finger tapping the character who
 * gives the first creature, until the player has one.
 */
export function createTalkHint(root: HTMLElement): TalkHint {
  let shownAt: string | null = null;
  return {
    update: (at) => {
      const spot = at && { x: Math.round(at.x), y: Math.round(at.y) };
      const key = spot && `${spot.x},${spot.y}`;
      if (key === shownAt) return;
      shownAt = key;
      root.hidden = spot === null;
      if (!spot) return;
      root.style.setProperty('--hint-x', `${spot.x}px`);
      root.style.setProperty('--hint-y', `${spot.y}px`);
    },
    shown: () => shownAt !== null,
  };
}
