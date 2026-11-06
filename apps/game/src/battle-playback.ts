import type { BattleEvent, BattleView, StringId } from '@nebotok/core';

/** What the battle field shows at one moment of a playback: each creature's health, who is out, and the weather. */
export type Shown = {
  readonly hp: Readonly<Record<string, number>>;
  /** The creature each side has out, by battle id (`a1`, `b1`), or null before it is sent out. */
  readonly active: readonly [string | null, string | null];
  readonly weather: string | null;
};

/** A short line under the field. Creatures are named by battle id, species by species id. */
export type Line = {
  readonly id: StringId;
  readonly creature?: string;
  readonly species?: string;
  readonly move?: string;
  readonly weather?: string;
  readonly xp?: number;
  readonly level?: number;
};

/** What the field animates for one event, on the creature it names. */
export type Effect = { readonly kind: 'enter' | 'attack' | 'hit' | 'miss' | 'faint' | 'treat' | 'ran' | 'weather'; readonly creature: string | null };

export type Step = { readonly event: BattleEvent; readonly ms: number; readonly shown: Shown; readonly line: Line | null; readonly effect: Effect | null };

/** A whole turn plays in at most this long, so the next choice is never far away. */
export const TURN_BUDGET_MS = 1_400;

/** How long each kind of event holds the screen before the next, before the turn is fitted into TURN_BUDGET_MS. */
const EVENT_MS: Readonly<Record<BattleEvent['kind'], number>> = {
  turnStarted: 0,
  switched: 350,
  used: 300,
  missed: 300,
  hit: 350,
  fainted: 400,
  weatherStarted: 300,
  weatherEnded: 250,
  mustSwap: 0,
  treatOffered: 500,
  canBefriend: 300,
  ran: 300,
  ended: 0,
};

const sideOf = (id: string): 0 | 1 => (id.startsWith('a') ? 0 : 1);

export function shownOf(view: BattleView): Shown {
  const hp: Record<string, number> = {};
  for (const creature of [...view.team.creatures, ...view.opponent.creatures]) hp[creature.id] = creature.hp;
  return {
    hp,
    active: [view.team.creatures[view.team.active]?.id ?? null, view.opponent.creatures[view.opponent.active]?.id ?? null],
    weather: view.weather?.type ?? null,
  };
}

function apply(shown: Shown, event: BattleEvent): Shown {
  switch (event.kind) {
    case 'switched':
      return { ...shown, active: event.side === 0 ? [event.to, shown.active[1]] : [shown.active[0], event.to] };
    case 'hit':
      return { ...shown, hp: { ...shown.hp, [event.target]: event.hp } };
    case 'fainted':
      return { ...shown, hp: { ...shown.hp, [event.creature]: 0 } };
    case 'weatherStarted':
      return { ...shown, weather: event.weather };
    case 'weatherEnded':
      return { ...shown, weather: null };
    default:
      return shown;
  }
}

/** The line an event puts under the field, or null to keep the one before. */
export function lineOf(event: BattleEvent): Line | null {
  switch (event.kind) {
    case 'switched':
      return event.side === 0 ? { id: 'battle.go', creature: event.to } : { id: 'battle.wildAppeared', creature: event.to };
    case 'used':
      return { id: 'battle.used', creature: event.creature, move: event.move };
    case 'missed':
      return { id: 'battle.missed' };
    case 'hit':
      if (event.effectiveness === 'strong') return { id: 'battle.strong' };
      return event.effectiveness === 'weak' ? { id: 'battle.weak' } : null;
    case 'fainted':
      return { id: 'battle.fainted', creature: event.creature };
    case 'weatherStarted':
      return { id: 'battle.weather', weather: event.weather };
    case 'weatherEnded':
      return { id: 'battle.weatherEnded' };
    case 'mustSwap':
      return event.side === 0 ? { id: 'battle.chooseNext' } : null;
    case 'treatOffered':
      return { id: event.accepted ? 'battle.treatTaken' : 'battle.treatRefused', creature: event.target };
    case 'canBefriend':
      return { id: 'battle.canBefriend' };
    case 'ran':
      return { id: 'battle.ranAway' };
    default:
      return null;
  }
}

function effectOf(event: BattleEvent): Effect | null {
  switch (event.kind) {
    case 'switched':
      return { kind: 'enter', creature: event.to };
    case 'used':
      return { kind: 'attack', creature: event.creature };
    case 'hit':
      return { kind: 'hit', creature: event.target };
    case 'missed':
      return { kind: 'miss', creature: event.target };
    case 'fainted':
      return { kind: 'faint', creature: event.creature };
    case 'treatOffered':
      return { kind: 'treat', creature: event.target };
    case 'ran':
      return { kind: 'ran', creature: null };
    case 'weatherStarted':
    case 'weatherEnded':
      return { kind: 'weather', creature: null };
    default:
      return null;
  }
}

/**
 * The steps that animate `events`, in order, starting from what `before` showed: the battle
 * view before this update, or null when there was none (then nobody is out yet). Every step holds
 * its event's time, scaled down so the whole update fits in TURN_BUDGET_MS.
 */
export function playback(before: BattleView | null, after: BattleView, events: readonly BattleEvent[]): Step[] {
  let shown: Shown = before && before.id === after.id ? shownOf(before) : { ...shownOf(after), active: [null, null], weather: null };
  const total = events.reduce((sum, event) => sum + EVENT_MS[event.kind], 0);
  const scale = total > TURN_BUDGET_MS ? TURN_BUDGET_MS / total : 1;
  return events.map((event) => {
    shown = apply(shown, event);
    return { event, ms: Math.floor(EVENT_MS[event.kind] * scale), shown, line: lineOf(event), effect: effectOf(event) };
  });
}

export const playbackMs = (steps: readonly Step[]): number => steps.reduce((sum, step) => sum + step.ms, 0);

/** The step on screen `elapsed` ms into a playback, or null once it is over. A step that takes no time passes at once. */
export function stepAt(steps: readonly Step[], elapsed: number): number | null {
  if (elapsed >= playbackMs(steps)) return null;
  let at = 0;
  let current = 0;
  steps.forEach((step, index) => {
    if (at <= elapsed) current = index;
    at += step.ms;
  });
  return current;
}

/** The latest line up to step `index`. */
export function lineAt(steps: readonly Step[], index: number): Line | null {
  for (let at = index; at >= 0; at -= 1) {
    const line = steps[at]?.line;
    if (line) return line;
  }
  return null;
}

export const isPlayerCreature = (id: string): boolean => sideOf(id) === 0;
