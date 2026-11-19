import type { FightEvent, Side } from '@nebotok/core';
import { popupFor, shakeOf, shakeOffset, stopFor, type Popup, type Shake } from './arena-juice.ts';
import type { Point, Tint } from './arena-paint.ts';
import type { Pen } from './arena-pen.ts';
import { Sparks } from './arena-sparks.ts';

/**
 * The juice of an arena fight's events (docs/arena.md, "Screens and controls"): sparks, smoke,
 * rings and hearts, the island's shake, the hit-stop that holds the drawing still, and the damage
 * numbers, which the page shows as HTML. Under reduced motion only the numbers come.
 */

/** A creature on screen: its middle and its picture's height, in canvas pixels. */
export type Spot = { readonly x: number; readonly y: number; readonly size: number };

export type ReactWith = {
  readonly now: number;
  /** False under reduced motion. */
  readonly motion: boolean;
  readonly yours: Side;
  spot(side: Side): Spot | null;
  /** A point in arena units on the canvas. */
  toScreen(x: number, y: number): Point;
  tint(move: string): Tint;
  /** A number to pop up at (x, y) on the canvas. */
  popup(popup: Popup, x: number, y: number): void;
};

/** What the effects have done this fight, for the test hook. */
export type JuiceCount = {
  /** How far the island is shaken now, and the most it has been, in canvas pixels. */
  readonly shake: number;
  readonly shaken: number;
  /** How many hit-stops started, and how many sparks and numbers. */
  readonly stops: number;
  readonly sparks: number;
  readonly popups: number;
};

const SUB = 256;
const WHITE = 0xffffff;
const tenths = (value: number): number => Math.round(value * 10) / 10;

export class ArenaEffects {
  private readonly sparks = new Sparks();
  private shake: Shake | null = null;
  private shakeAt = 0;
  private stopUntil = 0;
  private stops = 0;
  private popups = 0;
  private shaken = 0;
  private shown = 0;

  reset(): void {
    this.sparks.clear();
    this.sparks.made = 0;
    this.shake = null;
    this.stopUntil = 0;
    this.stops = 0;
    this.popups = 0;
    this.shaken = 0;
    this.shown = 0;
  }

  /** Starts what a frame's events show. */
  react(events: readonly FightEvent[], using: ReactWith): void {
    const { now, motion } = using;
    const stop = stopFor(events, motion);
    if (stop > 0) {
      this.stopUntil = Math.max(this.stopUntil, now + stop);
      this.stops += 1;
    }
    const shake = shakeOf(events, motion);
    if (shake && shake.px >= this.offsetAt(now).size) {
      this.shake = shake;
      this.shakeAt = now;
    }
    for (const event of events) {
      const popup = popupFor(event) ?? (event.kind === 'treatEaten' ? ({ side: using.yours === 0 ? 1 : 0, amount: event.amount, tone: 'heal' } as const) : null);
      const spot = popup ? using.spot(popup.side) : null;
      if (popup && spot) {
        this.popups += 1;
        const jitter = motion ? (Math.random() - 0.5) * spot.size * 0.5 : 0;
        using.popup(popup, spot.x + (popup.tone === 'heal' ? -0.5 : 0.55) * spot.size + jitter, spot.y - spot.size * 0.2);
      }
      if (motion) this.fling(event, using);
    }
  }

