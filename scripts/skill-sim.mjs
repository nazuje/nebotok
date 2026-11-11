// Plays a steady gatherer and cook on the live skill content and prints the minutes of play to each
// level, averaged over many players, so the XP curve stays near two to three hours to the top level.
//   node scripts/skill-sim.mjs [--runs 50]
// Assumptions (packages/core/src/skill-sim.ts): 12 s a gather or cook, 85% success, the best ready
// spot or best known recipe, and 14 s to gather each ingredient a cook uses.
// packages/core/test/property/skill-sim.test.ts asserts the top level lands between 120 and 180 minutes.
import { readdirSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { SKILL_SIM_DEFAULTS, loadBattleContent, loadStoryContent, simulateSkills } from '../packages/core/src/index.ts';

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
    skills: { skills: read('skills'), spots: read('spots'), recipes: read('recipes'), stations: read('stations'), jobs: read('jobs') },
  },
  battle,
);

const results = simulateSkills(content, runs);
const { gatherMs, cookMs, ingredientMs, successPercent } = SKILL_SIM_DEFAULTS;
console.log(`${runs} players each, ${gatherMs / 1000} s a gather, ${cookMs / 1000} s a cook plus ${ingredientMs / 1000} s an ingredient, ${successPercent}% success\n`);
console.log(`level  ${results.map((result) => result.skill.padStart(9)).join(' ')}`);
const levels = Math.max(...results.map((result) => result.minutes.length));
for (let at = 0; at < levels; at += 1) {
  console.log(`${String(at + 2).padStart(5)}  ${results.map((result) => (result.minutes[at] === undefined ? '-' : result.minutes[at].toFixed(0)).padStart(9)).join(' ')}`);
}
