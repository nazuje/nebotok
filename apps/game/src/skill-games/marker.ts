import { GAME_SPRITES, MARKER_HALF_WIDTH, MARKER_TRACK, markerAt, type Language, type MarkerParams, type Tap } from '@nebotok/core';
import { el } from '../dom.ts';
import { text } from '../strings.ts';
import { ACTION_KEYS, onPress, spriteCanvas, type MiniGame, type MiniGameOptions } from './mini-game.ts';

const MARKER_ART = GAME_SPRITES.marker[0]!.id;

/**
 * With reduced motion the marker jumps a needle's width at a time instead of sliding. Drawn at most
 * half a needle from where it really is, a needle drawn touching the zone always counts.
 */
export const MARKER_STEP = 2 * MARKER_HALF_WIDTH;

/**
 * Where to draw the marker `ms` after the game was drawn, 0 to MARKER_TRACK: where core
 * `markerAt` puts it, or with reduced motion the nearest step, never more than half a step away.
 * It stops moving at `timeoutMs`.
 */
export function markerShown(params: MarkerParams, ms: number, reducedMotion: boolean): number {
  const at = markerAt(params.sweepMs, Math.min(Math.max(ms, 0), params.timeoutMs));
  return reducedMotion ? Math.round(at / MARKER_STEP) * MARKER_STEP : at;
}

/** When a game nobody stopped is over: its timeout, after which a stop is a miss. */
export const markerEndsMs = (params: MarkerParams): number => params.timeoutMs;

const share = (value: number) => `${(value * 100) / MARKER_TRACK}%`;

/**
 * Cooking: a marker sweeps a bar to and fro, with a green zone and a lighter perfect band in its
 * middle. The big Stop button (or Space or Enter) stops it; the first stop ends the game. The
 * needle is drawn as wide as core `judgeAttempt` counts it, and once stopped it shows exactly
 * where the server judges it, reduced motion or not.
 */
export function createMarker(params: MarkerParams, options: MiniGameOptions): MiniGame {
  const zone = el('div', { className: 'marker-zone' });
  zone.style.left = share(params.zoneFrom);
  zone.style.width = share(params.zoneTo - params.zoneFrom);
  const perfect = el('div', { className: 'marker-perfect' });
  perfect.style.left = share(params.perfectFrom);
  perfect.style.width = share(params.perfectTo - params.perfectFrom);
  const head = el('div', { className: 'marker-head' }, [spriteCanvas(MARKER_ART, null, 'marker-gem')]);
  head.style.width = share(2 * MARKER_HALF_WIDTH);
  const bar = el('div', { className: 'marker-bar', attrs: { 'aria-hidden': 'true' } }, [zone, perfect, head]);
  const stop = el('button', { className: 'primary marker-stop', text: text('skill.marker.stop', options.language), attrs: { type: 'button' } });
  onPress(stop, () => options.press(0));
  const area = el('div', { className: 'skill-area marker' }, [bar, stop]);
  let stoppedAt: number | null = null;

  return {
    element: area,
    frame: (ms) => {
      head.style.left = share(stoppedAt === null ? markerShown(params, ms, options.reducedMotion) : markerShown(params, stoppedAt, false));
      area.dataset.stopped = String(stoppedAt !== null);
    },
    press: (_place, ms) => {
      if (stoppedAt !== null) return false;
      stoppedAt = ms;
      stop.disabled = true;
      return true;
    },
    keyPlace: (code) => (ACTION_KEYS.has(code) ? 0 : null),
    over: (taps: readonly Tap[], ms) => taps.length > 0 || ms >= markerEndsMs(params),
    relabel: (language: Language) => {
      stop.textContent = text('skill.marker.stop', language);
    },
  };
}
