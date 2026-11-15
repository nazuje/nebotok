import type { GameKind } from '@nebotok/core';
import { z } from 'zod';
import { el, element } from './dom.ts';
import type { Aim } from './skill-games/mini-game.ts';

const STORAGE_KEY = 'nebotok:gameHints';

const GAMES = ['dip', 'sparkle', 'marker'] as const satisfies readonly GameKind[];

/** The tiny games each player has tapped in on this device, by profile id. */
const Seen = z.record(z.string(), z.array(z.enum(GAMES)));
export type Seen = z.infer<typeof Seen>;

/** What the device stored, or nothing seen when it stored nothing or something else. */
export function parseSeen(stored: string | null): Seen {
  try {
    const parsed = Seen.safeParse(JSON.parse(stored ?? '{}'));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** `seen` with `game` added for `player`. */
export function withSeen(seen: Seen, player: number, game: GameKind): Seen {
  const games = seen[player] ?? [];
  return games.includes(game) ? seen : { ...seen, [player]: [...games, game] };
}

function storedSeen(): Seen {
  try {
    return parseSeen(localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function rememberSeen(player: number, game: GameKind): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(withSeen(storedSeen(), player, game)));
  } catch {
    // Private browsing can refuse storage; the hand then shows again on the next visit.
  }
}

export type GameHint = {
  /** The hand's layer, to lay over the play area. */
  readonly element: HTMLElement;
  /** A new game was drawn for `player` (null when unknown): the hand shows unless they have tapped in this kind of game before. */
  start(game: GameKind, player: number | null): void;
  /** Points the hand at `aim`, tapping when it is the moment, or hides it while there is nothing to tap. Called every frame. */
  aim(aim: Aim | null): void;
  /** The player tapped: the hand goes, and for this kind of game it stays gone for them on this device. */
  tapped(): void;
  /** Whether the hand is showing. */
  shown(): boolean;
};

/**
 * The first-time demo hand of a tiny game, for players who cannot read its hint: the walking
 * hint's finger over what to tap (the float, the sparkle on show, the Stop button), tapping when
 * it is the moment. Each player sees it for each kind of game until their first tap in one.
 */
export function createGameHint(): GameHint {
  const root = el('div', { className: 'skill-demo', attrs: { 'aria-hidden': 'true' } }, [el('div', { className: 'walk-hint-ripple' })]);
  root.append(element<SVGSVGElement>('.walk-hint-hand').cloneNode(true));
  root.hidden = true;
  let game: GameKind | null = null;
  let player: number | null = null;
  let active = false;
  let placed = '';

  function place(spot: { x: number; y: number; now: boolean } | null) {
    const key = spot ? `${spot.x},${spot.y},${spot.now}` : '';
    if (key === placed) return;
    placed = key;
    root.hidden = spot === null;
    if (!spot) return;
    root.style.setProperty('--hint-x', `${spot.x}px`);
    root.style.setProperty('--hint-y', `${spot.y}px`);
    root.dataset.now = String(spot.now);
  }

  return {
    element: root,
    start: (next, who) => {
      game = next;
      player = who;
      active = who === null || !(storedSeen()[who] ?? []).includes(next);
      place(null);
    },
    aim: (aim) => {
      // The layer fills the play area, which is measured instead since a hidden layer has no box.
      const box = root.parentElement?.getBoundingClientRect();
      if (!active || !aim || !box) {
        place(null);
        return;
      }
      const target = aim.target.getBoundingClientRect();
      place({ x: Math.round(target.left + target.width / 2 - box.left), y: Math.round(target.top + target.height / 2 - box.top), now: aim.now });
    },
    tapped: () => {
      if (!active) return;
      active = false;
      if (player !== null && game !== null) rememberSeen(player, game);
      place(null);
    },
    shown: () => !root.hidden,
  };
}
