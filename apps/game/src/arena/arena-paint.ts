import type { ArenaShape } from '@nebotok/core';
import type { Pen } from './arena-pen.ts';

/**
 * How the arena looks, painted through a `Pen` in screen pixels from arena units by a `Fit`: the
 * floating island, the storm, everything moves leave on it, and the marks on creatures. Ported
 * from the battle-feel prototype's painter. Nothing here reads the fight; callers pass what to draw.
 */

export type Fit = { readonly cx: number; readonly cy: number; readonly s: number };
export type Point = { readonly x: number; readonly y: number };
/** A move's colours, from its type: light, main and dark. */
export type Tint = { readonly light: number; readonly main: number; readonly dark: number };

export const INK = 0x102a43;
const SKY_TOP = 0x8fd3ff;
const SKY_LOW = 0xd6f0ff;
const GRASS = 0x69c96f;
const GRASS_LIGHT = 0x8fdc8a;
const GRASS_DARK = 0x4fae5b;
const ROCK = 0x8a6a55;
const ROCK_LIGHT = 0xa78f80;
const ROCK_DARK = 0x5d4537;
const STORM_CLOUD = 0x4a4563;
const STORM_MID = 0x625d80;
const STORM_TOP = 0x8a86a6;
const DANGER = 0xff3b3b;
const WARN = 0xff6b6b;
const TREAT = 0xff8fab;

export const toScreen = (fit: Fit, x: number, y: number): Point => ({ x: fit.cx + x * fit.s, y: fit.cy + y * fit.s });

export function lerpColour(from: number, to: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) * (1 - k) + ((to >> shift) & 0xff) * k);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

function trace(pen: Pen, points: readonly Point[]): void {
  const [first, ...others] = points;
  if (!first) return;
  pen.beginPath();
  pen.moveTo(first.x, first.y);
  for (const point of others) pen.lineTo(point.x, point.y);
}

export function fillPoly(pen: Pen, points: readonly Point[]): void {
  trace(pen, points);
  pen.closePath();
  pen.fillPath();
}

function star(x: number, y: number, outer: number, inner: number, points: number): Point[] {
  return Array.from({ length: points * 2 }, (_, at) => {
    const angle = -Math.PI / 2 + (at * Math.PI) / points;
    const r = at % 2 === 0 ? outer : inner;
    return { x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r };
  });
}

/** A spiky burst with an ink outline. */
export function drawBurst(pen: Pen, x: number, y: number, r: number, colour: number, alpha = 1): void {
  pen.fillStyle(INK, alpha);
  fillPoly(pen, star(x, y, r + 3, r * 0.62 + 2, 10));
  pen.fillStyle(colour, alpha);
  fillPoly(pen, star(x, y, r, r * 0.62, 10));
}

/** The sky behind the island, lighter towards the bottom. */
export function drawSky(pen: Pen, width: number, height: number): void {
  const bands = 6;
  for (let band = 0; band < bands; band += 1) {
    pen.fillStyle(lerpColour(SKY_TOP, SKY_LOW, band / (bands - 1)), 1);
    pen.fillRect(0, Math.floor((height * band) / bands), width, Math.ceil(height / bands) + 1);
  }
}

/** Fixed tufts of darker grass, at a share of the starting radius, so the island keeps its look as it shrinks. */
const TUFTS: readonly { a: number; r: number; size: number }[] = Array.from({ length: 46 }, (_, at) => ({ a: at * 2.399963, r: Math.sqrt((at + 0.5) / 46) * 0.93, size: 0.6 + ((at * 7) % 5) / 6 }));

