import { describe, expect, it } from 'vitest';
import { IDLE, createWalker, mapFromRows, planWalk, positionOf, stepDurationMs, stepWalker, withIntent } from '../../src/index.ts';

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
