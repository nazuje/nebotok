import { frameNames, type Language, type Tap } from '@nebotok/core';
import { paintFrame, sprite } from '../sprites.ts';

/** What the card tells a tiny game when it draws it. */
export type MiniGameOptions = {
  readonly language: Language;
  /** Motion is reduced: the same timings, with nothing bobbing, fading or sliding. */
  readonly reducedMotion: boolean;
  /** The picture of the spot or pot the game is played at, `spots/<look>` or `stations/<look>`, if any. */
  readonly look: string | null;
  /** The player tapped `place` (0 for dip and marker). */
  press(place: number): void;
};

/**
 * One tiny game inside the card. The card owns the clock and the taps: it draws the game `ms`
 * after it first showed it, passes each press on, keeps only those the game accepts, and finishes
 * the attempt once the game says it is over.
 */
export type MiniGame = {
  readonly element: HTMLElement;
  /** Draws the game `ms` after it was first drawn. */
  frame(ms: number): void;
  /** Whether a press at `place`, `ms` after the game was drawn, is a tap to report. */
  press(place: number, ms: number): boolean;
  /** The place a key presses, or null when the key is not this game's. */
  keyPlace(code: string): number | null;
  /** Whether the game is over after these taps, `ms` after it was drawn. */
  over(taps: readonly Tap[], ms: number): boolean;
  /** Labels the game again in another language. */
  relabel(language: Language): void;
};

/** Keys that play dip and marker. */
export const ACTION_KEYS: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter']);

/** A sprite's frame as an HTML canvas, scaled up crisply by CSS. Falls back to its first frame. */
export function spriteCanvas(id: string, frame: string | null, className: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  canvas.setAttribute('aria-hidden', 'true');
  showFrame(canvas, id, frame);
  return canvas;
}

/** Paints `frame` of sprite `id`, or its first frame when it has no such frame. */
export function showFrame(canvas: HTMLCanvasElement, id: string, frame: string | null): void {
  const names = frameNames(sprite(id));
  const shown = frame !== null && names.includes(frame) ? frame : (names[0] ?? '');
  if (canvas.dataset.frame === shown) return;
  canvas.dataset.frame = shown;
  paintFrame(canvas, id, shown);
}

/**
 * Calls `press` for a pointer landing on `target`, and for a click a keyboard made on it, so a
 * tap counts the moment the finger lands and a focused button still works from the keyboard.
 */
export function onPress(target: HTMLElement, press: () => void): void {
  target.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    press();
  });
  target.addEventListener('click', (event) => {
    if (event.detail === 0) press();
  });
}
