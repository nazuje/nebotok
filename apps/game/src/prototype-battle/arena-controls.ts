import { el } from '../dom.ts';
import { pictureIcon } from '../pictures.ts';
import type { Action } from './arena-state.ts';

/**
 * The arena's touch and keyboard controls. A floating stick appears wherever a thumb lands on the
 * left half (30% dead zone, pointer capture, let go on blur or cancel); the right side holds the
 * ability buttons, dash, treat and swap, each with a cooldown ring. Keys: WASD or arrows move,
 * 1/2/3 abilities, Space dash, E treat, Q swap. Ideas and numbers from the sumo game's controls.
 */

export const DEAD_ZONE = 0.3;
const PAD_RADIUS = 60;

export type ArenaButton = { readonly element: HTMLButtonElement; readonly action: Action };
export type ButtonView = { readonly cooldown: number; readonly locked?: boolean; readonly hidden?: boolean };

export type ArenaControls = {
  readonly zone: HTMLElement;
  readonly cluster: HTMLElement;
  /** The steer from the stick or the keys: a unit vector, or zero. */
  steer(): { x: number; y: number };
  /** The buttons pressed since the last call, plus a held basic ability. */
  take(): Action[];
  show(views: Readonly<Partial<Record<Action, ButtonView>>>): void;
  /** Whether a thumb is on the stick, for tests. */
  holding(): boolean;
};

type ButtonSpec = { readonly action: Action; readonly label: string; readonly picture: Element; readonly size: 'big' | 'mid' | 'small' };

const KEY_STEER: Readonly<Record<string, readonly [number, number]>> = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0], ArrowUp: [0, -1], ArrowLeft: [-1, 0], ArrowDown: [0, 1], ArrowRight: [1, 0] };
const KEY_ACTION: Readonly<Record<string, Action>> = { '1': 'a0', '2': 'a1', '3': 'a2', ' ': 'dash', e: 'treat', q: 'swap' };
const keyOf = (key: string): string => (key.length === 1 ? key.toLowerCase() : key);

/** Keeps a pointer's moves and its end coming to `target` even off it. Made-up pointers (tests) cannot be captured. */
function capture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture(pointerId);
  } catch {
    // Only pointers the browser knows can be captured; the controls work without it.
  }
}

/** The floating stick: a ring and a knob, shown faintly at rest where a thumb usually goes. */
function createPad(zone: HTMLElement): { steer(): { x: number; y: number }; holding(): boolean } {
  const knob = el('span', { className: 'arena-knob' });
  const base = el('span', { className: 'arena-pad' }, [knob]);
  zone.append(base);
  let pointer: number | null = null;
  let origin = { x: 0, y: 0 };
  let vector = { x: 0, y: 0 };
  const rest = () => {
    pointer = null;
    vector = { x: 0, y: 0 };
    base.classList.remove('held');
    base.style.removeProperty('left');
    base.style.removeProperty('top');
    knob.style.translate = '';
  };
  const steerTo = (event: PointerEvent) => {
    const dx = event.clientX - origin.x;
    const dy = event.clientY - origin.y;
    const distance = Math.hypot(dx, dy);
    const shown = Math.min(1, PAD_RADIUS / Math.max(1, distance));
    knob.style.translate = `${dx * shown}px ${dy * shown}px`;
    vector = distance < PAD_RADIUS * DEAD_ZONE ? { x: 0, y: 0 } : { x: dx / distance, y: dy / distance };
  };
  zone.addEventListener('pointerdown', (event) => {
    if (pointer !== null) return;
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
  window.addEventListener('blur', rest);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rest();
  });
  return { steer: () => vector, holding: () => pointer !== null };
}

function makeButton(spec: ButtonSpec, press: (action: Action, down: boolean) => void): ArenaButton {
  const element = el('button', { className: `arena-button ${spec.size} ${spec.action}`, attrs: { type: 'button', 'aria-label': spec.label } }, [spec.picture, el('span', { className: 'arena-cd', attrs: { 'aria-hidden': 'true' } })]);
  element.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    capture(element, event.pointerId);
    press(spec.action, true);
  });
  for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) element.addEventListener(ending, () => press(spec.action, false));
  element.addEventListener('contextmenu', (event) => event.preventDefault());
  element.addEventListener('click', (event) => {
    if (event.detail === 0) press(spec.action, true);
  });
  return { element, action: spec.action };
}

/** Builds the stick zone and the button cluster. `abilities` are the three ability pictures and names. */
export function createControls(abilities: readonly { readonly label: string; readonly picture: Element }[]): ArenaControls {
  const zone = el('div', { className: 'arena-zone', attrs: { 'aria-label': 'Move', role: 'application' } });
  const pad = createPad(zone);
  const pressed: Action[] = [];
  const held = new Set<Action>();
  const keys = new Set<string>();
  const press = (action: Action, down: boolean) => {
    if (down) {
      pressed.push(action);
      held.add(action);
    } else held.delete(action);
  };
  const specs: ButtonSpec[] = [
    ...abilities.map((ability, slot): ButtonSpec => ({ action: (['a0', 'a1', 'a2'] as const)[slot] ?? 'a0', label: ability.label, picture: ability.picture, size: slot === 0 ? 'big' : 'mid' })),
    { action: 'dash', label: 'Dash', picture: pictureIcon('footprints', 32), size: 'mid' },
    { action: 'treat', label: 'Treat', picture: pictureIcon('heart', 32), size: 'mid' },
    { action: 'swap', label: 'Swap creature', picture: pictureIcon('again', 32), size: 'small' },
  ];
  const buttons = specs.map((spec) => makeButton(spec, press));
  const cluster = el(
    'div',
    { className: 'arena-cluster' },
    buttons.map((button) => button.element),
  );
  window.addEventListener('keydown', (event) => {
    const key = keyOf(event.key);
    const action = KEY_ACTION[key];
    if (KEY_STEER[key]) {
      event.preventDefault();
      keys.add(key);
    }
    if (!action) return;
    event.preventDefault();
    if (event.repeat) return;
    press(action, true);
  });
  window.addEventListener('keyup', (event) => {
    const key = keyOf(event.key);
    keys.delete(key);
    const action = KEY_ACTION[key];
    if (action) press(action, false);
  });
  window.addEventListener('blur', () => {
    keys.clear();
    held.clear();
  });
  return {
    zone,
    cluster,
    steer: () => {
      let x = 0;
      let y = 0;
      for (const key of keys) {
        x += KEY_STEER[key]?.[0] ?? 0;
        y += KEY_STEER[key]?.[1] ?? 0;
      }
      const length = Math.hypot(x, y);
      return length > 0 ? { x: x / length, y: y / length } : pad.steer();
    },
    take: () => {
      const taken = pressed.splice(0);
      if (held.has('a0') && !taken.includes('a0')) taken.push('a0');
      return taken;
    },
    show: (views) => {
      for (const button of buttons) {
        const view = views[button.action];
        button.element.hidden = view?.hidden ?? false;
        button.element.classList.toggle('locked', view?.locked ?? false);
        button.element.disabled = view?.locked ?? false;
        const cooldown = view?.cooldown ?? 0;
        button.element.style.setProperty('--cd', cooldown.toFixed(3));
        button.element.classList.toggle('cooling', cooldown > 0);
      }
    },
    holding: () => pad.holding(),
  };
}
