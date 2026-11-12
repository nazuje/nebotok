import type { BefriendRules, Species, Treat } from './content.ts';

/** How much a creature wants a treat: its favourite, one its weather type likes, or neither. */
export type TreatLiking = 'favourite' | 'liked' | 'none';

/**
 * A treat is a creature's favourite when its species names the treat as `favouriteTreat` or the
 * treat names the species in `likedBy.species`; it is liked when the treat names the creature's
 * weather type in `likedBy.types`.
 */
export function treatLiking(item: Treat, species: Species): TreatLiking {
  if (species.favouriteTreat === item.id || item.likedBy.species.includes(species.id)) return 'favourite';
  if (item.likedBy.types.includes(species.type)) return 'liked';
  return 'none';
}

export type BefriendInput = {
  /** The wild creature's health now: 0 once it has fainted. */
  readonly hp: number;
  readonly maxHp: number;
  readonly level: number;
  readonly liking: TreatLiking;
  /** The treat's `strength` in items.json: 0 when it has none. */
  readonly strength?: number;
};

const LIKING_BONUS: Readonly<Record<TreatLiking, (rules: BefriendRules) => number>> = {
  favourite: (rules) => rules.favouritePercent,
  liked: (rules) => rules.likedPercent,
  none: () => 0,
};

/**
 * The chance, in whole percent, that a wild creature accepts a treat and joins. A tired creature
 * (less health left), a treat it likes, a stronger treat and a lower level all raise it; see
 * `BefriendRules`. Integer maths only, so every machine agrees. The engine rolls
 * `rng.int(1, 100) <= chance`.
 */
export function befriendChance({ hp, maxHp, level, liking, strength = 0 }: BefriendInput, rules: BefriendRules): number {
  if (!Number.isInteger(maxHp) || maxHp < 1) throw new RangeError(`befriendChance() needs a whole maxHp of at least 1, got ${maxHp}`);
  const left = Math.min(Math.max(Math.trunc(hp), 0), maxHp);
  const tired = Math.floor((rules.tiredPercent * (maxHp - left)) / maxHp);
  const penalty = Math.floor((rules.levelPenaltyPer10Levels * Math.max(Math.trunc(level), 0)) / 10);
  const chance = rules.basePercent + tired + LIKING_BONUS[liking](rules) + Math.max(Math.trunc(strength), 0) - penalty;
  return Math.min(Math.max(chance, rules.minPercent), rules.maxPercent);
}
