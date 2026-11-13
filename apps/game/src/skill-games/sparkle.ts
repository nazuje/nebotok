import { FADE_MS, GAME_SPRITES, SPARKLE_PLACES, shownSparkle, sparkleFading, sparkleHit, spriteFor, type Language, type SparkleParams, type Tap } from '@nebotok/core';
import { el } from '../dom.ts';
import { text } from '../strings.ts';
import { onPress, spriteCanvas, type MiniGame, type MiniGameOptions } from './mini-game.ts';

const SPARKLE_ART = GAME_SPRITES.sparkle[0]!.id;

/** Where each place is around the bush: 0 above, 1 left, 2 right, 3 below. */
export const SPARKLE_PLACE_NAMES = ['up', 'left', 'right', 'down'] as const;

const PLACE_KEYS: Readonly<Record<string, number>> = { ArrowUp: 0, KeyW: 0, ArrowLeft: 1, KeyA: 1, ArrowRight: 2, KeyD: 2, ArrowDown: 3, KeyS: 3 };

/** When a game is over on its own: the last sparkle shown and faded out. */
export const sparkleEndsMs = (params: SparkleParams): number => Math.max(0, ...params.sparkles.map((sparkle) => sparkle.atMs + sparkle.showMs)) + FADE_MS;

/**
 * Foraging: a bush with four places around it, above, left, right and below. One sparkle shows at a
 * time (core `shownSparkle`), fading out as its time ends; tapping it while it shows or fades (or
 * the arrow or WASD key for its place) picks it, as core `judgeAttempt` counts it. Only taps that pick a sparkle
 * are reported, so mashing cannot use up the taps an attempt may send. The game ends when every
 * sparkle is picked or the last one is gone.
 */
export function createSparkle(params: SparkleParams, options: MiniGameOptions): MiniGame {
  const hit = new Set<number>();
  const places = Array.from({ length: SPARKLE_PLACES }, (_, place) => {
    const spot = el('button', { className: 'sparkle-place', attrs: { type: 'button', 'data-place': SPARKLE_PLACE_NAMES[place] ?? String(place), 'aria-label': text('skill.sparkle.place', options.language) } }, [spriteCanvas(SPARKLE_ART, null, 'sparkle-gem')]);
    onPress(spot, () => options.press(place));
    return spot;
  });
  const bush = options.look ? [spriteCanvas(spriteFor.spot(options.look), 'ready', 'sparkle-bush')] : [];
  const area = el('div', { className: 'skill-area sparkle' }, [el('div', { className: 'sparkle-middle' }, bush), ...places]);

  return {
    element: area,
    frame: (ms) => {
      const shown = shownSparkle(params, hit, ms);
      const place = shown === null ? null : (params.sparkles[shown]?.place ?? null);
      const fading = shown !== null && sparkleFading(params.sparkles[shown]!, ms);
      places.forEach((spot, at) => {
        spot.dataset.on = String(at === place);
        spot.dataset.fading = String(at === place && fading);
      });
      area.dataset.picked = String(hit.size);
    },
    press: (place, ms) => {
      const found = sparkleHit(params, hit, place, ms);
      if (found === null) return false;
      hit.add(found);
      return true;
    },
    keyPlace: (code) => PLACE_KEYS[code] ?? null,
    over: (_taps: readonly Tap[], ms) => hit.size === params.sparkles.length || ms >= sparkleEndsMs(params),
    relabel: (language: Language) => {
      for (const spot of places) spot.setAttribute('aria-label', text('skill.sparkle.place', language));
    },
  };
}
