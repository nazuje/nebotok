// Plays greedy bots against random bots over many seeds and prints how often each wins. Then plays
// every species one on one against every other at the same level, greedy against greedy, and prints
// each species' and each weather type's share of wins, so no creature or type dominates.
//   node scripts/battle-sim.mjs [--seeds 500] [--team 3] [--level 30] [--pair-seeds 20]
// Both sides get the same team and the bots swap sides every battle, so only the policy differs.
// packages/core/test/property/battle-bots.test.ts asserts the same kind of result on fixed seeds.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadBattleContent, roundRobin, simulateBots } from '../packages/core/src/index.ts';

const { values } = parseArgs({
  options: { seeds: { type: 'string', default: '500' }, team: { type: 'string', default: '3' }, level: { type: 'string', default: '30' }, 'pair-seeds': { type: 'string', default: '20' } },
});
const seeds = Array.from({ length: Number(values.seeds) }, (_seed, at) => at);
const teamSize = Number(values.team);
const level = Number(values.level);

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const content = loadBattleContent({
  weather: read('creatures/weather'),
  moves: read('creatures/moves'),
  species: read('creatures/species'),
  rules: read('creatures/battle-rules'),
  befriending: read('creatures/befriending'),
  items: read('items'),
});

const pct = (count) => `${((100 * count) / seeds.length).toFixed(1)}%`;
console.log(`${seeds.length} seeds (0 to ${seeds.length - 1}), mirrored teams of ${teamSize} at level ${level}, turn limit ${content.rules.turnLimit}\n`);
for (const bots of [['greedy', 'random'], ['greedy', 'greedy'], ['random', 'random']]) {
  const report = simulateBots(content, { bots, seeds, teamSize, level });
  const [a, b] = bots[0] === bots[1] ? [`${bots[0]} A`, `${bots[1]} B`] : bots;
  console.log(`${a} vs ${b}: ${a} wins ${report.wins[0]} (${pct(report.wins[0])}), ${b} wins ${report.wins[1]} (${pct(report.wins[1])}), draws ${report.draws}`);
  console.log(`  ended by fainting ${report.endedByFainting}, at the turn limit ${report.endedByTurnLimit}; average ${(report.totalTurns / report.battles).toFixed(1)} turns, longest ${report.longestTurns}`);
}

const pairSeeds = Array.from({ length: Number(values['pair-seeds']) }, (_seed, at) => at);
const records = roundRobin(content, { seeds: pairSeeds, level });
const share = ({ wins, draws, battles }) => (wins + draws / 2) / battles;
const percent = (value) => `${(100 * value).toFixed(1).padStart(5)}%`;
console.log(`\nOne on one at level ${level}, greedy against greedy: each species against every other, ${pairSeeds.length} seeds from each side. A draw counts as half a win.`);
for (const record of records.toSorted((a, b) => share(b) - share(a))) console.log(`  ${record.species.padEnd(14)} ${record.type.padEnd(6)} ${percent(share(record))}  (${record.wins} of ${record.battles}, ${record.draws} draws)`);
const types = Map.groupBy(records, (record) => record.type);
console.log('\nBy weather type, all its species together:');
for (const [type, group] of [...types].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
  const total = group.reduce((sum, record) => ({ wins: sum.wins + record.wins, draws: sum.draws + record.draws, battles: sum.battles + record.battles }), { wins: 0, draws: 0, battles: 0 });
  console.log(`  ${type.padEnd(6)} ${percent(share(total))}`);
}
