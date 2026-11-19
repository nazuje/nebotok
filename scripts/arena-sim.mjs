// Plays the computer's BOT mind against the WILD and WILD_EASIER minds, every species against
// every species at levels 5, 10 and 20, and prints how the fights go next to the balance targets in
// docs/arena.md: how often BOT wins, how fights end, how long they last, how many reach the storm,
// how a type advantage moves the wins, and how much each shape deals a cast.
//   node scripts/arena-sim.mjs [--seeds 1] [--levels 5,10,20] [--plus 0] [--shapes-level 40] [--arena <file>]
// BOT plays a player's creature with its default loadout (the turtle setting on against
// WILD_EASIER); the wild creature has `wildLoadout`. `--plus 4` makes the wild creature 4 levels
// higher. `--shapes-level` adds a BOT against WILD round at a level where every shape is learned,
// for the shape table only. `--shapes-level 0` leaves it out. `--arena` tries another arena.json
// before changing the real one.
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { defaultLoadout, loadArenaContent, mindFight, wildLoadout } from '../packages/core/src/index.ts';

const { values } = parseArgs({
  options: {
    seeds: { type: 'string', default: '1' },
    levels: { type: 'string', default: '5,10,20' },
    plus: { type: 'string', default: '0' },
    'shapes-level': { type: 'string', default: '40' },
    arena: { type: 'string' },
  },
});
const seeds = Number(values.seeds);
const levels = values.levels.split(',').map(Number);
const plus = Number(values.plus);
const shapesLevel = Number(values['shapes-level']);

const read = (name) => JSON.parse(readFileSync(new URL(`../content/creatures/${name}.json`, import.meta.url), 'utf8'));
const arena = values.arena ? JSON.parse(readFileSync(values.arena, 'utf8')) : read('arena');
const content = loadArenaContent({ arena, rules: read('battle-rules'), species: read('species'), moves: read('moves'), weather: read('weather') });
const species = [...content.species.keys()].toSorted();
const SECOND = 60;

/** How strongly one type's hits land on another's in the arena, in percent. */
function typePower(from, to) {
  const type = content.weather.get(from);
  return type.strongAgainst.includes(to) ? content.arena.strongPercent : type.weakAgainst.includes(to) ? content.arena.weakPercent : 100;
}

/** How the bot's type fares against the wild one's: its hits' effectiveness against the wild one's on it. */
function matchup(bot, wild) {
  const ratio = typePower(bot, wild) / typePower(wild, bot);
  return ratio > 1 ? 'advantage' : ratio < 1 ? 'disadvantage' : 'even';
}

const shapeOf = (move) => content.moves.get(move).arena;

function fight(seed, bot, wild, level, mind, shapes) {
  const turtle = mind === 'WILD_EASIER';
  const wildLevel = Math.min(100, level + plus);
  const setup = {
    seed,
    fighters: [
      { id: 'bot', species: bot, level, loadout: defaultLoadout({ species: bot, level }, content), turtle, computer: false },
      { id: 'wild', species: wild, level: wildLevel, loadout: wildLoadout(wild, wildLevel, content), turtle: false, computer: true },
    ],
  };
  const state = mindFight(setup, ['BOT', mind], content, (_before, { events }) => {
    for (const event of events) {
      if (event.kind === 'cast') shapes.cast(shapeOf(event.move));
      else if (event.kind === 'hit') shapes.hit(shapeOf(event.move), event.damage);
    }
  });
  const { winner, how, tick } = state.outcome;
  return { winner, how, tick, storm: tick >= content.arena.storm.firstTicks, matchup: matchup(content.species.get(bot).type, content.species.get(wild).type) };
}

/** Casts and damage by kind and shape: a strike is a special (cloud-clap) or an ultimate (sky-crackle). */
function shapeTable() {
  const rows = new Map();
  const row = ({ kind, shape }) => {
    const key = `${kind} ${shape}`;
    if (!rows.has(key)) rows.set(key, { kind, shape, casts: 0, damage: 0 });
    return rows.get(key);
  };
  return {
    rows,
    cast: (block) => {
      row(block).casts += 1;
    },
    hit: (block, damage) => {
      row(block).damage += damage;
    },
  };
}

function play(level, mind, shapes) {
  const runs = [];
  for (const bot of species) for (const wild of species) for (let seed = 0; seed < seeds; seed += 1) runs.push(fight(seed, bot, wild, level, mind, shapes));
  return runs;
}

const percent = (part, whole) => (whole === 0 ? '   -  ' : `${((100 * part) / whole).toFixed(1).padStart(5)}%`);
const share = (runs, test) => runs.filter(test).length;

function summary(runs) {
  const ended = runs.length;
  const botWins = share(runs, (run) => run.winner === 0);
  const ringOuts = share(runs, (run) => run.how === 'ringOut');
  const seconds = runs.reduce((sum, run) => sum + run.tick, 0) / ended / SECOND;
  return { ended, botWins, ringOuts, knockouts: share(runs, (run) => run.how === 'knockout'), timeUps: share(runs, (run) => run.how === 'timeUp'), draws: share(runs, (run) => run.winner === null), seconds, storm: share(runs, (run) => run.storm) };
}

