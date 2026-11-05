import { describe, expect, it } from 'vitest';
import { CATCH_UP_STEPS, IDLE, createWalker, mapFromRows, planCommand, planWalk, positionOf, stepDurationMs, stepWalker, upcomingSteps, withIntent } from '../../src/index.ts';

const map = mapFromRows('room', ['....#', '.....', '##...']);
const STEP = 200;

describe('walking', () => {
  it('turns a speed into a step length', () => {
    expect(stepDurationMs(5)).toBe(200);
    expect(stepDurationMs(3)).toBe(333);
    expect(() => stepDurationMs(0)).toThrow(RangeError);
    expect(() => stepDurationMs(2.5)).toThrow(RangeError);
  });

  it('claims the next tile at once and finishes the step after stepMs', () => {
    const start = withIntent(createWalker({ x: 0, y: 0 }), { kind: 'hold', direction: 'right' });
    const started = stepWalker(map, start, 0, STEP);
    expect(started).toMatchObject({ x: 1, y: 0, facing: 'right', moving: true, elapsedMs: 0 });
    expect(stepWalker(map, started, 150, STEP)).toMatchObject({ x: 1, moving: true, elapsedMs: 150 });
  });

  it('holds a direction until a wall, then stands facing it', () => {
    const start = withIntent(createWalker({ x: 0, y: 0 }), { kind: 'hold', direction: 'right' });
    const after = stepWalker(map, start, 10 * STEP, STEP);
    expect(after).toMatchObject({ x: 3, y: 0, facing: 'right', moving: false, elapsedMs: 0 });
    expect(after.intent).toEqual({ kind: 'hold', direction: 'right' });
  });

  it('turns to face a wall it cannot step into', () => {
    const facingWall = stepWalker(map, withIntent(createWalker({ x: 0, y: 1 }), { kind: 'hold', direction: 'down' }), 0, STEP);
    expect(facingWall).toMatchObject({ x: 0, y: 1, facing: 'down', moving: false });
  });

  it('follows a planned path and then stands still', () => {
    const walker = createWalker({ x: 0, y: 0 });
    const intent = planWalk(map, walker, { x: 4, y: 2 });
    expect(intent?.kind).toBe('path');
    const done = stepWalker(map, withIntent(walker, intent!), 6 * STEP, STEP);
    expect(done).toMatchObject({ x: 4, y: 2, moving: false, intent: IDLE });
    expect(positionOf(done)).toEqual({ x: 4, y: 2, facing: 'right' });
  });

  it('refuses a walk to a blocked tile and plans nothing when already there', () => {
    const walker = createWalker({ x: 0, y: 0 });
    expect(planWalk(map, walker, { x: 4, y: 0 })).toBeNull();
    expect(planWalk(map, walker, { x: 0, y: 0 })).toEqual(IDLE);
  });

  it('finishes the step in progress when the intent changes or stops', () => {
    const moving = stepWalker(map, withIntent(createWalker({ x: 0, y: 1 }), { kind: 'hold', direction: 'right' }), 100, STEP);
    expect(moving).toMatchObject({ x: 1, moving: true, elapsedMs: 100 });
    const stopped = stepWalker(map, withIntent(moving, IDLE), 100, STEP);
    expect(stopped).toMatchObject({ x: 1, y: 1, moving: false });
    const turned = stepWalker(map, withIntent(moving, { kind: 'hold', direction: 'up' }), 100, STEP);
    expect(turned).toMatchObject({ x: 1, y: 0, facing: 'up', moving: true, elapsedMs: 0 });
  });

  it('drops a path that has become blocked', () => {
    const walker = withIntent(createWalker({ x: 1, y: 1 }), { kind: 'path', steps: [{ x: 1, y: 2 }] });
    expect(stepWalker(map, walker, STEP, STEP)).toMatchObject({ x: 1, y: 1, moving: false, intent: IDLE });
  });

  it('refuses bad time steps', () => {
    const walker = createWalker({ x: 0, y: 0 });
    expect(() => stepWalker(map, walker, -1, STEP)).toThrow(RangeError);
    expect(() => stepWalker(map, walker, 1.5, STEP)).toThrow(RangeError);
    expect(() => stepWalker(map, walker, 10, 0)).toThrow(RangeError);
  });
});

