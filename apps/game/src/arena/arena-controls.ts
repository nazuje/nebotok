import { DUEL_GIVE_UP_MS, type Language, type PictureId, type StringId } from '@nebotok/core';
import { el } from '../dom.ts';
import { digits } from '../loadout-picker.ts';
import { abilityIcon, pictureIcon } from '../pictures.ts';
import { text } from '../strings.ts';
import { buttonLabel, type ButtonState } from './arena-buttons.ts';
import { ARENA_ACTIONS, PAD_RADIUS, createLatch, stickDirection, type ArenaAction, type Pressed } from './arena-input.ts';

/**
 * The fight's touch and keyboard controls (docs/arena.md, "Screens and controls"). A floating stick
 * appears wherever a thumb lands on the left half; the right side holds buttons 1 to 3, Dash, and
 * Treat and Swap while they can be used, each with a cooldown ring; Leave sits in a top corner and
 * is held for `LEAVE_HOLD_MS`, or in a duel Give up, held for `DUEL_GIVE_UP_MS`. Keys: WASD or arrows, 1, 2, 3, Space, E and Q. Ported from the
 * battle-feel prototype's controls. They only collect input; the link sends it.
 */

export const LEAVE_HOLD_MS = 1_000;

const KEY_STEER: Readonly<Record<string, readonly [number, number]>> = {
  w: [0, -1],
  a: [-1, 0],
  s: [0, 1],
  d: [1, 0],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowRight: [1, 0],
};
const KEY_ACTION: Readonly<Record<string, ArenaAction>> = { '1': 0, '2': 1, '3': 2, ' ': 'dash', e: 'treat', q: 'swap' };
const keyOf = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

const ACTION_PICTURES = { dash: 'dash', treat: 'treat', swap: 'swap' } as const;

/** The corner button's two jobs: leave a wild fight, or give a duel up. Both send `leave` once held. */
export type Quit = 'leave' | 'giveUp';
const QUITS: Readonly<Record<Quit, { readonly picture: PictureId; readonly label: StringId; readonly holdMs: number }>> = {
  leave: { picture: 'leave', label: 'arena.leave', holdMs: LEAVE_HOLD_MS },
  giveUp: { picture: 'flag', label: 'arena.giveUp', holdMs: DUEL_GIVE_UP_MS },
};

export type ArenaControlsOptions = {
  /** Whether the fight takes input now; keys and the stick do nothing otherwise. */
  active(): boolean;
};

export type ArenaControls = {
  /** The wire direction the stick or the keys point now, or null. */
  direction(): number | null;
  /** The buttons for the next send. */
  take(): Pressed;
  /** Whether Leave or Give up has been held long enough: then every send asks to leave. */
  leaving(): boolean;
  /** Shows the buttons as they are now and runs the corner button's hold, hidden for `quit` null. */
  render(buttons: readonly ButtonState[], language: Language, now: number, quit: Quit | null): void;
  /** Lets go of every key, button and the stick, and forgets a Leave held. */
  reset(): void;
  /** Whether a thumb is on the stick. */
  holding(): boolean;
};

/** Keeps a pointer's moves and its end coming to `target` even off it. Made-up pointers (tests) cannot be captured. */
function capture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Only pointers the browser knows can be captured; the controls work without it.
  }
}

type Pad = { vector(): { x: number; y: number } | null; holding(): boolean; rest(): void };

/** The floating stick: a ring and a knob, shown faintly at rest where a thumb usually goes. */
function createPad(zone: HTMLElement, active: () => boolean): Pad {
  const knob = el('span', { className: 'arena-knob' });
  const base = el('span', { className: 'arena-pad', attrs: { 'aria-hidden': 'true' } }, [knob]);
  zone.append(base);
  let pointer: number | null = null;
  let origin = { x: 0, y: 0 };
  let push: { x: number; y: number } | null = null;
  const rest = () => {
    pointer = null;
    push = null;
    base.classList.remove('held');
    base.style.removeProperty('left');
    base.style.removeProperty('top');
    knob.style.translate = '';
  };
  const steerTo = (event: PointerEvent) => {
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const shown = Math.min(1, PAD_RADIUS / Math.max(1, Math.hypot(dx, dy)));
    knob.style.translate = `${dx * shown}px ${dy * shown}px`;
    push = { x: dx, y: dy };
  };
  zone.addEventListener('pointerdown', (event) => {
    if (pointer !== null || !active()) return;
    event.preventDefault();
    capture(zone, event.pointerId);
    pointer = event.pointerId;
    const box = zone.getBoundingClientRect();
    origin = { x: Math.max(box.left + PAD_RADIUS, Math.min(box.right - PAD_RADIUS, event.clientX)), y: Math.max(box.top + PAD_RADIUS, Math.min(box.bottom - PAD_RADIUS, event.clientY)) };
    base.classList.add('held');
    base.style.left = `${origin.x - box.left}px`;
    base.style.top = `${origin.y - box.top}px`;
    steerTo(event);
  });
  zone.addEventListener('pointermove', (event) => {
    if (event.pointerId === pointer) steerTo(event);
  });
  for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    zone.addEventListener(ending, (event) => {
      if (event.pointerId === pointer) rest();
    });
  }
  zone.addEventListener('contextmenu', (event) => event.preventDefault());
  return { vector: () => push, holding: () => pointer !== null, rest };
}