/** The floating island seen from above: its rock underside peeking out below, the rocky rim and the grass. `start` is its first radius, `body` a creature's. */
export function drawIsland(pen: Pen, fit: Fit, radius: number, start: number, body: number): void {
  const r = radius * fit.s;
  const rim = Math.max(5, body * 0.35 * fit.s);
  const { cx, cy } = fit;
  pen.fillStyle(ROCK_DARK, 1);
  pen.fillEllipse(cx, cy + r * 0.16, (r + rim) * 1.96, (r + rim) * 1.9);
  const drips = 9;
  for (let at = 0; at < drips; at += 1) {
    const a = Math.PI * (0.12 + (0.76 * at) / (drips - 1));
    const bx = cx + Math.cos(a) * r * 0.92;
    const by = cy + r * 0.16 + Math.sin(a) * r * 0.92;
    const depth = r * (0.14 + 0.1 * Math.abs(Math.sin(at * 1.7)));
    pen.fillTriangle(bx - r * 0.09, by, bx + r * 0.09, by, bx, by + depth);
  }
  pen.fillStyle(ROCK, 1);
  pen.fillCircle(cx, cy, r + rim);
  pen.fillStyle(ROCK_LIGHT, 1);
  pen.fillCircle(cx, cy - rim * 0.3, r + rim * 0.55);
  pen.fillStyle(GRASS_DARK, 1);
  pen.fillCircle(cx, cy, r);
  pen.fillStyle(GRASS, 1);
  pen.fillCircle(cx, cy - rim * 0.25, r * 0.985);
  pen.fillStyle(GRASS_LIGHT, 0.45);
  pen.fillCircle(cx - r * 0.18, cy - r * 0.2, r * 0.55);
  for (const tuft of TUFTS) {
    const distance = tuft.r * start;
    if (distance > radius - body * 0.4) continue;
    const x = cx + Math.cos(tuft.a) * distance * fit.s;
    const y = cy + Math.sin(tuft.a) * distance * fit.s;
    const size = body * 0.22 * tuft.size * fit.s;
    pen.fillStyle(GRASS_DARK, 0.7);
    pen.fillTriangle(x - size, y + size * 0.5, x - size * 0.4, y - size, x, y + size * 0.5);
    pen.fillTriangle(x, y + size * 0.5, x + size * 0.5, y - size * 1.2, x + size, y + size * 0.5);
  }
}

/** A ring of storm cloud puffs at `radius`, each a dark body with lighter lumps on top. */
function cloudRing(pen: Pen, fit: Fit, radius: number, size: number, alpha: number, turn: number, now: number): void {
  const puffs = Math.max(16, Math.round((Math.PI * 2 * radius) / (size * 1.15)));
  const s = size * fit.s;
  const at = (index: number) => {
    const a = (index / puffs) * Math.PI * 2 + turn;
    return { x: fit.cx + Math.cos(a) * radius * fit.s, y: fit.cy + Math.sin(a) * radius * fit.s, wobble: 1 + 0.1 * Math.sin(index * 2.3 + now / 500) };
  };
  pen.fillStyle(STORM_CLOUD, alpha);
  for (let index = 0; index < puffs; index += 1) {
    const { x, y, wobble } = at(index);
    pen.fillCircle(x, y + s * 0.15, s * wobble);
  }
  pen.fillStyle(STORM_MID, alpha);
  for (let index = 0; index < puffs; index += 1) {
    const { x, y, wobble } = at(index);
    pen.fillCircle(x - s * 0.3, y - s * 0.12, s * 0.62 * wobble);
    pen.fillCircle(x + s * 0.32, y - s * 0.2, s * 0.5 * wobble);
  }
  pen.fillStyle(STORM_TOP, alpha * 0.9);
  for (let index = 0; index < puffs; index += 1) {
    const { x, y, wobble } = at(index);
    pen.fillCircle(x - s * 0.38, y - s * 0.3, s * 0.3 * wobble);
  }
}

/**
 * Storm clouds hugging the island once it has started to shrink, and while the storm warns, a
 * flickering band over the edge it will eat. `still` stops the clouds turning, for reduced motion.
 */
export function drawStorm(pen: Pen, fit: Fit, storm: { radius: number; start: number; body: number; warning: boolean; next: number | null }, now: number, still: boolean): void {
  const { radius, start, body, warning, next } = storm;
  const time = still ? 0 : now;
  if (radius < start) cloudRing(pen, fit, radius + body * 1.6, body * 1.2, 0.92, time * 0.00003, time);
  if (!warning) return;
  const flicker = still ? 0.8 : 0.55 + 0.45 * Math.abs(Math.sin(now / 70));
  const inner = next !== null && next < radius ? next : radius - body;
  pen.lineStyle(Math.max(4, (radius - inner) * fit.s), 0x1e1630, 0.3 * flicker + 0.15);
  pen.strokeCircle(fit.cx, fit.cy, ((radius + inner) / 2) * fit.s);
  pen.lineStyle(3, WARN, 0.5 * flicker);
  pen.strokeCircle(fit.cx, fit.cy, inner * fit.s);
}

