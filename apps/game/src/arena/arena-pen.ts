/**
 * The few drawing calls the arena's painters use. Phaser's `GameObjects.Graphics` has them all, so
 * the arena scene passes its graphics straight in; `canvasPen` gives a 2D canvas the same calls, so
 * the loadout picker's preview (src/shape-preview.ts) paints moves exactly as the fight does.
 * Colours are 0xRRGGBB numbers, as Phaser takes them.
 */
export type Pen = {
  fillStyle(colour: number, alpha?: number): unknown;
  lineStyle(width: number, colour: number, alpha?: number): unknown;
  fillCircle(x: number, y: number, radius: number): unknown;
  strokeCircle(x: number, y: number, radius: number): unknown;
  fillEllipse(x: number, y: number, width: number, height: number): unknown;
  fillTriangle(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): unknown;
  fillRect(x: number, y: number, width: number, height: number): unknown;
  fillRoundedRect(x: number, y: number, width: number, height: number, radius?: number): unknown;
  lineBetween(x0: number, y0: number, x1: number, y1: number): unknown;
  beginPath(): unknown;
  moveTo(x: number, y: number): unknown;
  lineTo(x: number, y: number): unknown;
  arc(x: number, y: number, radius: number, start: number, end: number, anticlockwise?: boolean): unknown;
  closePath(): unknown;
  fillPath(): unknown;
  strokePath(): unknown;
};

const css = (colour: number, alpha: number): string => `rgb(${(colour >> 16) & 0xff} ${(colour >> 8) & 0xff} ${colour & 0xff} / ${Math.max(0, Math.min(1, alpha))})`;

/** A colour such as `#4dabf7` as a number; `fallback` for anything else. */
export function colourOf(hex: string | undefined, fallback: number): number {
  return hex !== undefined && /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : fallback;
}

/** The pen on a 2D canvas. Shapes fill and stroke at once, as Phaser's do, and leave any path being traced alone. */
export function canvasPen(context: CanvasRenderingContext2D): Pen {
  const shape = (trace: () => void, fill: boolean) => {
    context.beginPath();
    trace();
    if (fill) context.fill();
    else context.stroke();
  };
  const pen: Pen = {
    fillStyle: (colour, alpha = 1) => {
      context.fillStyle = css(colour, alpha);
    },
    lineStyle: (width, colour, alpha = 1) => {
      context.lineWidth = width;
      context.strokeStyle = css(colour, alpha);
    },
    fillCircle: (x, y, radius) => shape(() => context.arc(x, y, Math.max(0, radius), 0, Math.PI * 2), true),
    strokeCircle: (x, y, radius) => shape(() => context.arc(x, y, Math.max(0, radius), 0, Math.PI * 2), false),
    fillEllipse: (x, y, width, height) => shape(() => context.ellipse(x, y, Math.max(0, width / 2), Math.max(0, height / 2), 0, 0, Math.PI * 2), true),
    fillTriangle: (x0, y0, x1, y1, x2, y2) =>
      shape(() => {
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
        context.lineTo(x2, y2);
        context.closePath();
      }, true),
    fillRect: (x, y, width, height) => context.fillRect(x, y, width, height),
    fillRoundedRect: (x, y, width, height, radius = 0) => shape(() => context.roundRect(x, y, width, height, Math.max(0, Math.min(radius, width / 2, height / 2))), true),
    lineBetween: (x0, y0, x1, y1) =>
      shape(() => {
        context.moveTo(x0, y0);
        context.lineTo(x1, y1);
      }, false),
    beginPath: () => context.beginPath(),
    moveTo: (x, y) => context.moveTo(x, y),
    lineTo: (x, y) => context.lineTo(x, y),
    arc: (x, y, radius, start, end, anticlockwise = false) => context.arc(x, y, Math.max(0, radius), start, end, anticlockwise),
    closePath: () => context.closePath(),
    fillPath: () => context.fill(),
    strokePath: () => context.stroke(),
  };
  return pen;
}