const started = performance.now();
const shapes = shapeTable();
const results = [];
console.log(`${species.length} species, every pair, ${seeds} seed(s) each; the wild creature ${plus === 0 ? 'at the same level' : `${plus} levels higher`}.\n`);
console.log('mind         level  fights  BOT wins  draws  knockout  ring-out  time-up  mean length  storm reached');
for (const mind of ['WILD', 'WILD_EASIER']) {
  for (const level of levels) {
    const runs = play(level, mind, mind === 'WILD' ? shapes : shapeTable());
    const s = summary(runs);
    results.push({ mind, level, runs, s });
    console.log(
      `${mind.padEnd(12)} ${String(level).padStart(5)}  ${String(s.ended).padStart(6)}  ${percent(s.botWins, s.ended)}  ${percent(s.draws, s.ended)}  ${percent(s.knockouts, s.ended)}  ${percent(s.ringOuts, s.ended)}  ${percent(s.timeUps, s.ended)}  ${s.seconds.toFixed(1).padStart(9)} s  ${percent(s.storm, s.ended)}`,
    );
  }
}

const wild = results.filter((result) => result.mind === 'WILD').flatMap((result) => result.runs);
console.log('\nBOT against WILD by type, all levels together:');
const byMatchup = {};
for (const group of ['advantage', 'even', 'disadvantage']) {
  const runs = wild.filter((run) => run.matchup === group);
  byMatchup[group] = runs.length === 0 ? null : share(runs, (run) => run.winner === 0) / runs.length;
  console.log(`  ${group.padEnd(13)} ${String(runs.length).padStart(5)} fights, BOT wins ${percent(share(runs, (run) => run.winner === 0), runs.length)}`);
}

if (shapesLevel > 0 && !levels.includes(shapesLevel)) {
  const runs = play(shapesLevel, 'WILD', shapes);
  const s = summary(runs);
  console.log(`\nShape round, BOT against WILD at level ${shapesLevel}: BOT wins ${percent(s.botWins, s.ended)}, ring-outs ${percent(s.ringOuts, s.ended)}, mean ${s.seconds.toFixed(1)} s.`);
}

console.log('\nDamage a cast by shape, BOT and WILD together, against the average of its kind (shapes that deal damage):');
const damaging = [...shapes.rows.values()].filter((row) => row.shape !== 'weather');
const kinds = Map.groupBy(damaging, (row) => row.kind);
let worstRatio = 0;
for (const [kind, rows] of [...kinds].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
  const perCast = rows.map((row) => [row.shape, row.casts, row.damage / Math.max(1, row.casts)]);
  const average = perCast.reduce((sum, [, , value]) => sum + value, 0) / perCast.length;
  for (const [shape, casts, value] of perCast.toSorted((a, b) => b[2] - a[2])) {
    const ratio = value / average;
    worstRatio = Math.max(worstRatio, ratio);
    console.log(`  ${kind.padEnd(9)} ${shape.padEnd(7)} ${String(casts).padStart(7)} casts  ${value.toFixed(1).padStart(7)} a cast  ${ratio.toFixed(2)}× its kind`);
  }
}

const same = results.filter((result) => result.mind === 'WILD').map((result) => result.s);
const total = (key) => same.reduce((sum, s) => sum + s[key], 0);
const ended = total('ended');
const meanSeconds = same.reduce((sum, s) => sum + s.seconds * s.ended, 0) / ended;
const botWinShare = byMatchup.even ?? total('botWins') / ended;
const ringOutShare = total('ringOuts') / ended;
const stormShare = total('storm') / ended;
const swing = byMatchup.advantage !== null && byMatchup.disadvantage !== null ? ((byMatchup.advantage - byMatchup.disadvantage) * 100) / 2 : null;
const check = (ok) => (ok ? 'pass' : 'MISS');
console.log(`\nTargets (docs/arena.md "Balance targets"), BOT against WILD${plus === 0 ? '' : ` ${plus} levels higher`}:`);
console.log(`  ${check(meanSeconds >= 25 && meanSeconds <= 70)}  a fight lasts 25 to 70 s: ${meanSeconds.toFixed(1)} s`);
console.log(`  ${check(stormShare >= 0.5)}  at least half reach the storm: ${(100 * stormShare).toFixed(1)}%`);
console.log(`  ${check(botWinShare >= 0.75 && botWinShare <= 0.9)}  BOT wins 75 to 90% with neither type ahead: ${(100 * botWinShare).toFixed(1)}% (${((100 * total('botWins')) / ended).toFixed(1)}% over all pairs)`);
console.log(`  ${swing === null ? '-' : check(swing >= 10 && swing <= 20)}  a type advantage moves it about 15 points: ${swing === null ? 'no matchups' : `${swing.toFixed(1)} points each way`}`);
console.log(`  ${check(worstRatio <= 1.5)}  no shape deals more than 1.5× its kind's average: at most ${worstRatio.toFixed(2)}×`);
console.log(`  ${check(ringOutShare >= 0.2 && ringOutShare <= 0.45)}  ring-outs end 20 to 45% of fights: ${(100 * ringOutShare).toFixed(1)}%`);
console.log(`\n${((performance.now() - started) / 1000).toFixed(1)} s`);
