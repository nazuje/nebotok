import type { GameObjects } from 'phaser';
import { ARENA, WALL_THICKNESS } from './arena-kits.ts';
import type { ArenaState, Fighter, Shot, Zone } from './arena-state.ts';
import { drawBurst, fillPoly, lerpColour } from './prototype-shapes.ts';

/** Drawing helpers for the arena, in screen pixels through a `Fit` from arena units. */

type G = GameObjects.Graphics;
export type Fit = { readonly cx: number; readonly cy: number; readonly s: number };
type P = { x: number; y: number };

export const INK = 0x102a43;
const GRASS = 0x69c96f;
const GRASS_LIGHT = 0x8fdc8a;
const GRASS_DARK = 0x4fae5b;
const ROCK = 0x8a6a55;
const ROCK_DARK = 0x5d4537;
const STORM_CLOUD = 0x4a4563;
const STORM_MID = 0x625d80;
const STORM_TOP = 0x8a86a6;

export const toScreen = (fit: Fit, x: number, y: number): P => ({ x: fit.cx + x * fit.s, y: fit.cy + y * fit.s });

/** Fixed tufts of darker grass, at a fraction of the start radius, so the island keeps its look as it shrinks. */
const TUFTS: readonly { a: number; r: number; size: number }[] = Array.from({ length: 46 }, (_, at) => ({ a: at * 2.399963, r: Math.sqrt((at + 0.5) / 46) * 0.93, size: 0.6 + ((at * 7) % 5) / 6 }));

/** The floating island seen from above: its rock underside peeking out below, the rocky rim and the grass. */
export function drawIsland(g: G, fit: Fit, radius: number): void {
  const r = radius * fit.s;
  const rim = Math.max(5, ARENA.body * 0.35 * fit.s);
  const { cx, cy } = fit;
  g.fillStyle(ROCK_DARK, 1);
  g.fillEllipse(cx, cy + r * 0.16, (r + rim) * 1.96, (r + rim) * 1.9);
  const drips = 9;
  for (let at = 0; at < drips; at += 1) {
    const a = Math.PI * (0.12 + (0.76 * at) / (drips - 1));
    const bx = cx + Math.cos(a) * r * 0.92;
    const by = cy + r * 0.16 + Math.sin(a) * r * 0.92;
    const depth = r * (0.14 + 0.1 * Math.abs(Math.sin(at * 1.7)));
    g.fillTriangle(bx - r * 0.09, by, bx + r * 0.09, by, bx, by + depth);
  }
  g.fillStyle(ROCK, 1);
  g.fillCircle(cx, cy, r + rim);
  g.fillStyle(lerpColour(ROCK, 0xffffff, 0.25), 1);
  g.fillCircle(cx, cy - rim * 0.3, r + rim * 0.55);
  g.fillStyle(GRASS_DARK, 1);
  g.fillCircle(cx, cy, r);
  g.fillStyle(GRASS, 1);
  g.fillCircle(cx, cy - rim * 0.25, r * 0.985);
  g.fillStyle(GRASS_LIGHT, 0.45);
  g.fillCircle(cx - r * 0.18, cy - r * 0.2, r * 0.55);
  for (const tuft of TUFTS) {
    const distance = tuft.r * ARENA.radius;
    if (distance > radius - ARENA.body * 0.4) continue;
    const x = cx + Math.cos(tuft.a) * distance * fit.s;
    const y = cy + Math.sin(tuft.a) * distance * fit.s;
    const size = ARENA.body * 0.22 * tuft.size * fit.s;
    g.fillStyle(GRASS_DARK, 0.7);
    g.fillTriangle(x - size, y + size * 0.5, x - size * 0.4, y - size, x, y + size * 0.5);
    g.fillTriangle(x, y + size * 0.5, x + size * 0.5, y - size * 1.2, x + size, y + size * 0.5);
  }
}

