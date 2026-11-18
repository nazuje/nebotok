import type { ArenaShape } from '@nebotok/core';
import { CONTENT, moveType } from './battle-content.ts';
import { moveArena } from './move-arena.ts';

/**
 * The "try it" preview of the loadout picker: a move's shape played on a mini island, looping,
 * with no server. The arena's own painter can take over by being passed as `painter`; until then
 * `sketchShape` draws a simple stand-in.
 */

export type PreviewColours = { readonly light: string; readonly main: string; readonly dark: string };

/** One frame of a preview: `t` runs from 0 to 1 through each loop. Sizes are in CSS pixels. */
export type PreviewFrame = { readonly shape: ArenaShape; readonly colours: PreviewColours; readonly t: number; readonly width: number; readonly height: number };

export type ShapePainter = (context: CanvasRenderingContext2D, frame: PreviewFrame) => void;

export const PREVIEW_LOOP_MS = 1_600;
/** The moment a still preview shows, under reduced motion. */
const STILL_T = 0.55;
const NO_TYPE: PreviewColours = { light: '#e6eef6', main: '#8fa9c4', dark: '#334e68' };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function circle(context: CanvasRenderingContext2D, x: number, y: number, radius: number, fill: string | null, stroke: string | null = null) {
  context.beginPath();
  context.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
  if (fill) {
    context.fillStyle = fill;
    context.fill();
  }
  if (stroke) {
    context.strokeStyle = stroke;
    context.lineWidth = 3;
    context.stroke();
  }
}

function island(context: CanvasRenderingContext2D, width: number, height: number) {
  context.fillStyle = '#8fd3ff';
  context.fillRect(0, 0, width, height);
  context.beginPath();
  context.ellipse(width / 2, height / 2 + 6, width * 0.46, height * 0.4, 0, 0, Math.PI * 2);
  context.fillStyle = '#6b8e4e';
  context.fill();
  context.beginPath();
  context.ellipse(width / 2, height / 2, width * 0.46, height * 0.4, 0, 0, Math.PI * 2);
  context.fillStyle = '#9ccc65';
  context.fill();
}

type Point = { readonly x: number; readonly y: number };
/** Where the creatures stand on the mini island: the caster `from`, the other one `to`, each `body` across. */
type Stage = { readonly from: Point; readonly to: Point; readonly body: number; readonly width: number; readonly height: number };

