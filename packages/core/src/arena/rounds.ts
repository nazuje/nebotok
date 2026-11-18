import { maxHpAt } from '../battle/damage.ts';
import type { FightCreature, FightEvent, FightStepResult, RoundPick, RoundResult, RoundsFight, RoundsFightSetup, RoundsResult } from './fight-state.ts';
import type { ArenaContent } from './rules.ts';
import { ARENA_SIDES, arenaStart, type ArenaInputs, type ArenaState, type Side } from './state.ts';
import { arenaStep } from './step.ts';

/**
 * A best of 3 (docs/arena.md, "Fight modes"): one creature a side each round, in the order
 * picked, on a fresh island. A round that ends level is played once more, then counts as a draw.
 * First to 2 round wins; after the last round the score decides, level a draw.
 */

export const ROUNDS = 3;
export const ROUND_WINS = 2;

function pickCreature({ place, fighter }: RoundPick, content: ArenaContent): FightCreature {
  const species = content.species.get(fighter.species);
  if (!species) throw new RangeError(`arena: no species "${fighter.species}"`);
  const maxHealth = maxHpAt(species, fighter.level) * content.arena.island.hpScale;
  return { place, fighter, health: maxHealth, maxHealth, fought: false, out: false };
}

/** The island of a round: its own seed, so every round and replay draws its own numbers. */
function islandOf(fight: Pick<RoundsFight, 'seed' | 'picks' | 'rounds'>, round: number, content: ArenaContent): ArenaState {
  const [first, second] = fight.picks;
  const left = first[round];
  const right = second[round];
  if (!left || !right) throw new RangeError(`arena: no creatures for round ${round + 1}`);
  return arenaStart({ seed: `${fight.seed}/${fight.rounds.length}`, fighters: [left.fighter, right.fighter] }, content);
}

const markFought = (picks: RoundsFight['picks'], round: number): RoundsFight['picks'] => [
  picks[0].map((creature, at) => (at === round ? { ...creature, fought: true } : creature)),
  picks[1].map((creature, at) => (at === round ? { ...creature, fought: true } : creature)),
];

function started(fight: RoundsFight, round: number, replay: boolean, content: ArenaContent, events: FightEvent[]): RoundsFight {
  for (const side of ARENA_SIDES) {
    const creature = fight.picks[side][round];
    if (creature) events.push({ kind: 'entered', side, id: creature.fighter.id, place: creature.place });
  }
  return { ...fight, round, replay, island: islandOf(fight, round, content), picks: markFought(fight.picks, round) };
}

export function roundsStart(setup: RoundsFightSetup, content: ArenaContent): RoundsFight {
  const picks: RoundsFight['picks'] = [setup.picks[0].map((pick) => pickCreature(pick, content)), setup.picks[1].map((pick) => pickCreature(pick, content))];
  const first = { seed: setup.seed, picks, rounds: [] };
  return { mode: 'rounds', ...first, tick: 0, island: islandOf(first, 0, content), picks: markFought(picks, 0), round: 0, replay: false, score: [0, 0], outcome: null };
}

function resultOf(score: readonly [number, number]): { readonly result: RoundsResult; readonly winner: Side | null } {
  if (score[0] > score[1]) return { result: 'won', winner: 0 };
  if (score[1] > score[0]) return { result: 'lost', winner: 1 };
  return { result: 'draw', winner: null };
}

function finished(fight: RoundsFight, events: FightEvent[]): RoundsFight {
  const { result, winner } = resultOf(fight.score);
  events.push({ kind: 'fightEnded', result });
  return { ...fight, outcome: { result, winner, tick: fight.tick } };
}

function counted(fight: RoundsFight, entry: RoundResult, events: FightEvent[]): RoundsFight {
  events.push({ kind: 'roundEnded', round: entry.round, winner: entry.winner, how: entry.how, replay: entry.replayed });
  const score: [number, number] = [fight.score[0], fight.score[1]];
  if (entry.winner !== null && !entry.replayed) score[entry.winner] += 1;
  return { ...fight, rounds: [...fight.rounds, entry], score };
}

/**
 * The next round after `round`, or the end: once a side has 2 wins or the rounds run out. A side
 * with no creature left for a round loses it, and with neither side having one the fight ends.
 */
function nextRound(fight: RoundsFight, round: number, content: ArenaContent, events: FightEvent[]): RoundsFight {
  let next = fight;
  for (let at = round + 1; at < ROUNDS; at += 1) {
    if (next.score.some((wins) => wins >= ROUND_WINS)) break;
    const present = ARENA_SIDES.filter((side) => next.picks[side][at] !== undefined);
    if (present.length === 2) return started(next, at, false, content, events);
    if (present.length === 0) break;
    const winner = present[0] ?? null;
    next = counted(next, { round: at, winner, how: 'forfeit', tick: 0, replayed: false }, events);
  }
  return finished(next, events);
}

/** The picks with each round creature's health and fall from the island written back. */
function withBodiesBack(fight: RoundsFight): RoundsFight['picks'] {
  const back = (side: Side) =>
    fight.picks[side].map((creature, at) => {
      const body = fight.island.bodies[side];
      return at === fight.round ? { ...creature, health: body.health, out: body.out } : creature;
    });
  return [back(0), back(1)];
}

/** One tick of a best of 3: the island's step, then, when its round ended, the score and the next island. */
export function roundsStep(fight: RoundsFight, inputs: ArenaInputs, content: ArenaContent): FightStepResult {
  if (fight.outcome) return { fight, events: [] };
  const step = arenaStep(fight.island, inputs, content);
  const events: FightEvent[] = [...step.events];
  const played: RoundsFight = { ...fight, tick: fight.tick + 1, island: step.state };
  const ending = step.state.outcome;
  if (!ending) return { fight: played, events };
  const replayed = ending.winner === null && !fight.replay;
  const scored = counted({ ...played, picks: withBodiesBack(played) }, { round: fight.round, winner: ending.winner, how: ending.how, tick: ending.tick, replayed }, events);
  if (replayed) return { fight: started(scored, fight.round, true, content, events), events };
  return { fight: nextRound(scored, fight.round, content, events), events };
}
