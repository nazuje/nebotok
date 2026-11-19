import { abilityOf, bestTreat, treatWindowPercent, type Language, type TreatStack } from '@nebotok/core';
import { CONTENT, moveName } from '../battle-content.ts';
import { moveArena } from '../move-arena.ts';
import { format, text } from '../strings.ts';
import { ARENA } from './arena-content.ts';
import type { ArenaAction } from './arena-input.ts';

/**
 * What each button of the fight shows (docs/arena.md, "Screens and controls"): its move, whether
 * its level has unlocked it, how much of its cooldown is left for the ring, and whether Treat and
 * Swap can be used at all; and the words for each, from content/strings.json.
 */

export type ButtonState = {
  readonly action: ArenaAction;
  /** The move on an ability button, or null for an empty one, Dash, Treat and Swap. */
  readonly move: string | null;
  /** Ticks of cooldown left, and of a whole cooldown. */
  readonly cooldown: number;
  readonly total: number;
  /** The share of the cooldown left, 0 to 1, which the ring shows. */
  readonly ring: number;
  /** An ability button the creature's level has not unlocked yet, and the level that does. */
  readonly locked: boolean;
  readonly unlock: number | null;
  /** Whether it is on screen: Treat and Swap only while they can be used. */
  readonly shown: boolean;
};

/** Your creature on the island, as the arena's state shows it. */
export type ButtonSources = {
  readonly level: number;
  /** Its moves on buttons 1 to 3, from your team, or null when the team does not say. */
  readonly loadout: readonly (string | null)[] | null;
  /** Ticks left on buttons 1 to 3, dash and swap. */
  readonly cooldowns: readonly number[];
  readonly treat: boolean;
  readonly swap: boolean;
};

/** Ticks of a whole cooldown of the move `move`, from its arena block or its kind. */
function moveCooldown(move: string | null): number {
  return move !== null && moveArena(move) !== null ? abilityOf(move, ARENA).cooldownTicks : 0;
}

const ring = (left: number, total: number): number => (total > 0 && left > 0 ? Math.min(1, left / total) : 0);

function state(action: ArenaAction, move: string | null, cooldown: number, total: number, extra: Partial<ButtonState> = {}): ButtonState {
  return { action, move, cooldown, total, ring: ring(cooldown, total), locked: false, unlock: null, shown: true, ...extra };
}

/** Every button's state, ability buttons first, then Dash, Treat and Swap. */
export function buttonStates({ level, loadout, cooldowns, treat, swap }: ButtonSources): ButtonState[] {
  const abilities = ([0, 1, 2] as const).map((button) => {
    const unlock = ARENA.arena.buttons[button];
    const locked = level < unlock;
    const move = locked ? null : (loadout?.[button] ?? null);
    return state(button, move, cooldowns[button] ?? 0, moveCooldown(move), { locked, unlock });
  });
  return [
    ...abilities,
    state('dash', null, cooldowns[3] ?? 0, ARENA.arena.dash.cooldownTicks),
    state('treat', null, 0, 0, { shown: treat }),
    state('swap', null, cooldowns[4] ?? 0, ARENA.arena.swap.cooldownTicks, { shown: swap }),
  ];
}

/** The wild creature, for the Treat button: its species and its arena health. */
export type WildBody = { readonly species: string; readonly health: number; readonly max: number };

/** Whether the Treat button shows: the bag holds a treat whose window the wild creature's health is under, and none is out. */
export function treatUsable(wild: WildBody, bag: readonly TreatStack[], treatOut: boolean): boolean {
  const species = CONTENT.species.get(wild.species);
  const choice = species ? bestTreat(bag, species, CONTENT.items) : null;
  return !treatOut && choice !== null && wild.health > 0 && wild.health * 100 < treatWindowPercent(choice, ARENA.arena) * wild.max;
}

/** A creature's level as its badge says it, in the player's language. */
export const levelBadge = (level: number, language: Language): string => format('battle.level', language, { level });

/** What a button is called for screen readers. */
export function buttonLabel(button: ButtonState, language: Language): string {
  switch (button.action) {
    case 'dash':
      return text('arena.dash', language);
    case 'treat':
      return text('arena.treat', language);
    case 'swap':
      return text('arena.swap', language);
    default:
      if (button.locked) return format('arena.locked', language, { level: button.unlock ?? 0 });
      if (button.move === null) return format('arena.emptyButton', language, { button: button.action + 1 });
      return format('arena.button', language, { move: moveName(button.move, language), button: button.action + 1 });
  }
}
