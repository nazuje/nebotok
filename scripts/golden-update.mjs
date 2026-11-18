// Re-records every golden's expectedHash from the current rules. Run only when a change in rule
// behaviour is intended, and say why in the commit. Battle goldens in battle/ replay against the
// frozen content in battle/content/, and arena goldens in arena/ against arena/content/, so edits
// to content/creatures/ never move them.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ArenaGoldenFile,
  BattleGoldenFile,
  GoldenFile,
  arenaReplayHash,
  battleReplayHash,
  loadArenaContent,
  loadBattleContent,
  replayHash,
} from '../packages/core/src/index.ts';

const GOLDEN_DIR = fileURLToPath(new URL('../packages/core/fixtures/golden/', import.meta.url));

let changed = 0;
for (const name of readdirSync(GOLDEN_DIR).filter((file) => file.endsWith('.json')).toSorted()) {
  const path = join(GOLDEN_DIR, name);
  const golden = GoldenFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  const expectedHash = replayHash(golden.seed, golden.commands);
  if (expectedHash === golden.expectedHash) {
    console.log(`unchanged  ${name}`);
    continue;
  }
  writeFileSync(path, `${JSON.stringify({ ...golden, expectedHash }, null, 2)}\n`);
  console.log(`updated    ${name}  ${golden.expectedHash} -> ${expectedHash}`);
  changed += 1;
}
console.log(changed ? `\n${changed} golden(s) re-recorded. Review the diff before committing.` : '\nAll goldens already match.');
// Battle goldens replay against their own frozen copy of the creature content, not content/creatures/.
const BATTLE_DIR = join(GOLDEN_DIR, 'battle');
const readCreatures = (name) => JSON.parse(readFileSync(join(BATTLE_DIR, 'content', `${name}.json`), 'utf8'));
const battleContent = loadBattleContent({
  weather: readCreatures('weather'),
  moves: readCreatures('moves'),
  species: readCreatures('species'),
  rules: readCreatures('battle-rules'),
  befriending: readCreatures('befriending'),
  items: readCreatures('items'),
});
let battleChanged = 0;
for (const name of readdirSync(BATTLE_DIR).filter((file) => file.endsWith('.json')).toSorted()) {
  const path = join(BATTLE_DIR, name);
  const golden = BattleGoldenFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  const expectedHash = battleReplayHash(golden, battleContent);
  if (expectedHash === golden.expectedHash) {
    console.log(`unchanged  battle/${name}`);
    continue;
  }
  writeFileSync(path, `${JSON.stringify({ ...golden, expectedHash }, null, 2)}\n`);
  console.log(`updated    battle/${name}  ${golden.expectedHash} -> ${expectedHash}`);
  battleChanged += 1;
}
console.log(battleChanged ? `\n${battleChanged} battle golden(s) re-recorded. Review the diff before committing.` : '\nAll battle goldens already match.');
// Arena goldens replay against their own frozen copy of the arena's numbers, battle rules, weather, moves and species.
const ARENA_DIR = join(GOLDEN_DIR, 'arena');
const readArena = (name) => JSON.parse(readFileSync(join(ARENA_DIR, 'content', `${name}.json`), 'utf8'));
const arenaContent = loadArenaContent({
  arena: readArena('arena'),
  rules: readArena('battle-rules'),
  species: readArena('species'),
  moves: readArena('moves'),
  weather: readArena('weather'),
});
let arenaChanged = 0;
for (const name of readdirSync(ARENA_DIR).filter((file) => file.endsWith('.json')).toSorted()) {
  const path = join(ARENA_DIR, name);
  const golden = ArenaGoldenFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  const expectedHash = arenaReplayHash(golden, arenaContent);
  if (expectedHash === golden.expectedHash) {
    console.log(`unchanged  arena/${name}`);
    continue;
  }
  writeFileSync(path, `${JSON.stringify({ ...golden, expectedHash }, null, 2)}\n`);
  console.log(`updated    arena/${name}  ${golden.expectedHash} -> ${expectedHash}`);
  arenaChanged += 1;
}
console.log(arenaChanged ? `\n${arenaChanged} arena golden(s) re-recorded. Review the diff before committing.` : '\nAll arena goldens already match.');
