/**
 * Seeded random numbers for game rules. sfc32 (Chris Doty-Humphrey's Small Fast Counting generator)
 * seeded through splitmix32, so the same seed gives the same sequence on the server and in every browser.
 */

export type RngState = readonly [number, number, number, number];

export type Rng = {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [min, max], both ends included. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** A copy of the internal state; `rngFromState` resumes the exact sequence from it. */
  state(): RngState;
};

const SEED_WARMUP_ROUNDS = 12;

function splitmix32(seed: number): () => number {
  let x = seed >>> 0;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = x;
    z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

/** FNV-1a over UTF-16 code units, so string seeds need no encoder. */
function stringSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < seed.length; at += 1) {
    hash ^= seed.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function isUint32(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 0xffffffff;
}

export function isRngState(value: unknown): value is RngState {
  return Array.isArray(value) && value.length === 4 && value.every(isUint32);
}

export function rngFromState(initial: RngState): Rng {
  if (!isRngState(initial)) throw new TypeError('RNG state must be four unsigned 32-bit integers');
  let [a, b, c, d] = initial;

  const nextUint32 = (): number => {
    const t = (((a + b) >>> 0) + d) >>> 0;
    d = (d + 1) >>> 0;
    a = (b ^ (b >>> 9)) >>> 0;
    b = (c + (c << 3)) >>> 0;
    c = ((c << 21) | (c >>> 11)) >>> 0;
    c = (c + t) >>> 0;
    return t;
  };

  const int = (min: number, max: number): number => {
    if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) throw new RangeError('int() needs integer bounds');
    if (min > max) throw new RangeError(`int() min ${min} is above max ${max}`);
    const span = max - min + 1;
    if (span > 0x100000000) throw new RangeError('int() range is wider than 2^32');
    // Rejection sampling keeps every value equally likely when span does not divide 2^32.
    const limit = 0x100000000 - (0x100000000 % span);
    let draw = nextUint32();
    while (draw >= limit) draw = nextUint32();
    return min + (draw % span);
  };

  return {
    next: () => nextUint32() / 0x100000000,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('pick() needs at least one item');
      return items[int(0, items.length - 1)] as T;
    },
    state: () => [a, b, c, d],
  };
}

export function createRng(seed: number | string): Rng {
  const numeric = typeof seed === 'string' ? stringSeed(seed) : seed;
  if (!Number.isSafeInteger(numeric)) throw new TypeError('RNG seed must be an integer or a string');
  const mix = splitmix32(numeric >>> 0);
  const rng = rngFromState([mix(), mix(), mix(), mix()]);
  for (let round = 0; round < SEED_WARMUP_ROUNDS; round += 1) rng.next();
  return rng;
}