/** Each shape drawn from the caster toward the other creature, at time `t`. */
function sketch(context: CanvasRenderingContext2D, shape: ArenaShape, colours: PreviewColours, t: number, { from, to, body, width, height }: Stage) {
  const reach = to.x - from.x;
  const ease = Math.min(1, t * 1.6);
  const fade = t < 0.75 ? 1 : (1 - t) * 4;
  context.globalAlpha = Math.max(0, fade);
  switch (shape) {
    case 'bolt':
      circle(context, from.x + reach * ease, from.y, body * 0.35, colours.main, colours.dark);
      break;
    case 'spray':
      for (const lean of [-0.35, 0, 0.35]) circle(context, from.x + reach * ease, from.y + reach * ease * lean, body * 0.3, colours.main, colours.dark);
      break;
    case 'cone':
      context.beginPath();
      context.moveTo(from.x + body, from.y);
      context.lineTo(from.x + body + reach * 0.7 * ease, from.y - reach * 0.35 * ease);
      context.lineTo(from.x + body + reach * 0.7 * ease, from.y + reach * 0.35 * ease);
      context.closePath();
      context.fillStyle = colours.light;
      context.fill();
      context.strokeStyle = colours.main;
      context.lineWidth = 3;
      context.stroke();
      break;
    case 'snare':
      context.strokeStyle = colours.dark;
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(from.x + body, from.y);
      context.lineTo(from.x + body + (reach - body) * ease, from.y);
      context.stroke();
      if (ease >= 1) circle(context, to.x, to.y, body * 1.3, null, colours.main);
      break;
    case 'lunge':
      context.fillStyle = colours.light;
      context.fillRect(from.x, from.y - body * 0.6, (reach - body) * ease, body * 1.2);
      circle(context, from.x + (reach - body * 2) * ease, from.y, body * 0.6, colours.main, colours.dark);
      break;
    case 'burst':
      circle(context, from.x, from.y, body + reach * 0.5 * ease, null, colours.main);
      break;
    case 'puddle':
      context.beginPath();
      context.ellipse(to.x, to.y + body * 0.6, body * 2 * ease, body * 0.9 * ease, 0, 0, Math.PI * 2);
      context.fillStyle = colours.light;
      context.fill();
      context.strokeStyle = colours.main;
      context.lineWidth = 3;
      context.stroke();
      break;
    case 'shield':
      circle(context, from.x, from.y, body * (1.2 + 0.2 * ease), colours.light, colours.main);
      break;
    case 'strike':
      circle(context, to.x, to.y - reach * (1 - ease), body * 0.6, colours.main, colours.dark);
      if (ease >= 1) circle(context, to.x, to.y, body * 1.6, null, colours.main);
      break;
    case 'wall':
      context.fillStyle = colours.main;
      context.fillRect(from.x + body + (reach - body) * ease, from.y - reach * 0.45, body * 0.8, reach * 0.9);
      break;
    case 'freeze':
      circle(context, from.x, from.y, body + reach * 0.6 * ease, colours.light, colours.main);
      break;
    case 'zone':
      circle(context, to.x, to.y, body * (1.5 + 0.4 * Math.sin(t * Math.PI * 4)), colours.light, colours.main);
      break;
    case 'weather':
      context.fillStyle = colours.main;
      context.globalAlpha = 0.35 * Math.max(0, fade) * ease;
      context.fillRect(0, 0, width, height);
      break;
  }
  context.globalAlpha = 1;
}

/** The stand-in painter: the island, the caster on the left, the other creature on the right, and the shape between them. */
export const sketchShape: ShapePainter = (context, { shape, colours, t, width, height }) => {
  island(context, width, height);
  const body = Math.round(height * 0.09);
  const from = { x: width * 0.28, y: height / 2 };
  const to = { x: width * 0.72, y: height / 2 };
  if (shape !== 'shield' && shape !== 'burst' && shape !== 'freeze') circle(context, to.x, to.y, body, '#f6f6f6', '#334e68');
  sketch(context, shape, colours, t, { from, to, body, width, height });
  if (shape === 'shield' || shape === 'burst' || shape === 'freeze') circle(context, to.x, to.y, body, '#f6f6f6', '#334e68');
  circle(context, from.x, from.y, body, colours.dark, '#102a43');
};

export type ShapePreview = {
  /** Starts playing `moveId`'s shape, looping until `stop`; a still frame under reduced motion. */
  play(moveId: string): void;
  stop(): void;
  /** The move playing, or null. */
  playing(): string | null;
};

export function createShapePreview(canvas: HTMLCanvasElement, painter: ShapePainter = sketchShape): ShapePreview {
  let playing: string | null = null;
  let frame = 0;
  let started = 0;

  function draw(now: number) {
    const arena = playing === null ? null : moveArena(playing);
    const context = canvas.getContext('2d');
    if (!arena || !context || playing === null) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(width * scale)) canvas.width = Math.round(width * scale);
    if (canvas.height !== Math.round(height * scale)) canvas.height = Math.round(height * scale);
    context.setTransform(scale, 0, 0, scale, 0, 0);
    const type = moveType(playing);
    const colours = (type === null ? undefined : CONTENT.weather.get(type)?.colours) ?? NO_TYPE;
    const still = reducedMotion();
    painter(context, { shape: arena.shape, colours, t: still ? STILL_T : ((now - started) % PREVIEW_LOOP_MS) / PREVIEW_LOOP_MS, width, height });
    if (!still) frame = requestAnimationFrame(draw);
  }

  return {
    play: (moveId) => {
      cancelAnimationFrame(frame);
      playing = moveId;
      started = performance.now();
      draw(started);
    },
    stop: () => {
      cancelAnimationFrame(frame);
      playing = null;
    },
    playing: () => playing,
  };
}
