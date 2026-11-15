import type { ArenaScene, Judgement, RingKind } from './prototype-arena.ts';

/** How long a ring takes to reach the inner circle, and how far off a tap may be for each judgement. */
export type Windows = { readonly ringMs: number; readonly perfectMs: number; readonly goodMs: number };

/** A tap this much earlier than the good window is taken as a stray tap and ignored. */
const IGNORE_EARLY_MS = 300;

/** The easier setting: windows this much wider, and everything this much slower. */
export const EASIER_WIDER = 1.6;
export const EASIER_SPEED = 0.75;

export function easierWindows(windows: Windows): Windows {
  return { ringMs: Math.round(windows.ringMs / EASIER_SPEED), perfectMs: Math.round(windows.perfectMs * EASIER_WIDER), goodMs: Math.round(windows.goodMs * EASIER_WIDER) };
}

export function judge(offMs: number, windows: Windows): Judgement {
  const distance = Math.abs(offMs);
  return distance <= windows.perfectMs ? 'perfect' : distance <= windows.goodMs ? 'good' : 'miss';
}

/** Waits for a tap or Space while the ring shrinks, and judges how close it came. No tap is a miss. */
export function timedTap(arena: ArenaScene, kind: RingKind, windows: Windows): Promise<Judgement> {
  const target = arena.startRing(kind, windows.ringMs, windows.perfectMs);
  return new Promise((resolve) => {
    const finish = (judgement: Judgement) => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
      arena.stopRing();
      resolve(judgement);
    };
    const tapped = () => {
      const off = performance.now() - target;
      if (off < -windows.goodMs - IGNORE_EARLY_MS) return;
      finish(judge(off, windows));
    };
    const onPointer = () => tapped();
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      tapped();
    };
    const timer = setTimeout(() => finish('miss'), windows.ringMs + windows.goodMs);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
  });
}