/** A lightning stroke from the storm ring towards the middle. */
export function drawLightning(pen: Pen, fit: Fit, radius: number, angle: number, seed: number): void {
  const points: Point[] = [];
  const steps = 6;
  for (let at = 0; at <= steps; at += 1) {
    const r = radius * (1.25 - (at / steps) * 0.35);
    const jitter = Math.sin(seed * 13.7 + at * 4.1) * 0.06;
    points.push(toScreen(fit, Math.cos(angle + jitter) * r, Math.sin(angle + jitter) * r));
  }
  pen.lineStyle(6, 0xffffff, 0.5);
  trace(pen, points);
  pen.strokePath();
  pen.lineStyle(3, 0xffe066, 1);
  trace(pen, points);
  pen.strokePath();
}

/** A red glow on the rim beside a creature at `x`, `y` (arena units) near the edge; `danger` 0 to 1. */
export function drawEdgeDanger(pen: Pen, fit: Fit, radius: number, body: number, at: Point, danger: number, pulse: number): void {
  const angle = Math.atan2(at.y, at.x);
  pen.lineStyle(Math.max(6, body * 0.35 * fit.s), DANGER, danger * pulse);
  pen.beginPath();
  pen.arc(fit.cx, fit.cy, radius * fit.s, angle - 0.32, angle + 0.32);
  pen.strokePath();
}

export function drawHeart(pen: Pen, x: number, y: number, r: number, colour = TREAT): void {
  const heart = (k: number) => {
    pen.fillCircle(x - r * 0.48 * k, y - r * 0.2 * k, r * 0.55 * k);
    pen.fillCircle(x + r * 0.48 * k, y - r * 0.2 * k, r * 0.55 * k);
    pen.fillTriangle(x - r * k, y - r * 0.02 * k, x + r * k, y - r * 0.02 * k, x, y + r * k);
  };
  pen.fillStyle(INK, 1);
  heart(1.25);
  pen.fillStyle(colour, 1);
  heart(1);
  pen.fillStyle(0xffffff, 0.7);
  pen.fillCircle(x - r * 0.5, y - r * 0.3, r * 0.18);
}

/** Which way your creature faces: a white chevron in front of it. */
export function drawAim(pen: Pen, at: Point, angle: number, size: number): void {
  const point = (forward: number, side: number): Point => ({ x: at.x + Math.cos(angle) * forward - Math.sin(angle) * side, y: at.y + Math.sin(angle) * forward + Math.cos(angle) * side });
  const shape = [point(size, 0), point(-size * 0.2, size * 0.75), point(size * 0.1, 0), point(-size * 0.2, -size * 0.75)];
  pen.fillStyle(INK, 0.8);
  fillPoly(
    pen,
    shape.map((p) => ({ x: at.x + (p.x - at.x) * 1.25, y: at.y + (p.y - at.y) * 1.25 })),
  );
  pen.fillStyle(0xffffff, 1);
  fillPoly(pen, shape);
}

/** A shot: a ball in its move's colours. */
export function drawShot(pen: Pen, at: Point, r: number, tint: Tint): void {
  pen.fillStyle(INK, 1);
  pen.fillCircle(at.x, at.y, r + 3);
  pen.fillStyle(tint.main, 1);
  pen.fillCircle(at.x, at.y, r);
  pen.fillStyle(0xffffff, 0.85);
  pen.fillCircle(at.x - r * 0.25, at.y - r * 0.25, r * 0.45);
}

/** Where something is about to land or form: a flashing red ring. */
export function drawMark(pen: Pen, at: Point, r: number, flash: number): void {
  pen.fillStyle(WARN, flash * 0.18);
  pen.fillCircle(at.x, at.y, r);
  pen.lineStyle(4, WARN, flash);
  pen.strokeCircle(at.x, at.y, r);
}

