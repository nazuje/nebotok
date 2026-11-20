// Plays the live skill content and prints the minutes of play to each level, averaged over many
// players, so the XP curve stays near two to three hours to the top level:
// - one skill alone: a steady gatherer or cook, 12 s a gather or cook, 85% success, the best ready
//   spot or best known recipe, and 14 s to gather each ingredient a cook uses;
// - whole players training all three skills with the job board, as a child plays the games
//   (packages/core/src/game-sim.ts): "mixed" takes turns between the board and free play, "board
//   first" works the board whenever it can;
// - how often that child gets a perfect, a success or a miss in each tiny game.
//   node scripts/skill-sim.mjs [--runs 50]
// packages/core/test/property/skill-sim.test.ts asserts the targets (packages/core/src/skill-sim.ts).
import { readdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
  CHILD_MODEL,
  PLAYER_SIM_DEFAULTS,
  SKILL_SIM_DEFAULTS,
  loadBattleContent,
  loadStoryContent,
  simulateGames,
  simulatePlayers,
  simulateSkills,
} from '../packages/core/src/index.ts';

const { values } = parseArgs({ options: { runs: { type: 'string', default: '50' } } });
const runs = Number(values.runs);

const read = (name) => JSON.parse(readFileSync(new URL(`../content/${name}.json`, import.meta.url), 'utf8'));
const battle = loadBattleContent({
  weather: read('creatures/weather'),
  moves: read('creatures/moves'),
  species: read('creatures/species'),
  rules: read('creatures/battle-rules'),
  befriending: read('creatures/befriending'),
  items: read('items'),
});
const dialogue = Object.fromEntries(
  readdirSync(new URL('../content/dialogue/', import.meta.url))
    .filter((file) => file.endsWith('.json'))
    .map((file) => [file.slice(0, -'.json'.length), read(`dialogue/${file.slice(0, -'.json'.length)}`)]),
);
const content = loadStoryContent(
  {
    npcs: read('npcs'),
    dialogue,
    quests: read('quests'),
    story: read('story'),
    inventory: read('inventory'),
    trainers: read('trainers'),
    skills: { skills: read('skills'), spots: read('spots'), recipes: read('recipes'), stations: read('stations'), jobs: read('jobs') },
  },
  battle,
);

const results = simulateSkills(content, runs);
const { gatherMs, cookMs, ingredientMs, successPercent } = SKILL_SIM_DEFAULTS;
const table = (title, rows) => {
  console.log(title);
  console.log(`level  ${rows.map((result) => result.skill.padStart(9)).join(' ')}`);
  const levels = Math.max(...rows.map((result) => result.minutes.length));
  for (let at = 0; at < levels; at += 1) {
    console.log(`${String(at + 2).padStart(5)}  ${rows.map((result) => (result.minutes[at] === undefined ? '-' : result.minutes[at].toFixed(0)).padStart(9)).join(' ')}`);
  }
  console.log('');
};
table(`One skill alone: ${runs} players each, ${gatherMs / 1000} s a gather, ${cookMs / 1000} s a cook plus ${ingredientMs / 1000} s an ingredient, ${successPercent}% success`, results);

const { deliverMs } = PLAYER_SIM_DEFAULTS;
for (const style of ['mixed', 'boardFirst']) {
  const players = simulatePlayers(style, content, runs);
  const { perfect, success, miss } = players.outcomes;
  const games = perfect + success + miss;
  const share = (count) => `${Math.round((count * 100) / games)}%`;
  table(
    `${style === 'mixed' ? 'Mixed (board and free play by turns)' : 'Board first'}: ${runs} players, all three skills at once, ${gatherMs / 1000} s a game, ${deliverMs / 1000} s a delivery; ` +
      `the child's games ${share(perfect)} perfect, ${share(success)} success, ${share(miss)} miss; ${players.jobsPerHour.toFixed(0)} jobs an hour`,
    players.skills,
  );
}

console.log(`The child's games (${CHILD_MODEL.reactMs.join(' to ')} ms reactions, marker ±${CHILD_MODEL.markerErrorMs} ms), ${runs * 40} games each`);
console.log('game     difficulty  perfect  success  miss');
for (const rates of simulateGames(content.skills.games, runs * 40)) {
  console.log(`${rates.game.padEnd(9)}${String(rates.difficulty).padStart(10)}${`${rates.perfect}%`.padStart(9)}${`${rates.success}%`.padStart(9)}${`${rates.miss}%`.padStart(6)}`);
}
