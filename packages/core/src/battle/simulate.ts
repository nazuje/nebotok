import { createRng } from '../rng.ts';
import { BOT_POLICIES, playBattle, type BotName } from './bots.ts';
import type { BattleContent } from './content.ts';
import type { BattleSetup } from './state.ts';

export type SimulationOptions = {
  /** The two bots that play each other. */
  readonly bots: readonly [BotName, BotName];
  readonly seeds: readonly (number | string)[];
  readonly teamSize: number;
  readonly level: number;
};

export type SimulationReport = {
  readonly battles: number;
  /** Wins by the first and the second bot in `bots`, whichever side each played. */
  readonly wins: readonly [number, number];
  readonly draws: number;
  readonly endedByFainting: number;
  readonly endedByTurnLimit: number;
  readonly totalTurns: number;
  readonly longestTurns: number;
};

export type RoundRobinOptions = {
  readonly seeds: readonly (number | string)[];
  readonly level: number;
};

/** How one species fared one on one against every other species. */
export type SpeciesRecord = {
  readonly species: string;
  readonly type: string;
  readonly battles: number;
  readonly wins: number;
  readonly draws: number;
};

/**
 * Every species battles every other one on one at the same level, greedy bot against greedy bot,
 * once per seed from each side, so neither moving first on a speed tie nor the seeds favour one.
 * Records come in species id order.
 */
export function roundRobin(content: BattleContent, options: RoundRobinOptions): SpeciesRecord[] {
  const ids = [...content.species.keys()].toSorted();
  const records = ids.map((id) => ({ species: id, type: content.species.get(id)?.type ?? '', battles: 0, wins: 0, draws: 0 }));
  const tally = new Map(records.map((record) => [record.species, record]));
  const greedy = BOT_POLICIES.greedy;
  for (const [a, first] of ids.entries()) {
    for (const second of ids.slice(a + 1)) {
      for (const seed of options.seeds) {
        for (const [left, right] of [[first, second], [second, first]] as const) {
          const setup: BattleSetup = { sides: [{ creatures: [{ species: left, level: options.level }] }, { creatures: [{ species: right, level: options.level }] }], weather: null };
          const key = `${left}:${right}:${seed}`;
          const { state } = playBattle(setup, [greedy, greedy], createRng(`battle:${key}`), createRng(`bots:${key}`), content);
          const winner = state.outcome?.winner ?? null;
          for (const [side, id] of [left, right].entries()) {
            const record = tally.get(id);
            if (!record) continue;
            record.battles += 1;
            if (winner === null) record.draws += 1;
            else if (winner === side) record.wins += 1;
          }
        }
      }
    }
  }
  return records;
}

/** The same random team for both sides, so only the bots differ. */
export function mirroredSetup(content: BattleContent, seed: number | string, teamSize: number, level: number): BattleSetup {
  const rng = createRng(`teams:${seed}`);
  const pool = [...content.species.keys()].toSorted();
  const creatures = Array.from({ length: Math.min(teamSize, pool.length) }, () => ({ species: pool.splice(rng.int(0, pool.length - 1), 1)[0] ?? '', level }));
  return { sides: [{ creatures }, { creatures }], weather: null };
}

/**
 * Plays one battle per seed between two bots on mirrored teams. The first bot plays side 0 on even
 * battles and side 1 on odd ones, so moving first on a speed tie favours neither.
 */
export function simulateBots(content: BattleContent, options: SimulationOptions): SimulationReport {
  const wins: [number, number] = [0, 0];
  let draws = 0;
  let endedByFainting = 0;
  let totalTurns = 0;
  let longestTurns = 0;
  options.seeds.forEach((seed, at) => {
    const flipped = at % 2 === 1;
    const first = BOT_POLICIES[options.bots[0]];
    const second = BOT_POLICIES[options.bots[1]];
    const setup = mirroredSetup(content, seed, options.teamSize, options.level);
    const { state } = playBattle(setup, flipped ? [second, first] : [first, second], createRng(`battle:${seed}`), createRng(`bots:${seed}`), content);
    const winner = state.outcome?.winner ?? null;
    if (winner === null) draws += 1;
    else wins[(winner === 1) === flipped ? 0 : 1] += 1;
    if (state.outcome?.reason === 'fainted') endedByFainting += 1;
    totalTurns += state.turn;
    longestTurns = Math.max(longestTurns, state.turn);
  });
  const battles = options.seeds.length;
  return { battles, wins, draws, endedByFainting, endedByTurnLimit: battles - endedByFainting, totalTurns, longestTurns };
}