/** Dark storm clouds hugging the island, and while the storm warns, creeping over the band it will eat, flickering. */
export function drawStorm(g: G, fit: Fit, state: ArenaState, warning: number | null, now: number): void {
  const { storm } = state;
  // Puffs close enough to overlap into one bank of cloud, each a body with two lighter lumps on top.
  const ring = (radius: number, alpha: number, size: number, spin: number) => {
    const puffs = Math.max(16, Math.round((Math.PI * 2 * radius) / (size * 1.15)));
    const s = size * fit.s;
    for (let layer = 0; layer < 3; layer += 1) {
      for (let at = 0; at < puffs; at += 1) {
        const a = (at / puffs) * Math.PI * 2 + now * spin;
        const wobble = 1 + 0.1 * Math.sin(at * 2.3 + now / 500);
        const x = fit.cx + Math.cos(a) * radius * fit.s;
        const y = fit.cy + Math.sin(a) * radius * fit.s;
        if (layer === 0) {
          g.fillStyle(STORM_CLOUD, alpha);
          g.fillCircle(x, y + s * 0.15, s * wobble);
        } else if (layer === 1) {
          g.fillStyle(STORM_MID, alpha);
          g.fillCircle(x - s * 0.3, y - s * 0.12, s * 0.62 * wobble);
          g.fillCircle(x + s * 0.32, y - s * 0.2, s * 0.5 * wobble);
        } else {
          g.fillStyle(STORM_TOP, alpha * 0.9);
          g.fillCircle(x - s * 0.38, y - s * 0.3, s * 0.3 * wobble);
        }
      }
    }
  };
  if (storm.step > 0 || storm.radius < ARENA.radius) ring(storm.radius + ARENA.body * 1.6, 0.92, ARENA.body * 1.2, 0.00003);
  if (warning === null) return;
  const flicker = 0.55 + 0.45 * Math.abs(Math.sin(now / 70));
  const outer = storm.radius;
  const inner = storm.to < storm.from ? storm.to : storm.radius;
  const band = Math.max(4, (outer - inner) * fit.s);
  g.lineStyle(band, 0x1e1630, 0.3 * flicker + 0.15 * warning);
  g.strokeCircle(fit.cx, fit.cy, ((outer + inner) / 2) * fit.s);
  g.lineStyle(3, 0xff6b6b, 0.5 * flicker);
  g.strokeCircle(fit.cx, fit.cy, inner * fit.s);
  ring(outer + ARENA.body * 1.6 - (outer - inner + ARENA.body * 1.2) * warning, 0.75 * flicker, ARENA.body * 0.9, -0.00008);
}

/** A flickering lightning stroke from the storm ring towards the middle. */
export function drawLightning(g: G, fit: Fit, radius: number, angle: number, seed: number): void {
  const points: P[] = [];
  const steps = 6;
  for (let at = 0; at <= steps; at += 1) {
    const r = radius * (1.25 - (at / steps) * 0.35);
    const jitter = Math.sin(seed * 13.7 + at * 4.1) * 0.06;
    points.push(toScreen(fit, Math.cos(angle + jitter) * r, Math.sin(angle + jitter) * r));
  }
  g.lineStyle(6, 0xffffff, 0.5);
  g.beginPath();
  points.forEach((point, at) => (at === 0 ? g.moveTo(point.x, point.y) : g.lineTo(point.x, point.y)));
  g.strokePath();
  g.lineStyle(3, 0xffe066, 1);
  g.strokePath();
}

/** A red glow on the rim beside a creature near the edge; `danger` 0 to 1. */
export function drawEdgeDanger(g: G, fit: Fit, radius: number, fighter: Fighter, danger: number, now: number): void {
  const angle = Math.atan2(fighter.y, fighter.x);
  const pulse = 0.55 + 0.45 * Math.sin(now / 90);
  g.lineStyle(Math.max(6, ARENA.body * 0.35 * fit.s), 0xff3b3b, danger * pulse);
  g.beginPath();
  g.arc(fit.cx, fit.cy, radius * fit.s, angle - 0.32, angle + 0.32);
  g.strokePath();
}

export function drawHeart(g: G, x: number, y: number, r: number, colour: number, outline = true): void {
  const heart = (k: number) => {
    g.fillCircle(x - r * 0.48 * k, y - r * 0.2 * k, r * 0.55 * k);
    g.fillCircle(x + r * 0.48 * k, y - r * 0.2 * k, r * 0.55 * k);
    g.fillTriangle(x - r * 1.0 * k, y - r * 0.02 * k, x + r * 1.0 * k, y - r * 0.02 * k, x, y + r * 1.0 * k);
  };
  if (outline) {
    g.fillStyle(INK, 1);
    heart(1.25);
  }
  g.fillStyle(colour, 1);
  heart(1);
  g.fillStyle(0xffffff, 0.7);
  g.fillCircle(x - r * 0.5, y - r * 0.3, r * 0.18);
}

/** Your aim: a chevron in front of your creature, gold when it has locked on to the wild one. */
export function drawAim(g: G, at: P, angle: number, size: number, locked: boolean): void {
  const point = (forward: number, side: number): P => ({ x: at.x + Math.cos(angle) * forward - Math.sin(angle) * side, y: at.y + Math.sin(angle) * forward + Math.cos(angle) * side });
  const shape = [point(size, 0), point(-size * 0.2, size * 0.75), point(size * 0.1, 0), point(-size * 0.2, -size * 0.75)];
  g.fillStyle(INK, 0.8);
  fillPoly(g, shape.map((p) => ({ x: at.x + (p.x - at.x) * 1.25, y: at.y + (p.y - at.y) * 1.25 })));
  g.fillStyle(locked ? 0xffd43b : 0xffffff, 1);
  fillPoly(g, shape);
}

