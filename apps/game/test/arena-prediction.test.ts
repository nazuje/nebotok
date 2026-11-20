import { ARENA_IDLE, SUBUNITS, arenaStart, arenaStep, createRng, type ArenaInput, type ArenaState, type Body } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { ARENA } from '../src/arena/arena-content.ts';
import { createFollower } from '../src/arena/arena-follow.ts';
import { leadLimit } from '../src/arena/arena-input.ts';
import { BLEND_MS, createCastEcho, createPredictor, type ShownBody, type ShownIsland } from '../src/arena/arena-predict.ts';

/**
 * Your creature predicted against a simulated arena room: the room's fixed step of 30 inputs a
 * second, each two core steps, its input buffer and acknowledgements, and a one-way delay each way.
 */

const SEND_MS = 1_000 / 30;
const FRAME_MS = 1_000 / 60;
const SPECIES = [...ARENA.species.keys()];
const fighter = (id: string, species: string, computer: boolean) => ({ id, species, level: 10, loadout: [null, null, null] as [null, null, null], turtle: false, computer });
const start = (): ArenaState => arenaStart({ seed: 'prediction', fighters: [fighter('a1', SPECIES[0] ?? '', false), fighter('b1', SPECIES[1] ?? SPECIES[0] ?? '', true)] }, ARENA);

const statusOf = (body: Body): number => (body.status.slowTicks > 0 ? 1 : 0) | (body.status.rootTicks > 0 ? 2 : 0) | (body.status.shieldTicks > 0 ? 4 : 0) | (body.knockedTicks > 0 ? 8 : 0) | (body.windup ? 16 : 0);
const shownBody = (body: Body): ShownBody => ({
  id: body.id,
  species: body.species,
  level: body.level,
  x: body.x,
  y: body.y,
  vx: body.vx,
  vy: body.vy,
  facing: body.facing,
  health: body.health,
  max: body.maxHealth,
  status: statusOf(body),
  cooldowns: [...body.cooldowns, body.dashCooldown, 0],
  turtle: body.turtle,
});
/** What apps/server/src/arena-state.ts `showFight` puts on the room's state. */
const shownOf = (island: ArenaState): ShownIsland => ({
  phase: island.outcome ? 'ended' : 'fighting',
  tick: island.tick,
  limit: ARENA.arena.island.limitTicks,
  radius: island.radius,
  storm: { step: island.storm.step, phase: island.storm.phase, next: island.storm.nextShrink ?? -1 },
  bodies: [shownBody(island.bodies[0]), shownBody(island.bodies[1])],
});

/** One of the room's fixed steps: the input on the first core step, the stick alone on the second. */
function serverStep(island: ArenaState, input: ArenaInput): ArenaState {
  const first = arenaStep(island, [input, ARENA_IDLE], ARENA).state;
  return arenaStep(first, [{ ...ARENA_IDLE, dir: input.dir }, ARENA_IDLE], ARENA).state;
}

const units = (body: Body) => ({ x: body.x / SUBUNITS, y: body.y / SUBUNITS });
const walk = (dir: number | null, dash = false): ArenaInput => ({ dir, dash, press: null });

