import { CLIENT_MESSAGES, WalkHoldMessage, WalkStopMessage, WalkToMessage, createRng, createWalker, mapFromRows, planCommand, samePoint, stepWalker, walkMessage, withIntent, type Direction, type Point, type Rng, type WalkCommand, type Walker } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { createOutbox } from '../src/outbox.ts';
import { createWorldView, type PlayerFacts } from '../src/world-view.ts';

/**
 * Plays your own courier against a simulated server, with the server's tick and patch rates and a
 * one-way delay each way, and records where the page draws the courier every frame.
 */

const STEP_MS = 200;
const TICK_MS = 50;
const FRAME_MS = 1_000 / 60;
const ROWS = Array.from({ length: 30 }, (_row, y) => Array.from({ length: 40 }, (_cell, x) => ((x === 12 && y > 4 && y < 12) || (y === 22 && x > 18 && x < 30) ? '#' : '.')).join(''));
const MAP = mapFromRows('sim', ROWS, { x: 20, y: 15 });
const START = { x: 20, y: 15 };

type Scenario = 'retap' | 'drag' | 'keys';
/** The furthest a frame of plain walking moves the courier, in tiles, with a little room for rounding. */
const WALKING = FRAME_MS / STEP_MS + 0.01;

type Run = { jumps: number; worst: number };

type Timer = { at: number; order: number; run: () => void };

const facts = (from: Walker): PlayerFacts => ({ name: 'Mia Oblak', avatar: 'green', x: from.x, y: from.y, facing: from.facing, moving: from.moving, connected: true, inBattle: false, talking: false, skill: '' });

