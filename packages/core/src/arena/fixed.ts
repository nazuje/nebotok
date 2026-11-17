/**
 * Whole-number maths for the arena, so the server (V8) and an iPad's Safari (JavaScriptCore) step
 * the island to the same unit. Every division truncates towards zero, which keeps each rule
 * point-symmetric: a mirrored fight gives exactly mirrored numbers.
 */

/** Positions are in 1/256 arena units; velocities in 1/256 arena units a tick. */
export const SUBUNITS = 256;
/** One fixed step is one tick, 60 a second. */
export const TICKS_PER_SECOND = 60;
/** Unit vectors and cosines are in 1/4096. */
export const ONE = 4096;
export const DIRECTION_COUNT = 16;

/**
 * The 16 directions as unit vectors in 1/4096: index 0 points along +x (right on the screen) and
 * each next one turns 22.5° towards +y (down), so 4 is down, 8 left and 12 up. Literal constants,
 * so no engine's trigonometry is involved; `d + 8` is always the exact opposite of `d`.
 */
export const DIRECTION_VECTORS: readonly (readonly [number, number])[] = [
  [4096, 0],
  [3784, 1567],
  [2896, 2896],
  [1567, 3784],
  [0, 4096],
  [-1567, 3784],
  [-2896, 2896],
  [-3784, 1567],
  [-4096, 0],
  [-3784, -1567],
  [-2896, -2896],
  [-1567, -3784],
  [0, -4096],
  [1567, -3784],
  [2896, -2896],
  [3784, -1567],
];

/** The direction pointing the other way. */
export const oppositeDirection = (direction: number): number => (direction + DIRECTION_COUNT / 2) % DIRECTION_COUNT;

export function directionVector(direction: number): readonly [number, number] {
  const vector = DIRECTION_VECTORS[direction];
  if (!vector) throw new RangeError(`direction ${direction} is not 0 to ${DIRECTION_COUNT - 1}`);
  return vector;
}

/**
 * `a / b` truncated towards zero. Exact for any |a| below 2^53, because a double's rounding error
 * there is smaller than the gap between the quotient and the next whole number.
 */
export const div = (a: number, b: number): number => Math.trunc(a / b);

/** `value × percent / 100`, truncated towards zero. */
export const percentOf = (value: number, percent: number): number => div(value * percent, 100);

/** `value × permille / 1000`, truncated towards zero. */
export const permilleOf = (value: number, permille: number): number => div(value * permille, 1000);

/** The largest whole number whose square is at most `n`, for a whole `n` from 0 to 2^53. */
export function isqrt(n: number): number {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError(`isqrt() needs a whole number from 0, got ${n}`);
  if (n < 2) return n;
  let guess = 1;
  while (guess * guess <= n) guess *= 2;
  // Newton's method from above only ever comes down, and stops at the floor of the root.
  for (;;) {
    const next = Math.floor((guess + Math.floor(n / guess)) / 2);
    if (next >= guess) return guess;
    guess = next;
  }
}

/** The length of a whole-number vector, rounded down. */
export const lengthOf = (x: number, y: number): number => isqrt(x * x + y * y);

/** Arena units to 1/256 arena units. */
export const toSubunits = (units: number): number => units * SUBUNITS;

/** A speed in arena units a second as 1/256 arena units a tick. */
export const speedPerTick = (unitsPerSecond: number): number => div(unitsPerSecond * SUBUNITS, TICKS_PER_SECOND);

/** A speed in 1/256 arena units a tick as whole arena units a second, for events. */
export const speedPerSecond = (subunitsPerTick: number): number => div(subunitsPerTick * TICKS_PER_SECOND, SUBUNITS);
