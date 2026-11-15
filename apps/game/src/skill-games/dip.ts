import { FADE_MS, GAME_SPRITES, dipPhase, type DipParams, type Language, type Tap } from '@nebotok/core';
import { el } from '../dom.ts';
import { text } from '../strings.ts';
import { ACTION_KEYS, onPress, showFrame, spriteCanvas, type MiniGame, type MiniGameOptions } from './mini-game.ts';

const FLOAT_ART = GAME_SPRITES.dip[0]!.id;

/** How far the float bobs up and down while it waits, in CSS px, and how long one bob takes. */
const BOB_PX = 4;
const BOB_MS = 900;

/** When a game nobody tapped is over: the window, then the float's fade back up (core `dipPhase`). */
export const dipEndsMs = (params: DipParams): number => params.dipAtMs + params.windowMs + FADE_MS;

/** How far the waiting float sits from its rest, in CSS px: a gentle bob, or none with reduced motion. */
export function dipBob(ms: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : Math.round(Math.sin((ms / BOB_MS) * 2 * Math.PI) * BOB_PX);
}

/**
 * Fishing: a float bobs on the cloud water; when it dips it turns red with a "!", and a tap
 * anywhere (or Space or Enter) pulls. As its window ends the red fades out, and a pull while it
 * fades still counts, as core `judgeAttempt` counts it. The first tap ends the game, early or not.
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
      showFrame(float, FLOAT_ART, phase === 'dip' || phase === 'fading' ? 'dip' : 'still');
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
    aim: (ms) => {
      const phase = dipPhase(params, ms);
      return { target: float, now: phase === 'dip' || phase === 'fading' };
    },
  };
}