type Button = { readonly element: HTMLButtonElement; readonly ring: HTMLElement; key: string };

function makeButton(action: ArenaAction, latch: ReturnType<typeof createLatch>, active: () => boolean): Button {
  const ring = el('span', { className: 'arena-cooldown', attrs: { 'aria-hidden': 'true' } });
  const kind = typeof action === 'number' ? `ability ability-${action + 1}` : action;
  const element = el('button', { className: `arena-button ${kind}`, attrs: { type: 'button', 'data-action': String(action) } }, [ring]);
  element.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (!active()) return;
    capture(element, event.pointerId);
    latch.down(action);
  });
  for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) element.addEventListener(ending, () => latch.up(action));
  element.addEventListener('contextmenu', (event) => event.preventDefault());
  // A tap from the keyboard or a screen reader has no pointer: it presses once.
  element.addEventListener('click', (event) => {
    if (event.detail !== 0 || !active()) return;
    latch.down(action);
    latch.up(action);
  });
  return { element, ring, key: '' };
}

/** The pictures on a button: its move, the lock with its level, or Dash, Treat or Swap. */
function picturesOf(button: ButtonState): Element[] {
  if (button.action === 'dash' || button.action === 'treat' || button.action === 'swap') return [pictureIcon(ACTION_PICTURES[button.action], 32)];
  if (button.locked) return [pictureIcon('lock', 48, { className: 'arena-lock' }), digits(button.unlock ?? 0, 32)];
  return [button.move === null ? el('span', { className: 'arena-empty' }) : abilityIcon(button.move, button.action === 0 ? 48 : 40)];
}

/** Builds the stick in `zone`, the buttons in `cluster` and Leave as `leave`. */
export function createArenaControls(parts: { zone: HTMLElement; cluster: HTMLElement; leave: HTMLButtonElement }, options: ArenaControlsOptions): ArenaControls {
  const latch = createLatch();
  const pad = createPad(parts.zone, options.active);
  const keys = new Set<string>();
  const buttons = new Map<ArenaAction, Button>(ARENA_ACTIONS.map((action) => [action, makeButton(action, latch, options.active)]));
  parts.cluster.append(...[...buttons.values()].map((button) => button.element));
  let quitShown: Quit | null = null;
  let leaveFrom: number | null = null;
  let leaving = false;

  const letGo = () => {
    keys.clear();
    latch.release();
    pad.rest();
    leaveFrom = null;
  };
  parts.leave.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (!options.active()) return;
    capture(parts.leave, event.pointerId);
    leaveFrom = performance.now();
  });
  for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    parts.leave.addEventListener(ending, () => {
      leaveFrom = null;
    });
  }
  parts.leave.addEventListener('contextmenu', (event) => event.preventDefault());

  window.addEventListener('keydown', (event) => {
    if (!options.active() || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = keyOf(event.key);
    const action = KEY_ACTION[key];
    if (KEY_STEER[key]) {
      event.preventDefault();
      keys.add(key);
    }
    if (action === undefined) return;
    event.preventDefault();
    if (!event.repeat) latch.down(action);
  });
  window.addEventListener('keyup', (event) => {
    const key = keyOf(event.key);
    keys.delete(key);
    const action = KEY_ACTION[key];
    if (action !== undefined) latch.up(action);
  });
  window.addEventListener('blur', letGo);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) letGo();
  });

  return {
    direction: () => {
      if (!options.active()) return null;
      let x = 0;
      let y = 0;
      for (const key of keys) {
        x += KEY_STEER[key]?.[0] ?? 0;
        y += KEY_STEER[key]?.[1] ?? 0;
      }
      if (x !== 0 || y !== 0) return stickDirection(x, y);
      const push = pad.vector();
      return push ? stickDirection(push.x, push.y, PAD_RADIUS) : null;
    },
    take: () => latch.take(),
    leaving: () => leaving,
    render: (states, language, now, quit) => {
      for (const state of states) {
        const shown = buttons.get(state.action);
        if (!shown) continue;
        const { element, ring } = shown;
        element.hidden = !state.shown;
        element.disabled = state.locked || (typeof state.action === 'number' && state.move === null);
        element.classList.toggle('locked', state.locked);
        element.classList.toggle('cooling', state.ring > 0);
        element.style.setProperty('--cd', state.ring.toFixed(3));
        const key = JSON.stringify([language, state.move, state.locked, state.unlock]);
        if (key === shown.key) continue;
        shown.key = key;
        element.setAttribute('aria-label', buttonLabel(state, language));
        element.replaceChildren(...picturesOf(state), ring);
      }
      parts.leave.hidden = quit === null;
      if (quit === null) return;
      const look = QUITS[quit];
      if (quitShown !== quit) {
        quitShown = quit;
        parts.leave.dataset.quit = quit;
        parts.leave.replaceChildren(pictureIcon(look.picture, 32));
      }
      parts.leave.setAttribute('aria-label', text(look.label, language));
      const held = leaveFrom === null ? 0 : Math.min(1, (now - leaveFrom) / look.holdMs);
      if (held >= 1) leaving = true;
      parts.leave.style.setProperty('--hold', (leaving ? 1 : held).toFixed(3));
    },
    reset: () => {
      letGo();
      leaving = false;
    },
    holding: () => pad.holding(),
  };
}
