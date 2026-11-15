import { CREATURE_SIZE } from '../creature-art.ts';

/** Where the prototype's arena puts things, in game pixels (the same as CSS pixels here). */

export type Spot = { readonly x: number; readonly y: number };
export type WheelLayout = { readonly cx: number; readonly cy: number; readonly r: number; readonly plate: number; readonly angles: ReadonlyMap<string, number> };
/** `spots` are each creature's feet; `bars` the middle of each health bar, `barWidth` and `barHeight` its size. */
export type Layout = {
  readonly scale: number;
  readonly size: number;
  readonly spots: readonly [Spot, Spot];
  readonly bars: readonly [Spot, Spot];
  readonly barWidth: number;
  readonly barHeight: number;
  readonly wheel: WheelLayout | null;
};

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const EDGE = 8;

/** Keeps a bar's middle far enough in that the whole bar stays on screen. */
const onScreen = (x: number, width: number, barWidth: number) => clamp(x, barWidth / 2 + EDGE, width - barWidth / 2 - EDGE);

/** Side view: your creature on the left island, the wild one on the right, a little higher and further off. */
export function duelLayout(width: number, top: number, bottom: number, energy = false): Layout {
  const height = Math.max(120, bottom - top);
  const scale = clamp(Math.floor(Math.min(width * 0.26, height * 0.34) / CREATURE_SIZE), 2, 6);
  const size = CREATURE_SIZE * scale;
  const spots: [Spot, Spot] = [
    { x: Math.round(width * 0.27), y: Math.round(top + height * 0.74) },
    { x: Math.round(width * 0.73), y: Math.round(top + height * 0.6) },
  ];
  const barWidth = Math.round(clamp(size * 1.25, 110, 200));
  const barHeight = Math.round(clamp(size * 0.15, 16, 26));
  // Room under the health bar for the energy bar, when there is one.
  const below = energy ? barHeight * 1.9 + 12 : barHeight * 1.2;
  const barOf = (spot: Spot): Spot => ({ x: Math.round(onScreen(spot.x, width, barWidth)), y: Math.round(spot.y - size - below) });
  return { scale, size, spots, bars: [barOf(spots[0]), barOf(spots[1])], barWidth, barHeight, wheel: null };
}

/**
 * The weather wheel: each type on a ring, clockwise in the order each beats the next. Each creature
 * stands on its own type's plate like a pedestal, its health bar over its head. When both share a
 * type, they stand either side of it.
 */
export function wheelLayout(width: number, top: number, bottom: number, types: readonly [string, string], cycle: readonly string[]): Layout {
  const height = Math.max(200, bottom - top);
  const scale = clamp(Math.floor((Math.min(width, height) * 0.17) / CREATURE_SIZE), 2, 4);
  const size = CREATURE_SIZE * scale;
  const plate = Math.max(22, Math.round(size * 0.36));
  const barWidth = Math.round(clamp(size * 1.15, 96, 160));
  const barHeight = Math.round(clamp(size * 0.15, 14, 22));
  const above = plate * 0.7 + size + barHeight * 3;
  const r = Math.max(70, Math.min(width / 2 - plate - size * 0.6, (height - above - plate - 12) / 2));
  const cx = Math.round(width / 2);
  const cy = Math.round(top + above + r + Math.max(0, (height - above - plate - 12 - 2 * r) / 2));
  const angles = new Map(cycle.map((type, at) => [type, -Math.PI / 2 + (at * Math.PI * 2) / cycle.length]));
  const same = types[0] === types[1];
  const spotOf = (side: 0 | 1): Spot => {
    const angle = angles.get(types[side]) ?? 0;
    const shift = same ? (side === 0 ? -1 : 1) * (plate + size * 0.3) : 0;
    return { x: Math.round(cx + Math.cos(angle) * r + shift), y: Math.round(cy + Math.sin(angle) * r - plate * 0.7) };
  };
  const spots: [Spot, Spot] = [spotOf(0), spotOf(1)];
  // Beside the creature on the ring's inner side, so the bar never covers the next plate up.
  const barOf = (spot: Spot): Spot => {
    const inward = Math.sign(cx - spot.x);
    if (Math.abs(cx - spot.x) < size * 0.5) return { x: Math.round(onScreen(spot.x, width, barWidth)), y: Math.round(spot.y - size - barHeight * 1.2) };
    return { x: Math.round(onScreen(spot.x + inward * (size * 0.4 + barWidth * 0.5), width, barWidth)), y: Math.round(spot.y - size * 0.75) };
  };
  return { scale, size, spots, bars: apart(barOf(spots[0]), barOf(spots[1]), barWidth, barHeight), barWidth, barHeight, wheel: { cx, cy, r, plate, angles } };
}

/** When two bars (with their level badges) would overlap, lifts the higher one clear of the other. */
function apart(first: Spot, second: Spot, barWidth: number, barHeight: number): [Spot, Spot] {
  const tall = barHeight * 3.4;
  if (Math.abs(first.x - second.x) >= barWidth + 12 || Math.abs(first.y - second.y) >= tall) return [first, second];
  const lift = (spot: Spot, below: Spot): Spot => ({ x: spot.x, y: Math.round(below.y - tall) });
  return first.y <= second.y ? [lift(first, second), second] : [first, lift(second, first)];
}