export function drawPuddle(pen: Pen, at: Point, r: number, tint: Tint, ripple: number): void {
  pen.fillStyle(tint.dark, 0.5);
  pen.fillEllipse(at.x, at.y, r * 2, r * 1.85);
  pen.fillStyle(tint.light, 0.45);
  pen.fillEllipse(at.x - r * 0.2, at.y - r * 0.2, r * 1.1, r * 0.8);
  pen.lineStyle(3, 0xffffff, (1 - ripple) * 0.7);
  pen.strokeCircle(at.x, at.y, r * ripple);
}

export function drawFreeze(pen: Pen, at: Point, r: number): void {
  pen.fillStyle(0xe3fafc, 0.75);
  pen.fillCircle(at.x, at.y, r);
  pen.lineStyle(4, 0xffffff, 0.9);
  pen.strokeCircle(at.x, at.y, r);
  drawBurst(pen, at.x, at.y, r * 0.5, 0xffffff, 0.8);
}

/** A circle that pulses: its move's colour with rays turning slowly. */
export function drawZone(pen: Pen, at: Point, r: number, tint: Tint, pulse: number, turn: number): void {
  pen.fillStyle(tint.light, 0.2 + 0.1 * pulse);
  pen.fillCircle(at.x, at.y, r);
  pen.lineStyle(4, tint.main, 0.85);
  pen.strokeCircle(at.x, at.y, r);
  pen.lineStyle(3, 0xffffff, 0.6);
  for (let ray = 0; ray < 8; ray += 1) {
    const a = (ray / 8) * Math.PI * 2 + turn;
    pen.lineBetween(at.x + Math.cos(a) * r * 0.25, at.y + Math.sin(a) * r * 0.25, at.x + Math.cos(a) * r * 0.85, at.y + Math.sin(a) * r * 0.85);
  }
}

/** A rolling wave `half` pixels to each side, moving along `along` (a unit vector). */
export function drawWall(pen: Pen, at: Point, half: number, thick: number, along: Point, tint: Tint, wave: number): void {
  const across = { x: -along.y, y: along.x };
  const corner = (a: number, b: number): Point => ({ x: at.x + along.x * a + across.x * b, y: at.y + along.y * a + across.y * b });
  pen.fillStyle(tint.light, 0.7);
  fillPoly(pen, [corner(-thick * 1.6, -half), corner(thick, -half * 1.05), corner(thick * 1.4, 0), corner(thick, half * 1.05), corner(-thick * 1.6, half)]);
  pen.lineStyle(4, 0xffffff, 0.9);
  for (let line = -3; line <= 3; line += 1) {
    const b = (line / 3) * half * 0.9;
    const shift = Math.sin(wave + line) * thick * 0.4;
    const from = corner(-thick * 1.4 + shift, b);
    const to = corner(thick * 0.9 + shift, b);
    pen.lineBetween(from.x, from.y, to.x, to.y);
  }
}

/** A fan of light in front of a caster: a cone or, all round, a burst. */
export function drawCone(pen: Pen, at: Point, angle: number, length: number, half: number, tint: Tint, alpha: number): void {
  const points: Point[] = [at];
  for (let step = 0; step <= 8; step += 1) {
    const a = angle - half + (2 * half * step) / 8;
    points.push({ x: at.x + Math.cos(a) * length, y: at.y + Math.sin(a) * length });
  }
  pen.fillStyle(tint.light, 0.6 * alpha);
  fillPoly(pen, points);
  pen.lineStyle(3, tint.main, alpha);
  pen.strokePath();
}

export function drawRing(pen: Pen, at: Point, r: number, colour: number, alpha: number): void {
  pen.lineStyle(Math.max(3, r * 0.12), colour, alpha);
  pen.strokeCircle(at.x, at.y, r);
}