describe('arena prediction', () => {
  it('replays the inputs the server has not acknowledged onto its state and lands where the server does', () => {
    const inputs = [walk(0), walk(2, true), walk(2), walk(4), walk(6), walk(6), walk(8)];
    const predictor = createPredictor(0, ARENA, SEND_MS);
    let server = start();
    predictor.heard(shownOf(server), 0, 0);
    inputs.forEach((input, index) => predictor.sent(index + 1, input, index * SEND_MS));
    // The server has run the first three, mid-dash.
    for (const input of inputs.slice(0, 3)) server = serverStep(server, input);
    predictor.heard(shownOf(server), 3, 100);
    for (const input of inputs.slice(3)) server = serverStep(server, input);
    const after = 10 * SEND_MS;
    expect(predictor.at(after)).toEqual(units(server.bodies[0]));
    expect(predictor.meters(0, 4, after)).toMatchObject({ samples: 1, snaps: 0, meanError: 0 });
  });

  it('blends a correction under 1.5 bodies away in 120 ms, and jumps a bigger one', () => {
    const predictor = createPredictor(0, ARENA, SEND_MS);
    const island = start();
    const shown = shownOf(island);
    predictor.heard(shown, 0, 0);
    const from = units(island.bodies[0]);
    const moved = (tick: number, dx: number): ShownIsland => ({ ...shown, tick, bodies: [{ ...shownBody(island.bodies[0]), x: island.bodies[0].x + dx * SUBUNITS }, shownBody(island.bodies[1])] });

    predictor.heard(moved(2, 20), 0, 1_000);
    expect(predictor.at(1_000)).toEqual(from);
    expect(predictor.at(1_000 + BLEND_MS / 2)?.x).toBeCloseTo(from.x + 10, 6);
    expect(predictor.at(1_000 + BLEND_MS)).toEqual({ x: from.x + 20, y: from.y });
    expect(predictor.meters(0, 0, 1_000 + BLEND_MS)).toMatchObject({ samples: 1, meanError: 20, snaps: 0, correctionsPerSecond: 1 });

    predictor.heard(moved(4, 20 + 70), 0, 2_000);
    expect(predictor.at(2_000)).toEqual({ x: from.x + 90, y: from.y });
    expect(predictor.meters(0, 0, 2_000)).toMatchObject({ samples: 2, snaps: 1 });
  });

  it('counts a correction while the server shows a knock apart from the error', () => {
    const predictor = createPredictor(0, ARENA, SEND_MS);
    const island = start();
    predictor.heard(shownOf(island), 0, 0);
    const knocked = { ...island, tick: 2, bodies: [{ ...island.bodies[0], x: island.bodies[0].x + 100 * SUBUNITS, knockedTicks: 10 }, island.bodies[1]] as const };
    predictor.heard(shownOf(knocked), 0, 10);
    expect(predictor.meters(0, 0, 10)).toMatchObject({ samples: 0, snaps: 0, knocked: 1 });
  });

  it.each([0, 50, 150])('keeps the mean error under 8 units with fewer than 2 snaps over 5 s of walking at %i ms', (rttMs) => {
    const run = simulate(rttMs, 6, `lag-${rttMs}`);
    expect(run.meters.samples).toBeGreaterThan(100);
    expect(run.meters.meanError).toBeLessThan(8);
    expect(run.meters.snaps).toBeLessThan(2);
    // Once the stick is let go and everything is acknowledged, the prediction is the server's.
    expect(run.settled).toEqual(run.server);
    // The creature answered the first input at once, not a round trip later.
    expect(run.firstMoveMs).toBeLessThanOrEqual(SEND_MS);
  });
});

type Timer = { at: number; order: number; run: () => void };

/** Five seconds of walking with turns and dashes, then a second standing, at `rttMs`, each message up to `jitterMs` late. */
function simulate(rttMs: number, jitterMs: number, seed: string) {
  const rng = createRng(seed);
  let clock = 0;
  let order = 0;
  const timers: Timer[] = [];
  const at = (when: number, run: () => void) => timers.push({ at: when, order: order++, run });
  // A WebSocket keeps order, so a message never overtakes the one sent before it.
  const link = () => {
    let last = 0;
    return (run: () => void) => {
      last = Math.max(last, clock + rttMs / 2 + rng.int(0, jitterMs));
      at(last, run);
    };
  };
  const up = link();
  const down = link();

  let server = start();
  const buffer: ArenaInput[] = [];
  let consumed = 0;
  let latest: ArenaInput = ARENA_IDLE;
  const predictor = createPredictor(0, ARENA, SEND_MS);
  let heard: { shown: ShownIsland; ack: number } = { shown: shownOf(server), ack: 0 };
  let seq = 0;
  let firstMoveMs = Number.POSITIVE_INFINITY;
  predictor.heard(heard.shown, heard.ack, 0);
  const startAt = predictor.at(0);
  const MOVE_MS = 5_000;
  const END_MS = 6_500;
  const script = (t: number): ArenaInput => {
    if (t >= MOVE_MS) return walk(null);
    const leg = Math.floor(t / 600);
    return walk((leg * 6) % 16, leg % 3 === 1 && t % 600 < SEND_MS);
  };

  const serverTick = () => {
    const input = buffer.shift();
    if (input) {
      consumed += 1;
      latest = input;
    }
    server = serverStep(server, input ?? { ...ARENA_IDLE, dir: latest.dir });
    const shown = shownOf(server);
    const ack = consumed;
    down(() => {
      heard = { shown, ack };
    });
    at(clock + SEND_MS, serverTick);
  };
  const clientSend = () => {
    const input = script(clock);
    seq += 1;
    predictor.sent(seq, input, clock);
    up(() => {
      buffer.push(input);
      if (buffer.length > 16) buffer.shift();
    });
    at(clock + SEND_MS, clientSend);
  };
  const frame = () => {
    predictor.heard(heard.shown, heard.ack, clock);
    const drawn = predictor.at(clock);
    if (drawn && startAt && firstMoveMs === Number.POSITIVE_INFINITY && (drawn.x !== startAt.x || drawn.y !== startAt.y)) firstMoveMs = clock - 7;
    at(clock + FRAME_MS, frame);
  };
  at(3, serverTick);
  at(7, clientSend);
  at(0, frame);
  while (timers.length > 0) {
    timers.sort((a, b) => a.at - b.at || a.order - b.order);
    const next = timers.shift();
    if (!next || next.at > END_MS) break;
    clock = next.at;
    next.run();
  }
  return { meters: predictor.meters(rttMs, 0, clock), settled: predictor.at(clock + BLEND_MS), server: units(server.bodies[0]), firstMoveMs };
}

