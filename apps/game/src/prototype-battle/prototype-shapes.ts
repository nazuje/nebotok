import type { GameObjects } from 'phaser';

/** Simple shapes the prototype draws with Phaser Graphics, all centred on (x, y). */

type G = GameObjects.Graphics;
type P = { x: number; y: number };

function trace(g: G, points: readonly P[]): void {
  const [first, ...others] = points;
  if (!first) return;
  g.beginPath();
  g.moveTo(first.x, first.y);
  for (const point of others) g.lineTo(point.x, point.y);
}

export function fillPoly(g: G, points: readonly P[]): void {
  trace(g, points);
  g.closePath();
  g.fillPath();
}

export function strokeLine(g: G, points: readonly P[]): void {
  trace(g, points);
  g.strokePath();
}

export function lerpColour(from: number, to: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const channel = (shift: number) => Math.round(((from >> shift) & 0xff) * (1 - k) + ((to >> shift) & 0xff) * k);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/** A puffy cloud `width` wide. */
export function drawCloud(g: G, x: number, y: number, width: number, colour: number, alpha: number): void {
  g.fillStyle(colour, alpha);
  g.fillEllipse(x, y + width * 0.08, width, width * 0.38);
  g.fillEllipse(x - width * 0.24, y, width * 0.5, width * 0.36);
  g.fillEllipse(x + width * 0.22, y - width * 0.02, width * 0.56, width * 0.42);
  g.fillEllipse(x - width * 0.02, y - width * 0.12, width * 0.5, width * 0.46);
}

function star(x: number, y: number, outer: number, inner: number, points: number): P[] {
  const list: P[] = [];
  for (let at = 0; at < points * 2; at += 1) {
    const angle = -Math.PI / 2 + (at * Math.PI) / points;
    const r = at % 2 === 0 ? outer : inner;
    list.push({ x: x + Math.cos(angle) * r, y: y + Math.sin(angle) * r });
  }
  return list;
}

export function drawStar(g: G, x: number, y: number, r: number, colour: number): void {
  g.fillStyle(0x102a43, 1);
  fillPoly(g, star(x, y, r + 3, r * 0.45 + 2, 5));
  g.fillStyle(colour, 1);
  fillPoly(g, star(x, y, r, r * 0.45, 5));
}

/** A spiky burst behind the "!!" of a very strong hit. */
export function drawBurst(g: G, x: number, y: number, r: number, colour: number): void {
  g.fillStyle(0x102a43, 1);
  fillPoly(g, star(x, y, r + 3, r * 0.62 + 2, 10));
  g.fillStyle(colour, 1);
  fillPoly(g, star(x, y, r, r * 0.62, 10));
}

export function drawTick(g: G, x: number, y: number, r: number): void {
  g.fillStyle(0xffffff, 1);
  g.fillCircle(x, y, r);
  g.lineStyle(Math.max(4, r * 0.28), 0x2f9e44, 1);
  g.beginPath();
  g.moveTo(x - r * 0.5, y + r * 0.02);
  g.lineTo(x - r * 0.12, y + r * 0.4);
  g.lineTo(x + r * 0.52, y - r * 0.38);
  g.strokePath();
}

/** A little grey puff: a miss, or a hit that barely tickles. */
export function drawPuff(g: G, x: number, y: number, r: number): void {
  g.fillStyle(0x868e96, 0.9);
  g.fillCircle(x - r * 0.45, y + r * 0.15, r * 0.5);
  g.fillCircle(x + r * 0.45, y + r * 0.2, r * 0.45);
  g.fillCircle(x, y - r * 0.2, r * 0.6);
  g.fillStyle(0xdee2e6, 1);
  g.fillCircle(x - r * 0.1, y - r * 0.28, r * 0.3);
}

export function drawShield(g: G, x: number, y: number, r: number, colour: number): void {
  const outline = [
    { x: x - r, y: y - r * 0.8 },
    { x: x + r, y: y - r * 0.8 },
    { x: x + r * 0.9, y: y + r * 0.2 },
    { x, y: y + r * 1.05 },
    { x: x - r * 0.9, y: y + r * 0.2 },
  ];
  g.fillStyle(0x102a43, 1);
  fillPoly(g, outline.map((p) => ({ x: x + (p.x - x) * 1.15, y: y + (p.y - y) * 1.15 })));
  g.fillStyle(colour, 1);
  fillPoly(g, outline);
  g.fillStyle(0xffffff, 0.6);
  g.fillRect(x - r * 0.12, y - r * 0.65, r * 0.24, r * 1.3);
}

export function drawCrown(g: G, x: number, y: number, r: number): void {
  const points = [
    { x: x - r, y: y + r * 0.5 },
    { x: x - r, y: y - r * 0.5 },
    { x: x - r * 0.5, y },
    { x, y: y - r * 0.7 },
    { x: x + r * 0.5, y },
    { x: x + r, y: y - r * 0.5 },
    { x: x + r, y: y + r * 0.5 },
  ];
  g.fillStyle(0x102a43, 1);
  fillPoly(g, points.map((p) => ({ x: x + (p.x - x) * 1.18, y: y + (p.y - y) * 1.18 })));
  g.fillStyle(0xffd43b, 1);
  fillPoly(g, points);
  g.fillStyle(0xf03e3e, 1);
  g.fillCircle(x, y + r * 0.15, r * 0.18);
}

/** A rock island floating in the sky, its grass top `width` wide with its middle at (x, y). */
export function drawIsland(g: G, x: number, y: number, width: number, grass: number): void {
  const h = width * 0.5;
  const rock = [
    { x: x - width * 0.5, y },
    { x: x + width * 0.5, y },
    { x: x + width * 0.36, y: y + h * 0.42 },
    { x: x + width * 0.16, y: y + h * 0.7 },
    { x: x + width * 0.02, y: y + h * 1.05 },
    { x: x - width * 0.14, y: y + h * 0.66 },
    { x: x - width * 0.34, y: y + h * 0.46 },
  ];
  g.fillStyle(0x7a5c4f, 1);
  fillPoly(g, rock);
  g.fillStyle(0x5d4037, 1);
  g.fillTriangle(x + width * 0.36, y + h * 0.42, x + width * 0.16, y + h * 0.7, x + width * 0.1, y + h * 0.2);
  g.fillTriangle(x - width * 0.14, y + h * 0.66, x - width * 0.34, y + h * 0.46, x - width * 0.12, y + h * 0.3);
  g.fillStyle(lerpColour(grass, 0x000000, 0.3), 1);
  g.fillEllipse(x, y + h * 0.06, width * 1.02, h * 0.36);
  g.fillStyle(grass, 1);
  g.fillEllipse(x, y, width, h * 0.3);
}