export function drawShield(pen: Pen, at: Point, r: number, pulse: number): void {
  pen.fillStyle(0xfff3bf, 0.28);
  pen.fillCircle(at.x, at.y, r * pulse);
  pen.lineStyle(4, 0xfcc419, 0.95);
  pen.strokeCircle(at.x, at.y, r * pulse);
  pen.fillStyle(0xffffff, 0.6);
  pen.fillEllipse(at.x - r * 0.4, at.y - r * 0.45, r * 0.45, r * 0.25);
}

/** A creature rooted in place, in a block of ice. */
export function drawIce(pen: Pen, at: Point, r: number): void {
  pen.fillStyle(0xc5f6fa, 0.55);
  pen.fillRoundedRect(at.x - r, at.y - r * 1.15, r * 2, r * 2.1, r * 0.3);
  pen.fillStyle(0xffffff, 0.7);
  pen.fillRect(at.x - r * 0.7, at.y - r * 0.9, r * 0.18, r * 1.1);
}

const GREEN = 0x40c057;
const YELLOW = 0xfcc419;
const RED = 0xfa5252;

/** Green when full, yellow at half, red near empty. */
export function healthColour(share: number): number {
  return share >= 0.5 ? lerpColour(YELLOW, GREEN, (share - 0.5) * 2) : lerpColour(RED, YELLOW, share * 2);
}

/** A chunky health bar centred on `x`, `y`; `share` of it full. */
export function drawHealthBar(pen: Pen, x: number, y: number, width: number, height: number, share: number): void {
  const left = x - width / 2;
  const top = y - height / 2;
  const radius = Math.min(8, height / 2);
  const border = Math.max(2, Math.round(height * 0.2));
  pen.fillStyle(INK, 1);
  pen.fillRoundedRect(left - border, top - border, width + border * 2, height + border * 2, radius + border);
  pen.fillStyle(0x334e68, 1);
  pen.fillRoundedRect(left, top, width, height, radius);
  const shown = Math.max(0, Math.min(1, share));
  if (shown <= 0) return;
  const fill = Math.max(height * 0.6, width * shown);
  pen.fillStyle(healthColour(shown), 1);
  pen.fillRoundedRect(left, top, fill, height, radius);
  pen.fillStyle(0xffffff, 0.35);
  pen.fillRoundedRect(left + 2, top + 1, Math.max(0, fill - 4), Math.max(2, height * 0.28), Math.min(3, radius));
}

/** What a thing on the island is, in arena units, for `drawThing`. */
export type ThingLook = {
  readonly shape: ArenaShape;
  readonly at: Point;
  readonly radius: number;
  /** Ticks before it works: a mark shows where it will. */
  readonly armTicks: number;
  /** The way it moves, a unit vector, for a wall. */
  readonly along: Point;
  readonly tint: Tint;
};

/** One shot, zone or strike on the island. `now` in ms animates it; `still` keeps it from moving under reduced motion. */
export function drawThing(pen: Pen, fit: Fit, thing: ThingLook, body: number, now: number, still: boolean): void {
  const at = toScreen(fit, thing.at.x, thing.at.y);
  const r = Math.max(3, thing.radius * fit.s);
  const time = still ? 0 : now;
  if (thing.armTicks > 0) return drawMark(pen, at, thing.shape === 'puddle' || thing.shape === 'freeze' || thing.shape === 'zone' ? r : Math.max(r, body * fit.s), still ? 0.8 : 0.45 + 0.35 * Math.abs(Math.sin(now / 80)));
  switch (thing.shape) {
    case 'puddle':
      return drawPuddle(pen, at, r, thing.tint, (time / 900) % 1);
    case 'freeze':
      return drawFreeze(pen, at, r);
    case 'zone':
    case 'weather':
      return drawZone(pen, at, r, thing.tint, 0.5 + 0.5 * Math.sin(time / 160), time / 900);
    case 'wall':
      return drawWall(pen, at, r, Math.max(4, body * 0.35 * fit.s), thing.along, thing.tint, time / 50);
    case 'strike':
      return drawBurst(pen, at.x, at.y, Math.max(r, body * fit.s), thing.tint.main);
    case 'snare':
      drawShot(pen, at, r, thing.tint);
      return drawRing(pen, at, r * 1.6, thing.tint.dark, 0.8);
    default:
      return drawShot(pen, at, r, thing.tint);
  }
}
