import { BOT_SKILL, WILD_EASIER, WILD_SKILL, createBrain, think } from './arena-ai.ts';
import { stepArena } from './arena-rules.ts';
import { createArena, type ArenaOptions, type How, type Side } from './arena-state.ts';

/** Bot-against-wild runs of whole arena battles with no drawing, for measuring length and endings. */

export type ArenaRun = { readonly seconds: number; readonly winner: Side | null; readonly how: How | null; readonly stepMs: number };

export function simulateArena(options: ArenaOptions): ArenaRun {
  const state = createArena(options);
  const bot = createBrain(0, options.seed, BOT_SKILL);
  const wild = createBrain(1, options.seed, options.easier ? WILD_EASIER : WILD_SKILL);
  const started = performance.now();
  while (!state.outcome && state.tick < 200 * 60) stepArena(state, think(state, bot), think(state, wild));
  const stepMs = (performance.now() - started) / Math.max(1, state.tick);
  return { seconds: state.tick / 60, winner: state.outcome?.winner ?? null, how: state.outcome?.how ?? null, stepMs };
}

export type ArenaMeasure = { readonly averageSeconds: number; readonly shortest: number; readonly longest: number; readonly yourWins: number; readonly endings: Readonly<Record<string, number>>; readonly stepMs: number };

/** `count` battles from seed 1000 on, each starting with kit `seed % 3` unless `kit` is given. */
export function measureArena(count: number, base: Omit<ArenaOptions, 'seed' | 'kit'> & { kit?: number }): ArenaMeasure {
  const runs = Array.from({ length: count }, (_, at) => simulateArena({ ...base, seed: 1000 + at, kit: base.kit ?? at % 3 }));
  const seconds = runs.map((run) => run.seconds);
  const endings: Record<string, number> = {};
  for (const run of runs) endings[run.how ?? 'none'] = (endings[run.how ?? 'none'] ?? 0) + 1 / count;
  return {
    averageSeconds: seconds.reduce((sum, value) => sum + value, 0) / count,
    shortest: Math.min(...seconds),
    longest: Math.max(...seconds),
    yourWins: runs.filter((run) => run.winner === 0).length / count,
    endings,
    stepMs: runs.reduce((sum, run) => sum + run.stepMs, 0) / count,
  };
}