function simulate(scenario: Scenario, latencyMs: number, jitterMs: number, seed: number): Run {
  const rng: Rng = createRng(`${scenario}-${latencyMs}-${jitterMs}-${seed}`);
  let clock = 0;
  let order = 0;
  const timers: Timer[] = [];
  const at = (when: number, run: () => void) => {
    const timer = { at: when, order: order++, run };
    timers.push(timer);
    return timer;
  };
  // A WebSocket keeps order, so a message never overtakes the one sent before it.
  const link = () => {
    let last = 0;
    return (run: () => void) => {
      last = Math.max(last, clock + latencyMs + rng.int(0, jitterMs));
      at(last, run);
    };
  };
  const up = link();
  const down = link();

  let walker: Walker = createWalker(START);
  const view = createWorldView();
  view.setSelf('me');
  view.setMap(MAP);
  view.setStepMs(STEP_MS);
  view.update('me', facts(walker), 0);

  // What world-room.ts does with each walk message.
  const command = (asked: WalkCommand, from: Point | undefined) => {
    const intent = planCommand(MAP, walker, asked, from);
    if (intent) walker = withIntent(walker, intent);
  };
  const receive = ({ type, payload }: ReturnType<typeof walkMessage>) => {
    if (type === CLIENT_MESSAGES.walkTo) {
      const { x, y, from } = WalkToMessage.parse(payload);
      command({ kind: 'to', target: { x, y } }, from);
    } else if (type === CLIENT_MESSAGES.walkHold) {
      const { direction, from } = WalkHoldMessage.parse(payload);
      command({ kind: 'hold', direction }, from);
    } else {
      command({ kind: 'stop' }, WalkStopMessage.parse(payload).from);
    }
  };

  const outbox = createOutbox({
    // What app.ts does: a command the prediction accepts goes to the server, with the tile it was planned from.
    deliver: (asked) => {
      const from = view.command(asked);
      if (!from) return;
      const message = walkMessage(asked, from);
      up(() => receive(message));
    },
    now: () => clock,
    later: (run, ms) => {
      const timer = at(clock + ms, run);
      return () => timers.splice(timers.indexOf(timer), 1);
    },
  });

  // The server's fixed step, and a patch of whatever changed after each one.
  const phase = rng.int(0, TICK_MS - 1);
  let shown = facts(walker);
  const tick = () => {
    walker = stepWalker(MAP, walker, TICK_MS, STEP_MS);
    const next = facts(walker);
    if (next.x !== shown.x || next.y !== shown.y || next.facing !== shown.facing || next.moving !== shown.moving) {
      shown = next;
      down(() => view.update('me', next, clock));
    }
    at(clock + TICK_MS, tick);
  };
  at(phase, tick);

  // The pointer, as input.ts sees it: a tile under it, a walk sent each time that tile changes.
  let held: (() => Point) | null = null;
  let heldTarget: Point | null = null;
  const pointAt = (tile: Point) => {
    if (heldTarget && samePoint(tile, heldTarget)) return;
    if (!view.canReach(tile)) return;
    heldTarget = tile;
    outbox.send({ kind: 'to', target: tile });
  };

  let drawn: Point | null = null;
  const run: Run = { jumps: 0, worst: 0 };
  const frame = () => {
    view.tick(clock);
    if (held) pointAt(held());
    const self = view.shown(clock).find((player) => player.self);
    if (self) {
      if (drawn) {
        const moved = Math.abs(self.at.x - drawn.x) + Math.abs(self.at.y - drawn.y);
        run.worst = Math.max(run.worst, moved);
        if (moved > 0.5) run.jumps += 1;
      }
      drawn = self.at;
    }
    at(clock + FRAME_MS, frame);
  };
  at(0, frame);

  const near = () => {
    const self = view.predicted()?.tile ?? START;
    return { x: Math.min(39, Math.max(0, self.x + rng.int(-8, 8))), y: Math.min(29, Math.max(0, self.y + rng.int(-6, 6))) };
  };
  let script = 500;
  if (scenario === 'retap') {
    for (let tap = 0; tap < 14; tap += 1) {
      at(script, () => {
        heldTarget = null;
        pointAt(near());
      });
      script += rng.int(250, 700);
    }
  } else if (scenario === 'drag') {
    // The camera follows the courier, so a still finger is over a new tile every step.
    at(script, () => {
      const started = clock;
      heldTarget = null;
      held = () => {
        const angle = (clock - started) / 600;
        const self = view.shown(clock).find((player) => player.self)?.at ?? START;
        return { x: Math.min(39, Math.max(0, Math.floor(self.x + 0.5 + Math.cos(angle) * 7))), y: Math.min(29, Math.max(0, Math.floor(self.y + 0.5 + Math.sin(angle) * 5))) };
      };
    });
    script += 6_000;
    at(script, () => {
      held = null;
    });
  } else {
    const keys: [Direction, number][] = [['right', 900], ['down', 700], ['left', 450], ['up', 300], ['right', 1_200], ['down', 150], ['left', 1_000]];
    for (const [direction, ms] of keys) {
      at(script, () => outbox.send({ kind: 'hold', direction }));
      script += ms;
      at(script, () => outbox.send({ kind: 'stop' }));
      script += rng.int(0, 120);
    }
  }
  const end = script + 2_500;

  while (timers.length > 0) {
    timers.sort((a, b) => a.at - b.at || a.order - b.order);
    const next = timers.shift() as Timer;
    if (next.at > end) break;
    clock = next.at;
    next.run();
  }
  return run;
}

const LATENCIES = [0, 50, 100, 150];
const SEEDS = Array.from({ length: 12 }, (_, seed) => seed);
const runs = (scenario: Scenario, jitterMs: number) => LATENCIES.flatMap((latency) => SEEDS.map((seed) => ({ latency, seed, run: simulate(scenario, latency, jitterMs, seed) })));

describe('your own courier against a server a network away', () => {
  for (const scenario of ['retap', 'drag', 'keys'] as const) {
    it(`walks the server's route without a correction at home-network delays (${scenario})`, () => {
      const results = runs(scenario, 20);
      expect(results.filter(({ run }) => run.jumps > 0)).toEqual([]);
      expect(results.filter(({ run }) => run.worst > WALKING)).toEqual([]);
    });

    it(`glides rather than jumps when an uneven network still needs a correction (${scenario})`, () => {
      expect(runs(scenario, 60).filter(({ run }) => run.jumps > 0)).toEqual([]);
    });
  }
});
