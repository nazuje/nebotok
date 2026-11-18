import { treatLiking, type TreatLiking } from '../befriend.ts';
import type { ArenaRules, Item, Species } from '../content.ts';
import { ONE, div, lengthOf, percentOf, speedPerTick, toSubunits } from './fixed.ts';
import { flightTicks, within } from './abilities.ts';
import type { FightTreat, TreatStack } from './fight-state.ts';
import type { Body } from './state.ts';
import type { Aim } from './working.ts';

/**
 * Treats in a wild fight (docs/arena.md, "Treats and befriending"): when the Treat button shows,
 * which treat it throws, and a thrown treat's flight and its time on the ground.
 */

/** However strong a treat, the window never opens wider than this share of the wild creature's health. */
export const TREAT_WINDOW_CAP_PERCENT = 45;
/** A wild creature that eats a treat from the ground heals this share of its health. */
export const TREAT_HEAL_PERCENT = 10;

/** The treat the button throws, and how much the wild creature wants it. */
export type TreatChoice = { readonly item: string; readonly liking: TreatLiking; readonly strength: number };

const LIKING_ORDER: Readonly<Record<TreatLiking, number>> = { favourite: 0, liked: 1, none: 2 };

/**
 * The best treat in the bag for `species`: its favourite, then one its type likes, then the
 * strongest plain one; among equals the strongest, then the first id. Null with no treat left.
 */
export function bestTreat(bag: readonly TreatStack[], species: Species, items: ReadonlyMap<string, Item>): TreatChoice | null {
  const choices = bag.flatMap(({ item, count }) => {
    const treat = items.get(item);
    if (count < 1 || treat?.kind !== 'treat') return [];
    return [{ item, liking: treatLiking(treat, species), strength: treat.strength ?? 0 }];
  });
  const ranked = choices.toSorted((a, b) => LIKING_ORDER[a.liking] - LIKING_ORDER[b.liking] || b.strength - a.strength || (a.item < b.item ? -1 : a.item > b.item ? 1 : 0));
  return ranked[0] ?? null;
}

/** The share of its health, in percent, the wild creature must be under for this treat: by liking, plus a cooked treat's strength, capped. */
export function treatWindowPercent({ liking, strength }: Pick<TreatChoice, 'liking' | 'strength'>, rules: ArenaRules): number {
  const { treat } = rules;
  const base = liking === 'favourite' ? treat.favouriteWindowPercent : liking === 'liked' ? treat.likedWindowPercent : treat.windowPercent;
  return Math.min(TREAT_WINDOW_CAP_PERCENT, base + strength);
}

/** Whether the wild creature is weak enough for this treat: under its window, still standing on the island. */
export function treatWindowOpen(choice: Pick<TreatChoice, 'liking' | 'strength'>, wild: Body, rules: ArenaRules): boolean {
  return !wild.out && wild.health > 0 && wild.health * 100 < treatWindowPercent(choice, rules) * wild.maxHealth;
}

/** How big a thrown treat is, in arena units: a liked one is bigger, a favourite bigger still. */
export function treatRadius(liking: TreatLiking, rules: ArenaRules): number {
  const { treat } = rules;
  return liking === 'favourite' ? treat.favouriteRadius : liking === 'liked' ? treat.likedRadius : treat.radius;
}

/** The bag with one fewer of `item` (thrown) or one more (picked back up). */
export function treatsWith(bag: readonly TreatStack[], item: string, change: 1 | -1): TreatStack[] {
  return bag.map((stack) => (stack.item === item ? { item, count: Math.max(0, stack.count + change) } : stack));
}

/** A treat thrown from the body's edge along the aim. */
export function throwTreat(body: Body, aim: Aim, choice: TreatChoice, rules: ArenaRules): FightTreat {
  const radius = toSubunits(treatRadius(choice.liking, rules));
  const start = toSubunits(rules.island.body) + radius;
  const speed = speedPerTick(rules.treat.speed);
  return {
    item: choice.item,
    liking: choice.liking,
    x: body.x + div(aim.x * start, ONE),
    y: body.y + div(aim.y * start, ONE),
    vx: div(aim.x * speed, ONE),
    vy: div(aim.y * speed, ONE),
    radius,
    ticks: flightTicks(rules.treat.range, rules.treat.speed),
    landed: false,
  };
}

/** What a treat did this tick. */
export type TreatMove =
  | { readonly kind: 'flying' | 'lying'; readonly treat: FightTreat }
  | { readonly kind: 'landed'; readonly treat: FightTreat }
  | { readonly kind: 'befriended' | 'pickedUp' | 'eaten' | 'lost'; readonly treat: null };

const touches = (body: Body, treat: FightTreat, size: number): boolean => !body.out && within(body.x - treat.x, body.y - treat.y, size + treat.radius);

function fly(treat: FightTreat, bodies: readonly [Body, Body], radius: number, rules: ArenaRules): TreatMove {
  const moved = { ...treat, x: treat.x + treat.vx, y: treat.y + treat.vy, ticks: treat.ticks - 1 };
  if (touches(bodies[1], moved, toSubunits(rules.island.body))) return { kind: 'befriended', treat: null };
  if (moved.ticks > 0) return { kind: 'flying', treat: moved };
  if (lengthOf(moved.x, moved.y) > radius) return { kind: 'lost', treat: null };
  return { kind: 'landed', treat: { ...moved, vx: 0, vy: 0, ticks: rules.treat.groundTicks, landed: true } };
}

/** A treat on the ground: yours picks it up, the wild one eats it; it is gone once its time is up or the storm takes its ground. */
function lie(treat: FightTreat, bodies: readonly [Body, Body], radius: number, rules: ArenaRules): TreatMove {
  const size = toSubunits(rules.island.body);
  if (touches(bodies[0], treat, size)) return { kind: 'pickedUp', treat: null };
  if (touches(bodies[1], treat, size)) return { kind: 'eaten', treat: null };
  if (treat.ticks <= 1 || lengthOf(treat.x, treat.y) > radius) return { kind: 'lost', treat: null };
  return { kind: 'lying', treat: { ...treat, ticks: treat.ticks - 1 } };
}

/**
 * Moves a thrown treat on a tick, after the island's step: a flying treat that touches the wild
 * creature befriends it; at the end of its flight it lands, or is lost past the edge.
 */
export function moveTreat(treat: FightTreat, bodies: readonly [Body, Body], radius: number, rules: ArenaRules): TreatMove {
  return treat.landed ? lie(treat, bodies, radius, rules) : fly(treat, bodies, radius, rules);
}

/** The wild creature's health after it eats a treat, and how much that healed. */
export function eatenHealth(wild: Body): { readonly health: number; readonly amount: number } {
  const amount = Math.min(Math.max(1, percentOf(wild.maxHealth, TREAT_HEAL_PERCENT)), wild.maxHealth - wild.health);
  return { health: wild.health + amount, amount };
}
