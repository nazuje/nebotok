import { mapFromRows } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { joystickDirection } from '../src/input.ts';
import { MIN_GAP_MS, WALK_TO_GAP_MS, createOutbox } from '../src/outbox.ts';
import { SETTLE_MS, advance, applyCommand, canReach, drawnAt, reconcile, startPrediction, type Command, type Prediction } from '../src/self-walker.ts';

const STEP = 200;
const MAP = mapFromRows('test', ['.......', '.......', '...#...', '.......']);
const at = (x: number, y: number, moving = false) => ({ x, y, facing: 'down' as const, moving });

function walked(prediction: Prediction, ms: number): Prediction {
  let next = prediction;
  for (let left = ms; left > 0; left -= 16.7) next = advance(next, MAP, Math.min(16.7, left), STEP);
  return next;
}

describe('predicting your own courier', () => {
  it('starts walking the moment a walk is asked for, along the same path the server plans', () => {
    const start = applyCommand(startPrediction(at(0, 0)), MAP, { kind: 'to', target: { x: 3, y: 0 } });
    expect(start).not.toBeNull();
    const after = walked(start as Prediction, STEP / 2);
    expect(after.walker).toMatchObject({ x: 1, y: 0, moving: true });
    expect(drawnAt(after, STEP).x).toBeCloseTo(0.5, 1);
    expect(walked(start as Prediction, STEP * 3 + 1).walker).toMatchObject({ x: 3, y: 0, moving: false });
  });

  it('keeps fractions of a millisecond so frame times add up exactly', () => {
    const start = applyCommand(startPrediction(at(0, 0)), MAP, { kind: 'hold', direction: 'right' }) as Prediction;
    let next = start;
    for (let frame = 0; frame < 3; frame += 1) next = advance(next, MAP, 1_000 / 60, STEP);
    expect(next.walker.elapsedMs + next.carryMs).toBeCloseTo(50, 5);
  });

  it('refuses a walk to a blocked tile, as the server would', () => {
    const start = startPrediction(at(0, 0));
    expect(applyCommand(start, MAP, { kind: 'to', target: { x: 3, y: 2 } })).toBeNull();
    expect(canReach(start, MAP, { x: 3, y: 2 })).toBe(false);
    expect(canReach(start, MAP, { x: 6, y: 3 })).toBe(true);
  });

  it('lets the server lag while either is moving', () => {
    const moving = walked(applyCommand(startPrediction(at(0, 0)), MAP, { kind: 'hold', direction: 'right' }) as Prediction, 300);
    expect(reconcile(moving, MAP, at(1, 0, true), 1_000)).toBe(moving);
  });

  it('walks back a tile once both have stood apart for a moment', () => {
    // A hold released at a step boundary: the page started one more step than the server.
    const ahead = { ...startPrediction(at(2, 0)), walker: { ...startPrediction(at(2, 0)).walker, facing: 'right' as const } };
    const server = { x: 1, y: 0, facing: 'right' as const, moving: false };
    const noted = reconcile(ahead, MAP, server, 1_000);
    expect(noted.walker).toBe(ahead.walker);
    expect(reconcile(noted, MAP, server, 1_000 + SETTLE_MS - 1).walker).toBe(ahead.walker);
    const back = reconcile(noted, MAP, server, 1_000 + SETTLE_MS);
    expect(back.walker.intent).toEqual({ kind: 'path', steps: [{ x: 1, y: 0 }] });
  });

  it('turns to the server’s facing when only that differs', () => {
    const here = startPrediction(at(2, 0));
    const server = { x: 2, y: 0, facing: 'left' as const, moving: false };
    const later = reconcile(reconcile(here, MAP, server, 0), MAP, server, SETTLE_MS);
    expect(later.walker).toMatchObject({ x: 2, y: 0, facing: 'left' });
  });

  it('jumps to the server when far apart and carries the walk on from there', () => {
    const walking = applyCommand(startPrediction(at(0, 0)), MAP, { kind: 'to', target: { x: 6, y: 3 } }) as Prediction;
    const fixed = reconcile(walking, MAP, at(5, 0, true), 0);
    expect(fixed.walker).toMatchObject({ x: 5, y: 0 });
    expect(fixed.walker.intent.kind === 'path' && fixed.walker.intent.steps.at(-1)).toEqual({ x: 6, y: 3 });
  });
});