describe('the other creature', () => {
  it('is drawn 100 ms in the past, between the snapshots around that moment', () => {
    const follower = createFollower(100);
    for (let tick = 0; tick <= 20; tick += 2) follower.heard('b1', tick, { x: tick * 10, y: 0 }, 1_000 + (tick * 1_000) / 60);
    // At 1000 + 20 ticks' worth, 100 ms ago is tick 14.
    expect(follower.at(1_000 + (20 * 1_000) / 60)?.x).toBeCloseTo(140, 6);
    expect(follower.at(1_000 + (15 * 1_000) / 60)?.x).toBeCloseTo(90, 6);
    // Past the newest it waits there; a new creature is drawn where it is at once.
    expect(follower.at(5_000)?.x).toBe(200);
    follower.heard('b2', 22, { x: -50, y: 7 }, 1_400);
    expect(follower.at(1_400)).toEqual({ x: -50, y: 7 });
  });

  it('keeps an even pace when patches arrive bunched', () => {
    const follower = createFollower(100);
    const late = [0, 0, 30, 0, 25, 0, 0, 40, 0, 0];
    late.forEach((delay, index) => follower.heard('b1', index * 2, { x: index * 20, y: 0 }, index * (2_000 / 60) + delay));
    const steps = Array.from({ length: 12 }, (_each, frame) => follower.at(200 + frame * FRAME_MS)?.x ?? 0);
    const moves = steps.slice(1).map((x, index) => x - (steps[index] ?? 0));
    for (const move of moves) expect(move).toBeGreaterThanOrEqual(0);
  });
});

describe('the input lead', () => {
  it('is the round trip and the wait for a patch in inputs, plus two spare, so a buffer built up in the room drains', () => {
    expect(leadLimit(0, 0)).toBe(2);
    expect(leadLimit(0, 50)).toBe(4);
    expect(leadLimit(50, 50)).toBe(5);
    expect(leadLimit(150, 50)).toBe(8);
    expect(leadLimit(300, 50)).toBe(13);
  });
});

describe('a cast you press', () => {
  it('shows at once and leaves out the server cast it stands in for', () => {
    const echo = createCastEcho(0);
    echo.cast(1, 0);
    expect(echo.waiting(1, 100)).toBe(true);
    const cast = { kind: 'cast', side: 0, button: 1, move: 'm', shape: 'bolt' } as const;
    const theirs = { ...cast, side: 1 } as const;
    expect(echo.settle([cast, theirs], 200)).toEqual([theirs]);
    expect(echo.waiting(1, 200)).toBe(false);
    expect(echo.settle([cast], 300)).toEqual([cast]);
    echo.cast(2, 400);
    expect(echo.waiting(2, 2_000)).toBe(false);
  });
});
