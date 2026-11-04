// Plays greedy bots against random bots over many seeds and prints how often each wins.
//   node scripts/battle-sim.mjs [--seeds 500] [--team 3] [--level 30]
// Both sides get the same team and the bots swap sides every battle, so only the policy differs.
// packages/core/test/property/battle-bots.test.ts asserts the same kind of result on fixed seeds.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadBattleContent, simulateBots } from '../packages/core/src/index.ts';

const { values } = parseArgs({ options: { seeds: { type: 'string', default: '500' }, team: { type: 'string', default: '3' }, level: { type: 'string', default: '30' } } });
const seeds = Array.from({ length: Number(values.seeds) }, (_seed, at) => at);
const teamSize = Number(values.team);
const level = Number(values.level);

const read = (name) => JSON.parse(readFileSync(new URL(`../content/creatures/${name}.json`, import.meta.url), 'utf8'));
const content = loadBattleContent({ weather: read('weather'), moves: read('moves'), species: read('species'), rules: read('battle-rules') });

const pct = (count) => `${((100 * count) / seeds.length).toFixed(1)}%`;
console.log(`${seeds.length} seeds (0 to ${seeds.length - 1}), mirrored teams of ${teamSize} at level ${level}, turn limit ${content.rules.turnLimit}\n`);
for (const bots of [['greedy', 'random'], ['greedy', 'greedy'], ['random', 'random']]) {
  const report = simulateBots(content, { bots, seeds, teamSize, level });
  const [a, b] = bots[0] === bots[1] ? [`${bots[0]} A`, `${bots[1]} B`] : bots;
  console.log(`${a} vs ${b}: ${a} wins ${report.wins[0]} (${pct(report.wins[0])}), ${b} wins ${report.wins[1]} (${pct(report.wins[1])}), draws ${report.draws}`);
  console.log(`  ended by fainting ${report.endedByFainting}, at the turn limit ${report.endedByTurnLimit}; average ${(report.totalTurns / report.battles).toFixed(1)} turns, longest ${report.longestTurns}`);
}
