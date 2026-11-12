import { GAME_SPRITES, GRACE_MS, type DipParams, type Language, type Tap } from '@nebotok/core';
import { el } from '../dom.ts';
import { text } from '../strings.ts';
import { ACTION_KEYS, onPress, showFrame, spriteCanvas, type MiniGame, type MiniGameOptions } from './mini-game.ts';

const FLOAT_ART = GAME_SPRITES.dip[0]!.id;

/** How far the float bobs up and down while it waits, in CSS px, and how long one bob takes. */
const BOB_PX = 4;
const BOB_MS = 900;

export type DipPhase = 'wait' | 'dip' | 'over';

/** Whether the float is waiting, dipped (tap now!) or back up after its window, `ms` after the game was drawn. */
export function dipPhase(params: DipParams, ms: number): DipPhase {
  if (ms < params.dipAtMs) return 'wait';
  return ms < params.dipAtMs + params.windowMs ? 'dip' : 'over';
}

/** When a game nobody tapped is over: the window and the grace the server allows after it. */
export const dipEndsMs = (params: DipParams): number => params.dipAtMs + params.windowMs + GRACE_MS;

/** How far the waiting float sits from its rest, in CSS px: a gentle bob, or none with reduced motion. */
export function dipBob(ms: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.round(Math.sin((ms / BOB_MS) * 2 * Math.PI) * BOB_PX);
}

/**
 * Fishing: a float bobs on the cloud water; when it dips it turns red with a "!", and a tap
 * anywhere (or Space or Enter) pulls. The first tap ends the game, early or not.
 */
export function createDip(params: DipParams, options: MiniGameOptions): MiniGame {
  const float = spriteCanvas(FLOAT_ART, 'still', 'dip-float');
  const mark = el('span', { className: 'dip-mark', text: '!', attrs: { 'aria-hidden': 'true' } });
  const bobber = el('div', { className: 'dip-bobber' }, [float, mark]);
  const area = el('button', { className: 'skill-area dip', attrs: { type: 'button', 'aria-label': text('skill.dip.pull', options.language) } }, [el('div', { className: 'dip-water' }), bobber]);
  let pulledAt: number | null = null;
  onPress(area, () => options.press(0));

  return {
    element: area,
    frame: (ms) => {
      const at = pulledAt ?? ms;
      const phase = dipPhase(params, at);
      area.dataset.phase = pulledAt === null ? phase : 'pulled';
      showFrame(float, FLOAT_ART, phase === 'dip' ? 'dip' : 'still');
      bobber.style.transform = phase === 'wait' && pulledAt === null ? `translateY(${dipBob(ms, options.reducedMotion)}px)` : '';
    },
    press: (_place, ms) => {
      if (pulledAt !== null) return false;
      pulledAt = ms;
      return true;
    },
    keyPlace: (code) => (ACTION_KEYS.has(code) ? 0 : null),
    over: (taps: readonly Tap[], ms) => taps.length > 0 || ms >= dipEndsMs(params),
    relabel: (language: Language) => area.setAttribute('aria-label', text('skill.dip.pull', language)),
  };
}
