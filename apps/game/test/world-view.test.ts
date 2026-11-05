import { describe, expect, it } from 'vitest';
import { extendTrack, sampleTrack, startTrack } from '../src/track.ts';
import { OTHERS_DELAY_MS, createWorldView, type PlayerFacts } from '../src/world-view.ts';

const STEP = 200;

describe('a player track', () => {
  it('stands still where it starts', () => {
    const track = startTrack({ x: 3, y: 4 }, 'left');
    expect(sampleTrack(track, 0, STEP)).toEqual({ x: 3, y: 4, facing: 'left', walking: false });
  });

  it('walks a step over stepMs from when it was heard', () => {
    const track = extendTrack(startTrack({ x: 3, y: 4 }, 'down'), { x: 4, y: 4 }, 'right', 1_000, STEP);
    expect(sampleTrack(track, 999, STEP)).toEqual({ x: 3, y: 4, facing: 'down', walking: false });
    expect(sampleTrack(track, 1_050, STEP)).toEqual({ x: 3.25, y: 4, facing: 'right', walking: true });
    expect(sampleTrack(track, 1_200, STEP)).toEqual({ x: 4, y: 4, facing: 'right', walking: false });
  });

  it('chains steps that arrive a little early or late into an even walk', () => {
    let track = startTrack({ x: 0, y: 0 }, 'right');
    // Heard at 0, 250, 400 and 650: the steps still start every 200 ms.
    for (const [x, at] of [[1, 0], [2, 250], [3, 400], [4, 650]] as const) track = extendTrack(track, { x, y: 0 }, 'right', at, STEP);
    expect(track.map((segment) => segment.start)).toEqual([Number.NEGATIVE_INFINITY, 0, 200, 400, 600]);
    expect(sampleTrack(track, 500, STEP)).toMatchObject({ x: 2.5, walking: true });
  });

  it('pulls a step that arrives very late to within half a step of now', () => {
    let track = extendTrack(startTrack({ x: 0, y: 0 }, 'down'), { x: 0, y: 1 }, 'down', 0, STEP);
    track = extendTrack(track, { x: 0, y: 2 }, 'down', 1_000, STEP);
    expect(track.at(-1)?.start).toBe(900);
  });

  it('jumps rather than slides to a tile that is not next door', () => {
    const track = extendTrack(startTrack({ x: 0, y: 0 }, 'down'), { x: 5, y: 5 }, 'down', 100, STEP);
    expect(sampleTrack(track, 150, STEP)).toEqual({ x: 5, y: 5, facing: 'down', walking: false });
  });

  it('turns on the spot', () => {
    const track = extendTrack(startTrack({ x: 2, y: 2 }, 'down'), { x: 2, y: 2 }, 'up', 100, STEP);
    expect(sampleTrack(track, 100, STEP)).toEqual({ x: 2, y: 2, facing: 'up', walking: false });
  });

  it('never starts a segment before the one it follows', () => {
    let track = startTrack({ x: 0, y: 0 }, 'right');
    const heard = [[1, 0], [2, 130], [3, 140], [3, 150], [4, 160], [9, 170], [10, 175]] as const;
    for (const [x, at] of heard) track = extendTrack(track, { x, y: 0 }, x === 3 && at === 150 ? 'up' : 'right', at, STEP);
    const starts = track.map((segment) => segment.start);
    expect(starts).toEqual(starts.toSorted((a, b) => a - b));
  });
});

const facts = (x: number, y: number, extra: Partial<PlayerFacts> = {}): PlayerFacts => ({
  name: 'Mia Oblak',
  avatar: 'green',
  x,
  y,
  facing: 'down',
  moving: false,
  connected: true,
  inBattle: false,
  ...extra,
});

describe('the world view', () => {
  it('draws others a little in the past and marks who is who', () => {
    const view = createWorldView();
    view.setSelf('me');
    view.update('me', facts(1, 1), 0);
    view.update('them', facts(5, 5), 0);
    view.update('them', facts(6, 5, { facing: 'right', moving: true }), 1_000);
    const [me, them] = view.shown(1_000 + OTHERS_DELAY_MS + STEP / 2);
    expect(me).toMatchObject({ id: 'me', self: true, at: { x: 1, y: 1 } });
    expect(them).toMatchObject({ id: 'them', self: false, tile: { x: 6, y: 5 }, at: { x: 5.5, y: 5 }, facing: 'right', walking: true });
  });

  it('shows an away player standing, and forgets everyone on reset', () => {
    const view = createWorldView();
    view.update('them', facts(5, 5), 0);
    view.update('them', facts(6, 5, { connected: false }), 1_000);
    expect(view.shown(1_000 + OTHERS_DELAY_MS + 50)[0]).toMatchObject({ connected: false, walking: false });
    view.remove('them');
    expect(view.shown(2_000)).toEqual([]);
    view.update('them', facts(5, 5), 0);
    view.setSelf('them');
    view.reset();
    expect(view.shown(2_000)).toEqual([]);
    expect(view.self()).toBeNull();
  });

  it('ignores a facing it does not know and a nonsense step length', () => {
    const view = createWorldView();
    view.setStepMs(0);
    expect(view.stepMs()).toBe(STEP);
    view.update('them', facts(1, 1, { facing: 'sideways' }), 0);
    expect(view.shown(0)[0]?.facing).toBe('down');
  });
});
