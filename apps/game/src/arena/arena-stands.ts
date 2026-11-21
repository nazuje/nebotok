import { INK, toScreen, type Fit, type Point } from './arena-paint.ts';
import type { Pen } from './arena-pen.ts';

/**
 * The duel island's look (docs/arena.md, "Duels"): flags around the rim, and two cloud stands
 * beside the island where the watchers' couriers stand. Painted like the rest of the arena, in
 * screen pixels from arena units by a `Fit`; the scene puts each watcher's courier on a seat.
 */

const FLAGS = 10;
const FLAG_COLOURS = [0xffd43b, 0xff6b6b, 0x4dabf7] as const;
const POLE = 0x5d4537;
const CLOUD = 0xffffff;
const CLOUD_SHADE = 0xd6e4f0;
/** The stands sit up and to each side of the island, in radians from pointing right. */
const STAND_ANGLES = [Math.PI * 1.18, Math.PI * 1.82] as const;
/** Watcher seats per stand. */
export const STAND_SEATS = 3;

/** Flags on poles around the island's rim, their cloth flapping unless motion is reduced. */
export function drawFlags(pen: Pen, fit: Fit, radius: number, body: number, now: number, still: boolean): void {
  const rim = Math.max(5, body * 0.35 * fit.s);
  const r = radius * fit.s + rim * 0.4;
  const pole = Math.max(10, body * 1.1 * fit.s);
  const cloth = pole * 0.5;
  for (let at = 0; at < FLAGS; at += 1) {
    const a = (Math.PI * 2 * at) / FLAGS + Math.PI / FLAGS;
    const foot = { x: fit.cx + Math.cos(a) * r, y: fit.cy + Math.sin(a) * r };
    const top = { x: foot.x, y: foot.y - pole };
    const flap = still ? 0 : Math.sin(now / 160 + at) * cloth * 0.18;
    pen.lineStyle(Math.max(2, pole * 0.08), POLE, 1);
    pen.lineBetween(foot.x, foot.y, top.x, top.y);
    pen.fillStyle(INK, 1);
    pen.fillTriangle(top.x, top.y - 1, top.x + cloth + 2, top.y + cloth * 0.32 + flap, top.x, top.y + cloth * 0.64 + 1);
    pen.fillStyle(FLAG_COLOURS[at % FLAG_COLOURS.length] ?? FLAG_COLOURS[0], 1);
    pen.fillTriangle(top.x + 1, top.y, top.x + cloth, top.y + cloth * 0.32 + flap, top.x + 1, top.y + cloth * 0.64);
  }
}

/** Where a stand's middle is, in arena units, beside an island of `radius`. */
const standAt = (stand: number, radius: number, body: number): Point => {
  const a = STAND_ANGLES[stand] ?? STAND_ANGLES[0];
  const out = radius + body * 1.6;
  return { x: Math.cos(a) * out, y: Math.sin(a) * out };
};

/** The two cloud stands beside the island. */
export function drawStands(pen: Pen, fit: Fit, radius: number, body: number): void {
  for (const stand of [0, 1]) {
    const at = standAt(stand, radius, body);
    const middle = toScreen(fit, at.x, at.y);
    const w = body * 3.4 * fit.s;
    const h = body * 1.1 * fit.s;
    pen.fillStyle(CLOUD_SHADE, 0.95);
    pen.fillEllipse(middle.x, middle.y + h * 0.25, w, h);
    pen.fillStyle(CLOUD, 0.95);
    for (const [dx, dy, size] of [
      [-0.32, 0, 0.45],
      [0, -0.18, 0.55],
      [0.32, 0, 0.45],
    ] as const) {
      pen.fillCircle(middle.x + dx * w, middle.y + dy * h, size * h);
    }
    pen.fillEllipse(middle.x, middle.y + h * 0.1, w * 0.95, h * 0.8);
  }
}

/** Where watcher `seat` stands, in screen pixels at their feet: the first three on the left stand, the next three on the right. */
export function seatAt(fit: Fit, radius: number, body: number, seat: number): Point {
  const stand = Math.floor(seat / STAND_SEATS) % 2;
  const middle = standAt(stand, radius, body);
  const along = (seat % STAND_SEATS) - (STAND_SEATS - 1) / 2;
  return toScreen(fit, middle.x + along * body * 0.95, middle.y + body * 0.15);
}
