import { z } from 'zod';

/** How touch and mouse move your courier: tap a tile, or a joystick under the left thumb. */
export const CONTROLS = ['tap', 'joystick'] as const;
export type Controls = (typeof CONTROLS)[number];

const STORAGE_KEY = 'nebotok:controls';
const Stored = z.enum(CONTROLS);

export function initialControls(): Controls {
  try {
    const parsed = Stored.safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : 'tap';
  } catch {
    return 'tap';
  }
}

export function saveControls(controls: Controls): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(controls));
  } catch {
    // Private browsing can refuse storage; the choice then lasts until the page closes.
  }
}

export const otherControls = (controls: Controls): Controls => (controls === 'tap' ? 'joystick' : 'tap');
