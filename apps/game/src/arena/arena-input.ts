import { ARENA_NONE, DIRECTION_COUNT, type ArenaWireInput } from '@nebotok/core';

/**
 * The arena's input, as plain numbers the controls turn into what the arena room streams
 * (docs/protocol.md, "Input"): the stick's direction and the buttons pressed since the last send.
 */

/** How many ways the stick steers. The wire takes all 16 of `DIRECTION_VECTORS`; 8 keeps aiming easy for a thumb. */
export const STICK_DIRECTIONS = 8;
/** The floating stick's pad radius, in CSS pixels. */
export const PAD_RADIUS = 60;
/** A thumb nearer the pad's centre than this share of its radius steers nowhere. */
export const DEAD_ZONE = 0.3;
/** Inputs a second, the arena room's fixed step. */
export const INPUTS_PER_SECOND = 30;

/** A button of the fight: an ability button 0 to 2, dash, treat or swap. */
export type ArenaAction = 0 | 1 | 2 | 'dash' | 'treat' | 'swap';
export const ARENA_ACTIONS: readonly ArenaAction[] = [0, 1, 2, 'dash', 'treat', 'swap'];

/**
 * The wire direction (0 right, 4 down, 8 left, 12 up) closest to the push `dx`, `dy` in screen
 * pixels, kept to `directions` ways; null for no push, or one inside the dead zone of a pad of
 * `radius` (0 for keys, which have none).
 */
export function stickDirection(dx: number, dy: number, radius = 0, directions = STICK_DIRECTIONS): number | null {
  const distance = Math.hypot(dx, dy);
  if (distance === 0 || distance < radius * DEAD_ZONE) return null;
  const sector = Math.round((Math.atan2(dy, dx) / (Math.PI * 2)) * directions);
  const way = ((sector % directions) + directions) % directions;
  return (way * DIRECTION_COUNT) / directions;
}

/** What the buttons say for one send. */
export type Pressed = { readonly press: 0 | 1 | 2 | null; readonly dash: boolean; readonly treat: boolean; readonly swap: boolean };

export type Latch = {
  down(action: ArenaAction): void;
  up(action: ArenaAction): void;
  /**
   * The buttons for the next send: the first ability tapped since the last one, else one still
   * held; dash tapped or held; treat and swap tapped. A second ability tapped before a send waits
   * for the one after, so no tap is lost.
   */
  take(): Pressed;
  /** Lets go of everything, as when the page loses focus. */
  release(): void;
  /** Whether any button is held down now. */
  holding(): boolean;
};

const isAbility = (action: ArenaAction): action is 0 | 1 | 2 => typeof action === 'number';

export function createLatch(): Latch {
  let tapped: ArenaAction[] = [];
  const held = new Set<ArenaAction>();
  return {
    down: (action) => {
      if (held.has(action)) return;
      held.add(action);
      tapped.push(action);
    },
    up: (action) => {
      held.delete(action);
    },
    take: () => {
      const ability = tapped.find(isAbility);
      const heldAbility = ([0, 1, 2] as const).find((button) => held.has(button));
      const press = ability ?? heldAbility ?? null;
      const pressed = { press, dash: tapped.includes('dash') || held.has('dash'), treat: tapped.includes('treat'), swap: tapped.includes('swap') };
      const later = tapped.filter((action) => isAbility(action) && action !== ability);
      tapped = later;
      return pressed;
    },
    release: () => {
      tapped = [];
      held.clear();
    },
    holding: () => held.size > 0,
  };
}

/** One input as the arena room's input stream takes it, with none as `ARENA_NONE`. */
export function wireInput(dir: number | null, pressed: Pressed, leave: boolean): ArenaWireInput {
  return { dir: dir ?? ARENA_NONE, press: pressed.press ?? ARENA_NONE, dash: pressed.dash, treat: pressed.treat, swap: pressed.swap, leave };
}
