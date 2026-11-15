import type { GameObjects } from 'phaser';
import { drawBurst, fillPoly, lerpColour } from './prototype-shapes.ts';

/** The chunky bars over each creature: health with a white trail of what was just lost, and energy. */

type G = GameObjects.Graphics;
const INK = 0x102a43;
const GREEN = 0x40c057;
const YELLOW = 0xfcc419;
const RED = 0xfa5252;
export const ENERGY_COLOUR = 0x22d3ee;

/** Green when full, yellow at half, red near empty. */
export function healthColour(share: number): number {
  return share >= 0.5 ? lerpColour(YELLOW, GREEN, (share - 0.5) * 2) : lerpColour(RED, YELLOW, share * 2);
}

export type HealthBar = { x: number; y: number; width: number; height: number; shown: number; trail: number; max: number; flash: boolean };

export function drawHealthBar(g: G, bar: HealthBar): void {
  const { x, y, width, height } = bar;
  const left = x - width / 2;
  const top = y - height / 2;
  const radius = Math.min(8, height / 2);
  const border = Math.max(3, Math.round(height * 0.2));
  g.fillStyle(bar.flash ? 0xffffff : INK, 1);
  g.fillRoundedRect(left - border, top - border, width + border * 2, height + border * 2, radius + border);
  g.fillStyle(0x334e68, 1);
  g.fillRoundedRect(left, top, width, height, radius);
  const share = Math.max(0, Math.min(1, bar.shown / bar.max));
  const trail = Math.max(share, Math.min(1, bar.trail / bar.max));
  if (trail > share) {
    g.fillStyle(0xffffff, 1);
    g.fillRoundedRect(left, top, Math.max(height, width * trail), height, radius);
  }
  if (share > 0) {
    const fill = Math.max(height * 0.6, width * share);
    g.fillStyle(healthColour(share), 1);
    g.fillRoundedRect(left, top, fill, height, radius);
    g.fillStyle(0xffffff, 0.35);
    g.fillRoundedRect(left + 3, top + 2, Math.max(0, fill - 6), Math.max(2, height * 0.28), Math.min(3, radius));
  }
  g.fillStyle(INK, 0.45);
  for (let at = 1; at < 4; at += 1) g.fillRect(left + (width * at) / 4 - 1, top, 2, height);
}

/** Ten segments; a part-filled one shows energy still coming in. Glows when full. */
export function drawEnergyBar(g: G, x: number, y: number, width: number, height: number, energy: number, max: number, now: number): void {
  const gap = 3;
  const segment = (width - gap * (max - 1)) / max;
  const left = x - width / 2;
  g.fillStyle(INK, 0.85);
  g.fillRoundedRect(left - 3, y - height / 2 - 3, width + 6, height + 6, 5);
  if (energy >= max) {
    g.fillStyle(ENERGY_COLOUR, 0.25 + 0.15 * Math.sin(now / 150));
    g.fillRoundedRect(left - 7, y - height / 2 - 7, width + 14, height + 14, 8);
    g.fillStyle(INK, 0.85);
    g.fillRoundedRect(left - 3, y - height / 2 - 3, width + 6, height + 6, 5);
  }
  for (let at = 0; at < max; at += 1) {
    const sx = left + at * (segment + gap);
    const filled = Math.max(0, Math.min(1, energy - at));
    g.fillStyle(0x1f3b57, 1);
    g.fillRect(sx, y - height / 2, segment, height);
    if (filled <= 0) continue;
    g.fillStyle(filled >= 1 ? ENERGY_COLOUR : lerpColour(0x0b7285, ENERGY_COLOUR, 0.4), 1);
    g.fillRect(sx, y - height / 2, segment * filled, height);
    if (filled >= 1) {
      g.fillStyle(0xffffff, 0.5);
      g.fillRect(sx, y - height / 2, segment, Math.max(2, height * 0.3));
    }
  }
}

/** Two glowing up arrows: this creature is charging up. */
export function drawChargeMark(g: G, x: number, y: number, r: number, now: number): void {
  const lift = ((now / 450) % 1) * r * 0.35;
  g.fillStyle(ENERGY_COLOUR, 0.3 + 0.15 * Math.sin(now / 120));
  g.fillCircle(x, y, r * 1.25);
  for (const [at, alpha] of [
    [-0.45, 1],
    [0.25, 0.85],
  ] as const) {
    const cy = y + at * r - lift + r * 0.2;
    const chevron = [
      { x: x - r * 0.8, y: cy + r * 0.35 },
      { x, y: cy - r * 0.45 },
      { x: x + r * 0.8, y: cy + r * 0.35 },
      { x: x + r * 0.8, y: cy + r * 0.75 },
      { x, y: cy - r * 0.05 },
      { x: x - r * 0.8, y: cy + r * 0.75 },
    ];
    g.fillStyle(INK, alpha);
    fillPoly(g, chevron.map((p) => ({ x: x + (p.x - x) * 1.18, y: cy + (p.y - cy) * 1.25 })));
    g.fillStyle(ENERGY_COLOUR, alpha);
    fillPoly(g, chevron);
  }
}

/** A yellow burst behind a "!": a big move or an attack is coming. The "!" itself is a text object. */
export function drawAlertMark(g: G, x: number, y: number, r: number, now: number): void {
  drawBurst(g, x, y, r * (1 + 0.08 * Math.sin(now / 70)), 0xffd43b);
}

/** The level pill: dark for an even match, red when this creature is higher, green when lower. */
export function drawBadge(g: G, x: number, y: number, width: number, height: number, colour: number): void {
  g.fillStyle(INK, 1);
  g.fillRoundedRect(x - 2, y - 2, width + 4, height + 4, (height + 4) / 2);
  g.fillStyle(colour, 1);
  g.fillRoundedRect(x, y, width, height, height / 2);
}
