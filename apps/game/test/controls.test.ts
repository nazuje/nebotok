import { mapFromRows } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { joystickDirection } from '../src/input.ts';
import { MIN_GAP_MS, WALK_TO_GAP_MS, createOutbox } from '../src/outbox.ts';
import { GLIDE_MS, LEAD_MS, SETTLE_MS, SNAP_TILES, advance, applyCommand, canReach, drawnAt, reconcile, startPrediction, type Command, type Prediction } from '../src/self-walker.ts';

const STEP = 200;
const MAP = mapFromRows('test', ['.......', '.......', '...#...', '.......']);
const at = (x: number, y: number, moving = false) => ({ x, y, facing: 'down' as const, moving });

function walked(prediction: Prediction, ms: number): Prediction {
  let next = prediction;
  for (let left = ms; left > 0; left -= 16.7) next = advance(next, MAP, Math.min(16.7, left), STEP);
  return next;
}

const planned = (prediction: Prediction, command: Command) => applyCommand(prediction, MAP, command, STEP)?.prediction ?? null;

describe('predicting your own courier', () => {
  it('starts walking the moment a walk is asked for, along the same path the server plans', () => {
    const start = planned(startPrediction(at(0, 0)), { kind: 'to', target: { x: 3, y: 0 } });
    expect(start).not.toBeNull();
    const after = walked(start as Prediction, STEP / 2);
    expect(after.walker).toMatchObject({ x: 1, y: 0, moving: true });
    expect(drawnAt(after, STEP, 0).x).toBeCloseTo(0.5, 1);
    expect(walked(start as Prediction, STEP * 3 + 1).walker).toMatchObject({ x: 3, y: 0, moving: false });
  });

  it('keeps fractions of a millisecond so frame times add up exactly', () => {
    const start = planned(startPrediction(at(0, 0)), { kind: 'hold', direction: 'right' }) as Prediction;
    let next = start;
    for (let frame = 0; frame < 3; frame += 1) next = advance(next, MAP, 1_000 / 60, STEP);
    expect(next.walker.elapsedMs + next.carryMs).toBeCloseTo(50, 5);
  });

  it('refuses a walk to a blocked tile, as the server would', () => {
    const start = startPrediction(at(0, 0));
    expect(applyCommand(start, MAP, { kind: 'to', target: { x: 3, y: 2 } }, STEP)).toBeNull();
    expect(canReach(start, MAP, { x: 3, y: 2 })).toBe(false);
    expect(canReach(start, MAP, { x: 6, y: 3 })).toBe(true);
  });

  it('plans a command from the tile it has claimed, or from the next one when its step is nearly over', () => {
    const walking = planned(startPrediction(at(0, 0)), { kind: 'hold', direction: 'right' }) as Prediction;
    const early = walked(walking, STEP - LEAD_MS - 20);
    expect(applyCommand(early, MAP, { kind: 'to', target: { x: 1, y: 3 } }, STEP)?.from).toEqual({ x: 1, y: 0 });
    const late = walked(walking, STEP - LEAD_MS + 20);
    const turned = applyCommand(late, MAP, { kind: 'to', target: { x: 1, y: 3 } }, STEP);
    expect(turned?.from).toEqual({ x: 2, y: 0 });
    const intent = turned?.prediction.walker.intent;
    expect(intent?.kind === 'path' && intent.steps[0]).toEqual({ x: 2, y: 0 });
  });

  it('lets the server lag while either is moving', () => {
    const moving = walked(planned(startPrediction(at(0, 0)), { kind: 'hold', direction: 'right' }) as Prediction, 300);
    expect(reconcile(moving, MAP, at(1, 0, true), STEP, 1_000)).toBe(moving);
  });

  it('lets the server lag further behind on the tiles it has just walked', () => {
    const moving = walked(planned(startPrediction(at(0, 0)), { kind: 'hold', direction: 'right' }) as Prediction, 3 * STEP + 50);
    expect(moving.walker).toMatchObject({ x: 4, y: 0 });
    expect(reconcile(moving, MAP, at(1, 0, true), STEP, 1_000)).toBe(moving);
  });

  it('walks back a tile once both have stood apart for a moment', () => {
    // A hold released at a step boundary: the page started one more step than the server.
    const ahead = { ...startPrediction(at(2, 0)), walker: { ...startPrediction(at(2, 0)).walker, facing: 'right' as const } };
    const server = { x: 1, y: 0, facing: 'right' as const, moving: false };
    const noted = reconcile(ahead, MAP, server, STEP, 1_000);
    expect(noted.walker).toBe(ahead.walker);
    expect(reconcile(noted, MAP, server, STEP, 1_000 + SETTLE_MS - 1).walker).toBe(ahead.walker);
    const back = reconcile(noted, MAP, server, STEP, 1_000 + SETTLE_MS);
    expect(back.walker.intent).toEqual({ kind: 'path', steps: [{ x: 1, y: 0 }] });
  });

  it('turns to the server’s facing when only that differs', () => {
    const here = startPrediction(at(2, 0));
    const server = { x: 2, y: 0, facing: 'left' as const, moving: false };
    const later = reconcile(reconcile(here, MAP, server, STEP, 0), MAP, server, STEP, SETTLE_MS);
    expect(later.walker).toMatchObject({ x: 2, y: 0, facing: 'left' });
  });

  it('moves over to a server on another route and carries the walk on, gliding there', () => {
    const walking = planned(startPrediction(at(0, 0)), { kind: 'to', target: { x: 6, y: 3 } }) as Prediction;
    const fixed = reconcile(walking, MAP, at(3, 0, true), STEP, 1_000);
    expect(fixed.walker).toMatchObject({ x: 3, y: 0 });
    expect(fixed.walker.intent.kind === 'path' && fixed.walker.intent.steps.at(-1)).toEqual({ x: 6, y: 3 });
    expect(drawnAt(fixed, STEP, 1_000)).toEqual({ x: 0, y: 0 });
    expect(drawnAt(fixed, STEP, 1_000 + GLIDE_MS / 2).x).toBeCloseTo(1.5, 5);
    expect(drawnAt(fixed, STEP, 1_000 + GLIDE_MS)).toEqual({ x: 3, y: 0 });
  });

  it('jumps when the server is too far away to glide to', () => {
    const here = startPrediction(at(0, 0));
    const fixed = reconcile(here, MAP, at(SNAP_TILES + 1, 0, true), STEP, 1_000);
    expect(drawnAt(fixed, STEP, 1_000)).toEqual({ x: SNAP_TILES + 1, y: 0 });
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
