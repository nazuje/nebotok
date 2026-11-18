import { div, percentOf, toSubunits } from './fixed.ts';
import type { ArenaRules } from '../content.ts';
import type { ArenaEvent, ArenaStorm } from './state.ts';

/**
 * The storm eats the island's edge: a warning, then a shrink, every `everyTicks` from
 * `firstTicks`. The first `bigSteps` shrinks each take `bigStepPercent` of the starting radius,
 * the rest `smallStepPercent`, down to `floorPercent`. The radius never grows.
 */

/** The island's radius in 1/256 arena units once `step` shrinks have finished. */
export function stormRadius(step: number, rules: ArenaRules): number {
  const { bigSteps, bigStepPercent, smallStepPercent, floorPercent } = rules.storm;
  const taken = Math.min(step, bigSteps) * bigStepPercent + Math.max(0, step - bigSteps) * smallStepPercent;
  return percentOf(toSubunits(rules.island.radius), Math.max(floorPercent, 100 - taken));
}

/** The storm before any shrink: calm, or already at its floor when the floor is the whole island. */
export function stormAtStart(rules: ArenaRules): ArenaStorm {
  const atFloor = stormRadius(1, rules) >= stormRadius(0, rules);
  return { step: 0, phase: atFloor ? 'floor' : 'calm', nextShrink: atFloor ? null : rules.storm.firstTicks };
}

export type StormStep = { readonly radius: number; readonly storm: ArenaStorm };

/** The storm at `tick`, given the radius and storm of the tick before; pushes its events. */
export function stepStorm(tick: number, radius: number, storm: ArenaStorm, rules: ArenaRules, events: ArenaEvent[]): StormStep {
  const start = storm.nextShrink;
  if (start === null) return { radius, storm };
  const { warnTicks, shrinkTicks, everyTicks } = rules.storm;
  const step = storm.step + 1;
  if (tick < start - warnTicks) return { radius, storm };
  if (tick < start) {
    if (tick === start - warnTicks) events.push({ kind: 'stormWarning', step, radius: stormRadius(step, rules) });
    return { radius, storm: storm.phase === 'warning' ? storm : { ...storm, phase: 'warning' } };
  }
  const from = stormRadius(step - 1, rules);
  const to = stormRadius(step, rules);
  const progress = Math.min(shrinkTicks, tick - start);
  if (progress < shrinkTicks) {
    return { radius: from + div((to - from) * progress, shrinkTicks), storm: storm.phase === 'shrinking' ? storm : { ...storm, phase: 'shrinking' } };
  }
  events.push({ kind: 'stormShrank', step, radius: to });
  const atFloor = stormRadius(step + 1, rules) >= to;
  return { radius: to, storm: { step, phase: atFloor ? 'floor' : 'calm', nextShrink: atFloor ? null : start + everyTicks } };
}
