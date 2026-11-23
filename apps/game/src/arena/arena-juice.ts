import type { FightEvent, Side } from '@nebotok/core';
import { moveArena } from '../move-arena.ts';

/**
 * How an arena fight's events are felt (docs/arena.md, "Screens and controls", Juice): which
 * hit-stop, shake, damage number and buzz each event gives, the colour of a level badge and which
 * way a creature's picture faces. The
 * numbers come from the battle-feel prototype's `react()`. With reduced motion there is no
 * hit-stop, no shake and no buzz; numbers and bars stay. The scene and the link do the drawing
 * and the buzzing; this only decides.
 */

/** A level badge: red when its creature is higher than the other, green when lower, blue when even. */
export type BadgeTone = 'higher' | 'lower' | 'even';

export const badgeTone = (level: number, other: number | null): BadgeTone => (other === null || level === other ? 'even' : level > other ? 'higher' : 'lower');

/** A whole facing on the wire, as `DIRECTION_VECTORS` gives it. */
const DIRECTION_SCALE = 4096;

/**
 * Whether a creature's picture is drawn mirrored, from the x of its facing (`DIRECTION_VECTORS`):
 * its `front` picture faces left (docs/art.md), so it is mirrored while the creature faces right,
 * and facing nearly straight up or down keeps the way it was (`was`).
 */
export function mirroredFor(facingX: number, was: boolean): boolean {
  if (facingX > DIRECTION_SCALE * 0.15) return true;
  if (facingX < -DIRECTION_SCALE * 0.15) return false;
  return was;
}

/** Hit-stop by event, in ms: the drawing holds still this long, while the fight goes on. */
export const HIT_STOP_MS = { hit: 60, bigHit: 110, blocked: 60, bumped: 70, rooted: 90, befriended: 120, fainted: 160 } as const;

/** A hit knocking harder than this, in arena units a second, or by one of `BIG_SHAPES`, is a big one. */
const BIG_KNOCK = 700;
const BIG_SHAPES: ReadonlySet<string> = new Set(['lunge', 'wall', 'freeze']);
const MAX_SHAKE_PX = 14;

type HitEvent = Extract<FightEvent, { kind: 'hit' }>;

/** A zone's pulse lands every half second: it shows its number but neither stops nor shakes. */
const pulse = (event: HitEvent): boolean => moveArena(event.move)?.shape === 'zone';

export function bigHit(event: HitEvent): boolean {
  const shape = moveArena(event.move)?.shape;
  return event.knock > BIG_KNOCK || (shape !== undefined && BIG_SHAPES.has(shape));
}

/** The hit-stop one event gives, in ms; 0 with reduced motion (`motion` false). */
export function hitStopMs(event: FightEvent, motion: boolean): number {
  if (!motion) return 0;
  switch (event.kind) {
    case 'hit':
      return pulse(event) ? 0 : bigHit(event) ? HIT_STOP_MS.bigHit : HIT_STOP_MS.hit;
    case 'blocked':
      return HIT_STOP_MS.blocked;
    case 'bumped':
      return HIT_STOP_MS.bumped;
    case 'status':
      return event.status === 'root' ? HIT_STOP_MS.rooted : 0;
    case 'befriended':
      return HIT_STOP_MS.befriended;
    case 'fainted':
      return HIT_STOP_MS.fainted;
    default:
      return 0;
  }
}

/** The longest hit-stop of a frame's events. */
export const stopFor = (events: readonly FightEvent[], motion: boolean): number => events.reduce((most, event) => Math.max(most, hitStopMs(event, motion)), 0);

/** A shake of the island: `px` at its start, fading over `ms`. */
export type Shake = { readonly ms: number; readonly px: number };

/** The shake one event gives, or null: none with reduced motion. */
export function shakeFor(event: FightEvent, motion: boolean): Shake | null {
  if (!motion) return null;
  switch (event.kind) {
    case 'hit':
      if (pulse(event)) return null;
      return { ms: bigHit(event) ? 260 : 150, px: Math.min(MAX_SHAKE_PX, 3 + event.knock / 120) };
    case 'bumped':
      return { ms: 200, px: 8 };
    case 'ringOut':
      return { ms: 300, px: 6 };
    case 'stormShrank':
      return { ms: 350, px: 5 };
    default:
      return null;
  }
}

/** The strongest shake of a frame's events, or null. */
export function shakeOf(events: readonly FightEvent[], motion: boolean): Shake | null {
  let strongest: Shake | null = null;
  for (const event of events) {
    const shake = shakeFor(event, motion);
    if (shake && (!strongest || shake.px > strongest.px)) strongest = shake;
  }
  return strongest;
}

/** How far a shake that started `ago` ms back moves the island now, in pixels: it eases out. */
export function shakeOffset(shake: Shake | null, ago: number): { readonly x: number; readonly y: number } {
  if (!shake || ago < 0 || ago >= shake.ms) return { x: 0, y: 0 };
  const progress = ago / Math.max(1, shake.ms);
  const fade = shake.px * (1 - progress) * (1 - progress);
  return { x: fade * Math.sin(progress * 53), y: fade * Math.cos(progress * 41) };
}

/** A number that pops over a creature: damage, yellow with "!" when strong, or health back. */
export type Popup = { readonly side: Side; readonly amount: number; readonly tone: 'strong' | 'normal' | 'weak' | 'heal' };

export function popupFor(event: FightEvent): Popup | null {
  if (event.kind === 'hit' && event.damage > 0) return { side: event.side, amount: event.damage, tone: event.effectiveness };
  if (event.kind === 'healed' && event.amount > 0) return { side: event.side, amount: event.amount, tone: 'heal' };
  return null;
}

/** Vibration patterns, in ms, for `navigator.vibrate`. */
export const BUZZ = { hit: [20], bigHit: [40], ringOut: [60, 40, 60], befriended: [30, 50, 30, 50, 60] } as const;

/**
 * The buzz one event gives the player on side `yours`: only a hit to your creature, a ring-out and
 * a befriending, and never with reduced motion.
 */
export function buzzFor(event: FightEvent, yours: Side, motion: boolean): readonly number[] | null {
  if (!motion) return null;
  if (event.kind === 'hit') return event.side === yours && event.damage > 0 ? (bigHit(event) ? BUZZ.bigHit : BUZZ.hit) : null;
  if (event.kind === 'ringOut') return BUZZ.ringOut;
  if (event.kind === 'befriended') return BUZZ.befriended;
  return null;
}

/** Whether the page asks for reduced motion. */
export const motionReduced = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