function harness() {
  let clock = 0;
  const sent: { at: number; command: Command }[] = [];
  const timers: { at: number; run: () => void }[] = [];
  const outbox = createOutbox({
    deliver: (command) => sent.push({ at: clock, command }),
    now: () => clock,
    later: (run, ms) => {
      const timer = { at: clock + ms, run };
      timers.push(timer);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
  });
  const wait = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const next = timers.toSorted((a, b) => a.at - b.at)[0];
      if (!next || next.at > until) break;
      timers.splice(timers.indexOf(next), 1);
      clock = next.at;
      next.run();
    }
    clock = until;
  };
  return { outbox, sent, wait };
}

describe('the outbox', () => {
  it('sends the first command at once and drops repeats', () => {
    const { outbox, sent, wait } = harness();
    outbox.send({ kind: 'hold', direction: 'up' });
    wait(500);
    outbox.send({ kind: 'hold', direction: 'up' });
    expect(sent).toEqual([{ at: 0, command: { kind: 'hold', direction: 'up' } }]);
  });

  it('keeps mashing under the server’s limits and ends on the latest command', () => {
    const { outbox, sent, wait } = harness();
    const directions = ['up', 'down', 'left', 'right'] as const;
    for (let press = 0; press < 200; press += 1) {
      outbox.send(press % 7 === 0 ? { kind: 'to', target: { x: press % 5, y: 1 } } : { kind: 'hold', direction: directions[press % 4] ?? 'up' });
      wait(5);
    }
    outbox.send({ kind: 'stop' });
    wait(1_000);
    for (let index = 1; index < sent.length; index += 1) expect((sent[index]?.at ?? 0) - (sent[index - 1]?.at ?? 0)).toBeGreaterThanOrEqual(MIN_GAP_MS);
    const walkTos = sent.filter(({ command }) => command.kind === 'to');
    for (let index = 1; index < walkTos.length; index += 1) expect((walkTos[index]?.at ?? 0) - (walkTos[index - 1]?.at ?? 0)).toBeGreaterThanOrEqual(WALK_TO_GAP_MS);
    expect(sent.length).toBeLessThanOrEqual(Math.ceil(2_000 / MIN_GAP_MS));
    expect(sent.at(-1)?.command).toEqual({ kind: 'stop' });
  });

  it('cancels what waits when asked again for what was already sent', () => {
    const { outbox, sent, wait } = harness();
    outbox.send({ kind: 'hold', direction: 'left' });
    outbox.send({ kind: 'stop' });
    outbox.send({ kind: 'hold', direction: 'left' });
    wait(500);
    expect(sent.map(({ command }) => command.kind)).toEqual(['hold']);
  });

  it('forgets everything on reset', () => {
    const { outbox, sent, wait } = harness();
    outbox.send({ kind: 'stop' });
    outbox.send({ kind: 'hold', direction: 'up' });
    outbox.reset();
    wait(500);
    outbox.send({ kind: 'stop' });
    expect(sent.map(({ command }) => command.kind)).toEqual(['stop', 'stop']);
  });
});

describe('the joystick', () => {
  it('picks a direction by the longer axis outside the dead zone', () => {
    expect(joystickDirection(5, 5)).toBeNull();
    expect(joystickDirection(30, 10)).toBe('right');
    expect(joystickDirection(-30, 10)).toBe('left');
    expect(joystickDirection(10, -30)).toBe('up');
    expect(joystickDirection(-10, 30)).toBe('down');
  });
});