export function drawShot(g: G, fit: Fit, shot: Shot, at: P, colour: number, now: number): void {
  const r = shot.radius * fit.s;
  if (shot.treat) {
    drawHeart(g, at.x, at.y + Math.sin(now / 60) * 2, Math.max(9, r * 0.9), 0xff8fab);
    return;
  }
  g.fillStyle(INK, 1);
  g.fillCircle(at.x, at.y, r + 3);
  g.fillStyle(colour, 1);
  g.fillCircle(at.x, at.y, r);
  g.fillStyle(0xffffff, 0.85);
  g.fillCircle(at.x - r * 0.25, at.y - r * 0.25, r * 0.45);
}

/** A treat lying on the grass, with a ring that runs down until a bird takes it. */
export function drawGroundTreat(g: G, at: P, size: number, left: number, now: number): void {
  g.lineStyle(4, 0xffffff, 0.8);
  g.beginPath();
  g.arc(at.x, at.y, size * 1.9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
  g.strokePath();
  drawHeart(g, at.x, at.y - Math.abs(Math.sin(now / 200)) * size * 0.4, size, 0xff8fab);
}

function drawWall(g: G, fit: Fit, zone: Zone, at: P, fade: number, now: number): void {
  const along = { x: zone.dirX, y: zone.dirY };
  const across = { x: -zone.dirY, y: zone.dirX };
  const half = zone.radius * fit.s;
  const thick = (WALL_THICKNESS / 2) * fit.s;
  const corner = (a: number, b: number): P => ({ x: at.x + along.x * a + across.x * b, y: at.y + along.y * a + across.y * b });
  g.fillStyle(0xe6fcf5, 0.55 * fade);
  fillPoly(g, [corner(-thick * 1.6, -half), corner(thick, -half * 1.05), corner(thick * 1.4, 0), corner(thick, half * 1.05), corner(-thick * 1.6, half)]);
  g.lineStyle(4, 0xffffff, 0.9 * fade);
  for (let line = -3; line <= 3; line += 1) {
    const b = (line / 3) * half * 0.9;
    const wave = Math.sin(now / 50 + line) * thick * 0.4;
    const from = corner(-thick * 1.4 + wave, b);
    const to = corner(thick * 0.9 + wave, b);
    g.lineBetween(from.x, from.y, to.x, to.y);
  }
}

/** Puddles, freeze circles, sun zones and gust walls. */
export function drawZone(g: G, fit: Fit, zone: Zone, tick: number, alpha: number, now: number): void {
  const at = toScreen(fit, zone.px + (zone.x - zone.px) * alpha, zone.py + (zone.y - zone.py) * alpha);
  const r = zone.radius * fit.s;
  const fade = Math.min(1, (zone.until - tick) / 30);
  if (zone.kind === 'wall') return drawWall(g, fit, zone, at, fade, now);
  if (zone.kind === 'puddle') {
    if (tick < zone.armAt) {
      const t = (tick - zone.start) / Math.max(1, zone.armAt - zone.start);
      const from = toScreen(fit, zone.fromX, zone.fromY);
      const x = from.x + (at.x - from.x) * t;
      const y = from.y + (at.y - from.y) * t - Math.sin(Math.PI * t) * 60 * fit.s * 3;
      g.fillStyle(0x339af0, 1);
      g.fillCircle(x, y, ARENA.body * 0.4 * fit.s);
      g.lineStyle(2, 0x339af0, 0.6);
      g.strokeCircle(at.x, at.y, r);
      return;
    }
    g.fillStyle(0x1c7ed6, 0.5 * fade);
    g.fillEllipse(at.x, at.y, r * 2, r * 1.85);
    g.fillStyle(0x74c0fc, 0.45 * fade);
    g.fillEllipse(at.x - r * 0.2, at.y - r * 0.2, r * 1.1, r * 0.8);
    const ripple = (now / 900) % 1;
    g.lineStyle(3, 0xd0ebff, (1 - ripple) * 0.8 * fade);
    g.strokeEllipse(at.x, at.y, r * 2 * ripple, r * 1.85 * ripple);
    return;
  }
  if (zone.kind === 'freeze') {
    if (tick < zone.armAt) {
      const t = (tick - zone.start) / Math.max(1, zone.armAt - zone.start);
      g.fillStyle(0xc5f6fa, 0.25 + 0.3 * t);
      g.fillCircle(at.x, at.y, r * t);
      g.lineStyle(4, 0xe3fafc, 0.9);
      g.strokeCircle(at.x, at.y, r);
      return;
    }
    g.fillStyle(0xe3fafc, 0.75 * fade);
    g.fillCircle(at.x, at.y, r);
    drawBurst(g, at.x, at.y, r * 0.6 * fade, 0xffffff);
    return;
  }
  const pulse = 0.5 + 0.5 * Math.sin(now / 160);
  g.fillStyle(0xffd43b, (0.18 + 0.08 * pulse) * fade);
  g.fillCircle(at.x, at.y, r);
  g.lineStyle(4, 0xfab005, 0.8 * fade);
  g.strokeCircle(at.x, at.y, r);
  g.lineStyle(3, 0xfff3bf, 0.7 * fade);
  for (let ray = 0; ray < 8; ray += 1) {
    const a = (ray / 8) * Math.PI * 2 + now / 900;
    g.lineBetween(at.x + Math.cos(a) * r * 0.25, at.y + Math.sin(a) * r * 0.25, at.x + Math.cos(a) * r * 0.85, at.y + Math.sin(a) * r * 0.85);
  }
}

/** What the wild creature's wind-up is about to do: the lunge's path, the wall, where a circle lands, or its shield or zone. */
export function drawTelegraph(g: G, fit: Fit, fighter: Fighter, at: P, now: number): void {
  const windup = fighter.windup;
  const ability = windup ? fighter.kit[windup.slot] : undefined;
  if (!windup || !ability) return;
  const flash = 0.45 + 0.35 * Math.abs(Math.sin(now / 80));
  const ahead = (distance: number): P => ({ x: at.x + windup.ax * distance * fit.s, y: at.y + windup.ay * distance * fit.s });
  g.lineStyle(Math.max(6, ARENA.body * 0.5 * fit.s), 0xff6b6b, flash * 0.6);
  if (ability.kind === 'lunge' || ability.kind === 'wall') {
    const end = ahead(ability.kind === 'lunge' ? 360 : 650);
    g.lineBetween(at.x, at.y, end.x, end.y);
    if (ability.kind === 'wall') {
      const half = ability.radius * fit.s;
      const mid = ahead(ARENA.body + WALL_THICKNESS);
      g.lineBetween(mid.x - windup.ay * half, mid.y + windup.ax * half, mid.x + windup.ay * half, mid.y - windup.ax * half);
    }
    return;
  }
  if (ability.kind === 'puddle' || ability.kind === 'freeze') {
    const spot = ahead(windup.reach);
    g.lineStyle(4, 0xff6b6b, flash);
    g.strokeCircle(spot.x, spot.y, ability.radius * fit.s);
    g.fillStyle(0xff6b6b, flash * 0.18);
    g.fillCircle(spot.x, spot.y, ability.radius * fit.s);
    return;
  }
  g.lineStyle(4, 0xff6b6b, flash);
  g.strokeCircle(at.x, at.y, (ability.kind === 'zone' ? ability.radius : ARENA.body * 1.4) * fit.s);
}

/** A fan of light for the sun's short burst. */
export function drawCone(g: G, at: P, angle: number, length: number, half: number, alpha: number): void {
  const points: P[] = [at];
  for (let step = 0; step <= 8; step += 1) {
    const a = angle - half + (2 * half * step) / 8;
    points.push({ x: at.x + Math.cos(a) * length, y: at.y + Math.sin(a) * length });
  }
  g.fillStyle(0xffe066, 0.6 * alpha);
  fillPoly(g, points);
  g.lineStyle(3, 0xfff9db, alpha);
  g.strokePath();
}

export function drawShield(g: G, at: P, r: number, now: number): void {
  const pulse = 1 + 0.04 * Math.sin(now / 120);
  g.fillStyle(0xfff3bf, 0.28);
  g.fillCircle(at.x, at.y, r * pulse);
  g.lineStyle(4, 0xfcc419, 0.95);
  g.strokeCircle(at.x, at.y, r * pulse);
  g.fillStyle(0xffffff, 0.6);
  g.fillEllipse(at.x - r * 0.4, at.y - r * 0.45, r * 0.45, r * 0.25);
}

export function drawIce(g: G, at: P, r: number): void {
  g.fillStyle(0xc5f6fa, 0.55);
  g.fillRoundedRect(at.x - r, at.y - r * 1.15, r * 2, r * 2.1, r * 0.3);
  g.lineStyle(3, 0xffffff, 0.9);
  g.strokeRoundedRect(at.x - r, at.y - r * 1.15, r * 2, r * 2.1, r * 0.3);
  g.fillStyle(0xffffff, 0.7);
  g.fillRect(at.x - r * 0.7, at.y - r * 0.9, r * 0.18, r * 1.1);
}