  /** The sparks, rings and hearts of one event. */
  private fling(event: FightEvent, using: ReactWith): void {
    const sparks = this.sparks;
    const spot = 'side' in event ? using.spot(event.side) : null;
    switch (event.kind) {
      case 'hit': {
        if (!spot) return;
        const big = event.knock > 700;
        sparks.burst(spot.x, spot.y, { colour: using.tint(event.move).main, count: big ? 22 : 12, speed: big ? 420 : 280, size: big ? 9 : 7, shape: 'square', life: 520, gravity: 500 });
        sparks.burst(spot.x, spot.y, { colour: WHITE, count: 6, speed: 300, size: 6, shape: 'line', life: 260, gravity: 0 });
        return;
      }
      case 'healed':
        if (spot) sparks.burst(spot.x, spot.y, { colour: 0x8ce99a, count: 5, speed: 90, size: 6, shape: 'dot', life: 500, gravity: -120 });
        return;
      case 'blocked':
        if (!spot) return;
        sparks.ring(spot.x, spot.y, 0xfcc419, spot.size * 0.7, 380);
        sparks.burst(spot.x, spot.y, { colour: 0xfff3bf, count: 14, speed: 320, size: 7, shape: 'square', life: 420, gravity: 0 });
        return;
      case 'cast':
        if (spot && (event.shape === 'freeze' || event.shape === 'zone' || event.shape === 'wall')) sparks.ring(spot.x, spot.y, using.tint(event.move).main, spot.size * 0.8, 420);
        return;
      case 'dashed':
        if (spot) sparks.burst(spot.x, spot.y + spot.size * 0.4, { colour: 0xe9ecef, count: 10, speed: 160, size: 10, shape: 'dot', life: 420, gravity: -40 });
        return;
      case 'bumped': {
        const at = using.toScreen(event.x / SUB, event.y / SUB);
        sparks.burst(at.x, at.y, { colour: 0xffd43b, count: 14, speed: 340, size: 7, shape: 'square', life: 420, gravity: 300 });
        return;
      }
      case 'fainted':
        if (spot) sparks.burst(spot.x, spot.y, { colour: 0xffd43b, count: 10, speed: 140, size: 9, shape: 'square', life: 900, gravity: -20 });
        return;
      case 'status':
        if (spot && event.status === 'root') sparks.burst(spot.x, spot.y, { colour: 0xe3fafc, count: 16, speed: 260, size: 8, shape: 'square', life: 520, gravity: 200 });
        return;
      case 'entered':
        if (spot) sparks.burst(spot.x, spot.y, { colour: WHITE, count: 16, speed: 200, size: 12, shape: 'dot', life: 500, gravity: -40 });
        return;
      default:
        this.flingAround(event, using);
    }
  }

  /** The events that happen to the island or the fight rather than to one creature. */
  private flingAround(event: FightEvent, using: ReactWith): void {
    const sparks = this.sparks;
    const wild = using.spot(using.yours === 0 ? 1 : 0);
    if (event.kind === 'befriended' && wild) {
      sparks.hearts(wild.x, wild.y, wild.size * 0.16);
      sparks.ring(wild.x, wild.y, 0xff8fab, wild.size, 600);
    } else if ((event.kind === 'treatEaten' || event.kind === 'treatPickedUp') && wild) {
      const by = event.kind === 'treatEaten' ? wild : using.spot(using.yours);
      if (by) sparks.burst(by.x, by.y, { colour: event.kind === 'treatEaten' ? WHITE : 0xff8fab, count: 8, speed: 120, size: 7, shape: 'dot', life: 420, gravity: -60 });
    } else if (event.kind === 'stormShrank') {
      const radius = event.radius / SUB;
      for (let at = 0; at < 28; at += 1) {
        const angle = (at / 28) * Math.PI * 2;
        const point = using.toScreen(Math.cos(angle) * radius, Math.sin(angle) * radius);
        sparks.burst(point.x, point.y, { colour: at % 2 ? 0x8a6a55 : 0x5d4537, count: 2, speed: 120, size: 8, shape: 'square', life: 700, gravity: 500 });
      }
    }
  }

  /** A poof where a creature falling off the edge vanishes into the clouds. */
  poof(x: number, y: number, size: number): void {
    this.sparks.burst(x, y, { colour: WHITE, count: 18, speed: 160, size: size * 0.08, shape: 'dot', life: 700, gravity: -40 });
    this.sparks.ring(x, y, WHITE, size * 0.35, 400);
  }

  /** Smoke behind a creature dashing or lunging at (vx, vy) canvas pixels a second. */
  smoke(spot: Spot, vx: number, vy: number): void {
    for (let at = 0; at < 2; at += 1) this.sparks.smoke(spot.x, spot.y + spot.size * 0.4, spot.size, vx, vy);
  }

  /** Whether a hit-stop holds the drawing still now. */
  stopped(now: number): boolean {
    return now < this.stopUntil;
  }

  private offsetAt(now: number): Point & { size: number } {
    const at = shakeOffset(this.shake, now - this.shakeAt);
    return { ...at, size: Math.hypot(at.x, at.y) };
  }

  /** How far the shake moves the island now, in canvas pixels. */
  offset(now: number): Point {
    const at = this.offsetAt(now);
    this.shown = at.size;
    this.shaken = Math.max(this.shaken, at.size);
    return at;
  }

  /** Moves the sparks on by `ms` and draws them. */
  draw(pen: Pen, ms: number): void {
    this.sparks.update(ms);
    this.sparks.draw(pen);
  }

  count(): JuiceCount {
    return { shake: tenths(this.shown), shaken: tenths(this.shaken), stops: this.stops, sparks: this.sparks.made, popups: this.popups };
  }
}
