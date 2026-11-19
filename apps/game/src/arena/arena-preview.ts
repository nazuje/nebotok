import type { ArenaShape } from '@nebotok/core';
import type { PreviewColours, ShapePainter } from '../shape-preview.ts';
import { ARENA } from './arena-content.ts';
import { canvasPen, colourOf, type Pen } from './arena-pen.ts';
import { INK, drawBurst, drawCone, drawFreeze, drawIsland, drawMark, drawPuddle, drawRing, drawShield, drawShot, drawSky, drawWall, drawZone, type Fit, type Point, type Tint } from './arena-paint.ts';

/**
 * The loadout picker's "try it" preview painted as the fight paints it (src/shape-preview.ts's
 * `ShapePainter`): a small arena island, your creature on the left, the other on the right, and
 * the move's shape between them through one loop, `t` 0 to 1.
 */

const { radius: ISLAND, body: BODY } = ARENA.arena.island;

const tintOf = (colours: PreviewColours): Tint => ({ light: colourOf(colours.light, 0xe6eef6), main: colourOf(colours.main, 0x8fa9c4), dark: colourOf(colours.dark, 0x334e68) });

function creature(pen: Pen, at: Point, r: number, colour: number): void {
  pen.fillStyle(INK, 1);
  pen.fillCircle(at.x, at.y, r + 2);
  pen.fillStyle(colour, 1);
  pen.fillCircle(at.x, at.y, r);
  pen.fillStyle(0xffffff, 0.5);
  pen.fillCircle(at.x - r * 0.3, at.y - r * 0.3, r * 0.3);
}

const lerp = (from: Point, to: Point, k: number): Point => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });

type Stage = { readonly from: Point; readonly to: Point; readonly body: number; readonly tint: Tint; readonly t: number };

/** The shape at time `t`: each lands or hits about two thirds of the way through the loop. */
function shapeAt(pen: Pen, shape: ArenaShape, { from, to, body, tint, t }: Stage): Point {
  const ease = Math.min(1, t * 1.6);
  const landed = t >= 0.62;
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const reach = to.x - from.x;
  switch (shape) {
    case 'bolt':
      drawShot(pen, lerp(from, to, ease), body * 0.4, tint);
      break;
    case 'spray':
      for (const lean of [-0.3, 0, 0.3]) drawShot(pen, { x: from.x + reach * ease, y: from.y + reach * ease * lean }, body * 0.32, tint);
      break;
    case 'cone':
      drawCone(pen, from, angle, body + reach * 0.75 * ease, 0.5, tint, 1 - t * 0.6);
      break;
    case 'snare':
      drawShot(pen, lerp(from, to, ease), body * 0.35, tint);
      if (landed) drawRing(pen, to, body * 1.4, tint.dark, 0.9);
      break;
    case 'lunge':
      return lerp(from, { x: to.x - body * 2.2, y: to.y }, ease);
    case 'burst':
      drawRing(pen, from, body + reach * 0.55 * ease, tint.main, 1 - t * 0.7);
      break;
    case 'puddle':
      if (landed) drawPuddle(pen, to, body * 1.8, tint, (t * 3) % 1);
      else drawMark(pen, to, body * 1.8, 0.8);
      break;
    case 'shield':
      drawShield(pen, from, body * 1.35, 1 + 0.05 * Math.sin(t * Math.PI * 4));
      break;
    case 'strike':
      if (landed) drawBurst(pen, to.x, to.y, body * 1.3, tint.main);
      else drawMark(pen, to, body * 1.3, 0.8);
      break;
    case 'wall':
      drawWall(pen, lerp({ x: from.x + body * 1.5, y: from.y }, to, ease), body * 2.4, body * 0.35, { x: 1, y: 0 }, tint, t * 20);
      break;
    case 'freeze':
      if (landed) drawFreeze(pen, to, body * 1.7);
      else drawMark(pen, to, body * 1.7, 0.8);
      break;
    case 'zone':
      drawZone(pen, from, body * 2.6, tint, 0.5 + 0.5 * Math.sin(t * Math.PI * 4), t * 2);
      break;
    case 'weather':
      pen.fillStyle(tint.main, 0.3 * ease);
      pen.fillCircle(lerp(from, to, 0.5).x, from.y, reach * 1.2);
      break;
  }
  return from;
}

export const arenaShapePainter: ShapePainter = (context, { shape, colours, t, width, height }) => {
  const pen = canvasPen(context);
  const tint = tintOf(colours);
  drawSky(pen, width, height);
  const fit: Fit = { cx: width / 2, cy: height / 2 - height * 0.04, s: Math.min(width, height) / 2 / (ISLAND * 1.12) };
  drawIsland(pen, fit, ISLAND, ISLAND, BODY);
  const body = BODY * fit.s * 1.4;
  const from = { x: fit.cx - ISLAND * fit.s * 0.5, y: fit.cy };
  const to = { x: fit.cx + ISLAND * fit.s * 0.5, y: fit.cy };
  creature(pen, to, body, 0xf6f6f6);
  const caster = shapeAt(pen, shape, { from, to, body, tint, t });
  creature(pen, caster, body, tint.dark);
};