const open = mapFromRows('open', ['......', '......', '......', '......']);
const walking = (steps: { x: number; y: number }[], at = { x: 0, y: 0 }) => withIntent(createWalker(at), { kind: 'path', steps });

describe('a command planned from another tile', () => {
  it('plans from the walker itself when told nothing, or told its own tile', () => {
    const walker = createWalker({ x: 0, y: 0 });
    const target = { x: 3, y: 2 };
    expect(planCommand(open, walker, { kind: 'to', target })).toEqual(planWalk(open, walker, target));
    expect(planCommand(open, walker, { kind: 'to', target }, { x: 0, y: 0 })).toEqual(planWalk(open, walker, target));
  });

  it('carries on along its own walk to the tile the command was planned from, then follows that plan', () => {
    const walker = walking([{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]);
    const fromAhead = planWalk(open, createWalker({ x: 2, y: 0 }), { x: 2, y: 3 });
    const intent = planCommand(open, walker, { kind: 'to', target: { x: 2, y: 3 } }, { x: 2, y: 0 });
    expect(intent).toEqual({ kind: 'path', steps: [{ x: 1, y: 0 }, { x: 2, y: 0 }, ...(fromAhead?.kind === 'path' ? fromAhead.steps : [])] });
  });

  it('joins the planned route when it has already stepped onto it', () => {
    const walker = createWalker({ x: 1, y: 0 });
    const planned = planWalk(open, createWalker({ x: 0, y: 0 }), { x: 4, y: 0 });
    expect(planCommand(open, walker, { kind: 'to', target: { x: 4, y: 0 } }, { x: 0, y: 0 })).toEqual({ kind: 'path', steps: planned?.kind === 'path' ? planned.steps.slice(1) : [] });
  });

  it('ignores a tile it is not about to reach and plans from where it stands', () => {
    const walker = walking([{ x: 1, y: 0 }]);
    expect(planCommand(open, walker, { kind: 'to', target: { x: 5, y: 3 } }, { x: 4, y: 3 })).toEqual(planWalk(open, walker, { x: 5, y: 3 }));
    expect(planCommand(open, walker, { kind: 'stop' }, { x: 4, y: 3 })).toEqual(IDLE);
    expect(planCommand(open, walker, { kind: 'hold', direction: 'down' }, { x: 4, y: 3 })).toEqual({ kind: 'hold', direction: 'down' });
  });

  it('stops or turns on the tile the command was planned from', () => {
    const holding = withIntent(createWalker({ x: 0, y: 0 }), { kind: 'hold', direction: 'right' });
    expect(planCommand(open, holding, { kind: 'stop' }, { x: 2, y: 0 })).toEqual({ kind: 'path', steps: [{ x: 1, y: 0 }, { x: 2, y: 0 }] });
    const turn = planCommand(open, holding, { kind: 'hold', direction: 'down' }, { x: 1, y: 0 });
    expect(turn).toEqual({ kind: 'path', steps: [{ x: 1, y: 0 }], thenHold: 'down' });
    const after = stepWalker(open, withIntent(holding, turn!), 3 * STEP - 1, STEP);
    expect(after).toMatchObject({ x: 1, y: 2, facing: 'down', intent: { kind: 'hold', direction: 'down' } });
  });

  it('plans from where it stands when the map blocks the tile the command names', () => {
    const walker = walking([{ x: 2, y: 1 }], { x: 1, y: 1 });
    const target = { x: 3, y: 2 };
    for (const from of [{ x: 4, y: 0 }, { x: 0, y: 2 }, { x: 9, y: 9 }, { x: -1, y: 1 }]) {
      expect(planCommand(map, walker, { kind: 'to', target }, from)).toEqual(planWalk(map, walker, target));
    }
  });

  it('looks no further ahead than CATCH_UP_STEPS', () => {
    const holding = withIntent(createWalker({ x: 0, y: 0 }), { kind: 'hold', direction: 'right' });
    expect(upcomingSteps(open, holding, 9)).toHaveLength(5);
    expect(planCommand(open, holding, { kind: 'stop' }, { x: CATCH_UP_STEPS + 1, y: 0 })).toEqual(IDLE);
  });
});
