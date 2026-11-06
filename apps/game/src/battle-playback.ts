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

/**
 * Every line stays up long enough to read: LINE_MIN_MS, plus LINE_MS_PER_CHARACTER for each
 * character of it in the player's language, up to LINE_MAX_MS. A tap moves on sooner.
 */
export const LINE_MIN_MS = 1_200;
export const LINE_MS_PER_CHARACTER = 40;
export const LINE_MAX_MS = 3_000;
/** Under one line, each effect plays this long before the next one starts, so a hit follows its attack. */
export const EFFECT_LEAD_MS = 450;

/** A tap this soon after a turn starts playing is the end of the tap that chose it, so it does not move the lines on. */
export const TAP_GRACE_MS = 300;
/** A second tap this soon after one that moved to the next line jumps to the end of the turn. */
export const QUICK_TAP_MS = 500;

/** How long a line of `characters` stays on screen. */
export const readingMs = (characters: number): number => Math.min(LINE_MAX_MS, LINE_MIN_MS + LINE_MS_PER_CHARACTER * Math.max(0, characters));

/** How many characters a line has in the words the player sees. */
export type LineCharacters = (line: Line) => number;

/** Lines that ask for a choice stay up with the menu after the playback, so the playback need not hold them. */
const PROMPTS: ReadonlySet<BattleEvent['kind']> = new Set(['mustSwap', 'canBefriend']);

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
      return { id: 'battle.treatOrDone' };
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

type Untimed = Omit<Step, 'ms'>;

/**
 * How long each step holds the screen. A line and the steps after it up to the next line are one
 * group: together they hold the line's reading time, each effect but the last starting
 * EFFECT_LEAD_MS after the one before. Steps with neither a line nor an effect take no time.
 */
function holds(steps: readonly Untimed[], length: LineCharacters): number[] {
  const ms: number[] = steps.map((step) => (step.effect ? EFFECT_LEAD_MS : 0));
  let group: number[] = [];
  const close = () => {
    const [first] = group;
    const head = first === undefined ? undefined : steps[first];
    if (first !== undefined && head?.line) {
      const reading = PROMPTS.has(head.event.kind) ? 0 : readingMs(length(head.line));
      const timed = group.filter((at) => at === first || steps[at]?.effect);
      const last = timed.length - 1;
      ms[first] = 0;
      if (reading > 0) {
        for (const [index, at] of timed.entries()) ms[at] = index < last ? EFFECT_LEAD_MS : Math.max(EFFECT_LEAD_MS, reading - EFFECT_LEAD_MS * last);
      }
    }
    group = [];
  };
  steps.forEach((step, at) => {
    if (step.line) close();
    if (step.line || group.length > 0) group.push(at);
  });
  close();
  return ms;
}

/**
 * The steps that animate `events`, in order, starting from what `before` showed: the battle
 * view before this update, or null when there was none (then nobody is out yet). Each line holds
 * the screen for its reading time (`length` counts its characters), with the effects under it.
 * Leaving a wild creature that has fainted is no run: the battle ends as a win, with no line.
 */
export function playback(before: BattleView | null, after: BattleView, events: readonly BattleEvent[], length: LineCharacters): Step[] {
  let shown: Shown = before && before.id === after.id ? shownOf(before) : { ...shownOf(after), active: [null, null], weather: null };
  const won = after.outcome !== null && after.outcome.reason !== 'ran';
  const steps = events.map((event): Untimed => {
    shown = apply(shown, event);
    const leftBeaten = event.kind === 'ran' && won;
    return { event, shown, line: leftBeaten ? null : lineOf(event), effect: leftBeaten ? null : effectOf(event) };
  });
  const ms = holds(steps, length);
  return steps.map((step, at) => Object.assign(step, { ms: ms[at] ?? 0 }));
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

/** Where the next line after the one on screen `elapsed` ms in starts, in ms from the start, or null when this is the last. */
export function nextLineAt(steps: readonly Step[], elapsed: number): number | null {
  const current = stepAt(steps, elapsed);
  if (current === null) return null;
  let at = 0;
  for (const [index, step] of steps.entries()) {
    if (index > current && step.line && step.ms > 0) return at;
    at += step.ms;
  }
  return null;
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
