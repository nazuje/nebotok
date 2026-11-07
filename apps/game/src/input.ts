import { samePoint, type Direction, type Point } from '@nebotok/core';
import type { Controls } from './controls-choice.ts';
import type { Outbox } from './outbox.ts';

/** How far the thumb moves from where it landed before the joystick picks a direction, in CSS px. */
export const JOYSTICK_DEAD_ZONE = 14;
/** How far the knob can travel from the centre of the joystick, in CSS px. */
export const JOYSTICK_REACH = 44;

const KEYS: Readonly<Record<string, Direction>> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};
/** Keys that talk to the character your courier faces. */
const TALK_KEYS = new Set(['Space', 'Enter', 'NumpadEnter']);

/** The direction a thumb points from where it landed, by the longer axis, or null near the middle. */
export function joystickDirection(dx: number, dy: number, deadZone = JOYSTICK_DEAD_ZONE): Direction | null {
  if (Math.hypot(dx, dy) < deadZone) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export type InputDeps = {
  /** The element over the world that receives touches and clicks. */
  surface: HTMLElement;
  joystick: { base: HTMLElement; knob: HTMLElement };
  outbox: Outbox;
  controls(): Controls;
  /** False while a menu is open or nobody is in the world: input then does nothing. */
  active(): boolean;
  screenToTile(x: number, y: number): Point | null;
  canReach(tile: Point): boolean;
  marker(tile: Point | null, refused?: boolean): void;
  /** The character standing on `tile`, if any. */
  npcAt(tile: Point): string | null;
  /** Where to stand to talk to `npc`, or null when nowhere beside them can be reached. */
  talkSpot(npc: string): Point | null;
  /** Whether your courier stands still on `tile`, on this page and on the server. */
  standsOn(tile: Point): boolean;
  /** Asks to talk to `npc`, or to the character your courier faces when null. */
  talk(npc: string | null): void;
};

export type Input = {
  /** Runs once a frame: a finger held down keeps walking toward the tile under it. */
  frame(): void;
  /** Lets go of everything, as when the world is left. */
  release(): void;
  state(): { joystick: Direction | 'centre' | null; keys: Direction[]; talkingTo: string | null };
};

type Held = { id: number; x: number; y: number };

/**
 * Touch, mouse and keyboard. A tap walks to the tile under it, and a finger held down keeps
 * walking toward whatever tile is under it as the world scrolls. With the joystick chosen, a thumb
 * landing on the left half steers in four directions instead. Arrows and WASD always work. A tap
 * on a character walks to the nearest free tile beside them and talks on arriving; Space or Enter
 * talks to the character your courier faces. Every command goes through the outbox, so mashing
 * cannot flood the server.
 */
export function createInput(deps: InputDeps): Input {
  const { surface, joystick, outbox } = deps;
  let tap: Held | null = null;
  let tapTarget: Point | null = null;
  let stick: (Held & { originX: number; originY: number; direction: Direction | null }) | null = null;
  const keys: Direction[] = [];
  /** The character a tap is walking your courier to, and the tile it talks from. */
  let approach: { npc: string; spot: Point } | null = null;

  /** Walks to beside a character, or talks at once when already there. Never refuses: a character can always be tapped. */
  function approachNpc(npc: string) {
    const spot = deps.talkSpot(npc);
    approach = null;
    if (!spot) return;
    if (deps.standsOn(spot)) {
      deps.marker(null);
      deps.talk(npc);
      return;
    }
    approach = { npc, spot };
    deps.marker(spot);
    outbox.send({ kind: 'to', target: spot });
  }

  function walkToward(x: number, y: number, first: boolean) {
    const tile = deps.screenToTile(x, y);
    if (!tile || (tapTarget && samePoint(tile, tapTarget))) return;
    const npc = deps.npcAt(tile);
    if (npc !== null) {
      // A finger held on a character does not keep asking; one dragged off it walks on.
      tapTarget = tile;
      if (first) approachNpc(npc);
      return;
    }
    if (!deps.canReach(tile)) {
      if (first) deps.marker(tile, true);
      return;
    }
    tapTarget = tile;
    approach = null;
    deps.marker(tile);
    outbox.send({ kind: 'to', target: tile });
  }

  function steer() {
    approach = null;
    const direction = keys.at(-1) ?? stick?.direction ?? null;
    if (direction) deps.marker(null);
    outbox.send(direction ? { kind: 'hold', direction } : { kind: 'stop' });
  }

  function showStick() {
    if (!stick) {
      joystick.base.hidden = true;
      return;
    }
    const dx = stick.x - stick.originX;
    const dy = stick.y - stick.originY;
    const length = Math.hypot(dx, dy);
    const scale = length > JOYSTICK_REACH ? JOYSTICK_REACH / length : 1;
    joystick.base.hidden = false;
    joystick.base.style.transform = `translate(${stick.originX}px, ${stick.originY}px) translate(-50%, -50%)`;
    joystick.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    joystick.base.dataset.direction = stick.direction ?? 'centre';
  }

  surface.addEventListener('pointerdown', (event) => {
    if (!deps.active() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    const held = { id: event.pointerId, x: event.clientX, y: event.clientY };
    const tile = deps.screenToTile(held.x, held.y);
    // A character can be tapped with either controls, even on the joystick's half.
    const onNpc = tile !== null && deps.npcAt(tile) !== null;
    if (deps.controls() === 'joystick' && !stick && !onNpc && event.clientX < window.innerWidth / 2) {
      stick = { ...held, originX: held.x, originY: held.y, direction: null };
      showStick();
    } else if (!tap) {
      // A second finger while one is already walking is ignored, so a resting palm does nothing.
      tap = held;
      tapTarget = null;
      walkToward(held.x, held.y, true);
    } else {
      return;
    }
    surface.setPointerCapture?.(event.pointerId);
  });

  surface.addEventListener('pointermove', (event) => {
    if (tap?.id === event.pointerId) {
      tap.x = event.clientX;
      tap.y = event.clientY;
    }
    if (stick?.id === event.pointerId) {
      stick.x = event.clientX;
      stick.y = event.clientY;
      const direction = joystickDirection(stick.x - stick.originX, stick.y - stick.originY);
      if (direction !== stick.direction) {
        stick.direction = direction;
        steer();
      }
      showStick();
    }
  });

  const letGo = (event: PointerEvent) => {
    if (tap?.id === event.pointerId) tap = null;
    if (stick?.id === event.pointerId) {
      const steering = stick.direction !== null;
      stick = null;
      showStick();
      if (steering) steer();
    }
  };
  surface.addEventListener('pointerup', letGo);
  surface.addEventListener('pointercancel', letGo);
  surface.addEventListener('lostpointercapture', letGo);

  window.addEventListener('keydown', (event) => {
    if (TALK_KEYS.has(event.code) && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey && deps.active() && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault();
      deps.talk(null);
      return;
    }
    const direction = KEYS[event.code];
    if (!direction || event.altKey || event.ctrlKey || event.metaKey || !deps.active()) return;
    event.preventDefault();
    if (event.repeat || keys.includes(direction)) return;
    keys.push(direction);
    steer();
  });
  window.addEventListener('keyup', (event) => {
    const direction = KEYS[event.code];
    const at = direction ? keys.indexOf(direction) : -1;
    if (at === -1) return;
    keys.splice(at, 1);
    steer();
  });

  const release = () => {
    const steering = keys.length > 0 || stick?.direction != null;
    tap = null;
    tapTarget = null;
    approach = null;
    stick = null;
    keys.length = 0;
    showStick();
    if (steering) outbox.send({ kind: 'stop' });
  };
  // A key let go while another window has focus never reports its keyup.
  window.addEventListener('blur', release);

  return {
    frame: () => {
      if (!deps.active()) return;
      if (tap) walkToward(tap.x, tap.y, false);
      if (approach && deps.standsOn(approach.spot)) {
        const { npc } = approach;
        approach = null;
        deps.marker(null);
        deps.talk(npc);
      }
    },
    release,
    state: () => ({ joystick: stick ? (stick.direction ?? 'centre') : null, keys: [...keys], talkingTo: approach?.npc ?? null }),
  };
}
