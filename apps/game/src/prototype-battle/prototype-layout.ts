import { CREATURE_SIZE } from '../creature-art.ts';

/** Where the prototype's arena puts things, in game pixels (the same as CSS pixels here). */

export type Spot = { readonly x: number; readonly y: number };
export type WheelLayout = { readonly cx: number; readonly cy: number; readonly r: number; readonly plate: number; readonly angles: ReadonlyMap<string, number> };
/** `spots` are each creature's feet; `clouds` the middle of each health cloud. */
export type Layout = { readonly scale: number; readonly size: number; readonly spots: readonly [Spot, Spot]; readonly clouds: readonly [Spot, Spot]; readonly wheel: WheelLayout | null };

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Side view: your creature on the left island, the wild one on the right, a little higher and further off. */
export function duelLayout(width: number, top: number, bottom: number): Layout {
  const height = Math.max(120, bottom - top);
  const scale = clamp(Math.floor(Math.min(width * 0.26, height * 0.34) / CREATURE_SIZE), 2, 6);
  const size = CREATURE_SIZE * scale;
  const spots: [Spot, Spot] = [
    { x: Math.round(width * 0.27), y: Math.round(top + height * 0.74) },
    { x: Math.round(width * 0.73), y: Math.round(top + height * 0.6) },
  ];
  const cloudOf = (spot: Spot): Spot => ({ x: spot.x, y: Math.round(spot.y - size - size * 0.3) });
  return { scale, size, spots, clouds: [cloudOf(spots[0]), cloudOf(spots[1])], wheel: null };
}

/**
 * The weather wheel: each type on a ring, clockwise in the order each beats the next. Each creature
 * stands on its own type's plate like a pedestal, its health cloud over its head. When both share a
 * type, they stand either side of it.
 */
export function wheelLayout(width: number, top: number, bottom: number, types: readonly [string, string], cycle: readonly string[]): Layout {
  const height = Math.max(200, bottom - top);
  const scale = clamp(Math.floor((Math.min(width, height) * 0.17) / CREATURE_SIZE), 2, 4);
  const size = CREATURE_SIZE * scale;
  const plate = Math.max(22, Math.round(size * 0.36));
  const above = plate * 0.7 + size + Math.max(56, size * 0.95) * 0.45;
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
  // Beside the creature on the ring's inner side, so the cloud never covers the next plate up.
  const cloudOf = (spot: Spot): Spot => {
    const inward = Math.sign(cx - spot.x);
    if (Math.abs(cx - spot.x) < size * 0.5) return { x: spot.x, y: Math.round(spot.y - size - Math.max(56, size * 0.95) * 0.18) };
    return { x: Math.round(spot.x + inward * (size * 0.5 + Math.max(56, size * 0.95) * 0.55)), y: Math.round(spot.y - size * 0.7) };
  };
  return { scale, size, spots, clouds: [cloudOf(spots[0]), cloudOf(spots[1])], wheel: { cx, cy, r, plate, angles } };
}
