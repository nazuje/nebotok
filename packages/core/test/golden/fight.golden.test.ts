import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ENTRY_GRACE_TICKS,
  FightGoldenFile,
  arenaRewards,
  befriendedFromFight,
  fightReplay,
  fightReplayHash,
  fightStart,
  fightStep,
  inventoryAfterFight,
  newCreature,
  teamAfterFight,
  xpForWin,
  type ArenaFight,
  type CreatureInstance,
  type FightEvent,
  type RoundsFight,
  type WildFight,
} from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';
import { goldenFightContent as content } from '../support/arena-content.ts';

const FIGHTS_DIR = fileURLToPath(new URL('../../fixtures/golden/arena/fights/', import.meta.url));
const files = readdirSync(FIGHTS_DIR).filter((name) => name.endsWith('.json')).toSorted();
const golden = (name: string) => FightGoldenFile.parse(JSON.parse(readFileSync(join(FIGHTS_DIR, `${name}.json`), 'utf8')));

/** The replay, with each event's tick. */
function replayOf(name: string): { readonly fight: ArenaFight; readonly events: readonly (FightEvent & { readonly at: number })[] } {
  const { setup, inputs } = golden(name);
  let fight = fightStart(setup, content);
  const events: (FightEvent & { readonly at: number })[] = [];
  for (const run of inputs) {
    for (let tick = 0; tick < run.ticks && !fight.outcome; tick += 1) {
      const step = fightStep(fight, run.sides, content);
      fight = step.fight;
      for (const event of step.events) events.push({ ...event, at: fight.tick });
    }
  }
  return { fight, events };
}

const wildOf = (fight: ArenaFight): WildFight => {
  if (fight.mode !== 'wild') throw new Error('expected a wild fight');
  return fight;
};
const roundsOf = (fight: ArenaFight): RoundsFight => {
  if (fight.mode !== 'rounds') throw new Error('expected a best of 3');
  return fight;
};
const kinds = (events: readonly FightEvent[]) => events.map((event) => event.kind).filter((kind) => ['entered', 'swapped', 'befriended', 'fightEnded', 'roundEnded'].includes(kind) || kind.startsWith('treat'));

/** A team of full-health creatures for the places a wild golden names. */
function teamFor(fight: WildFight): CreatureInstance[] {
  const places = fight.team.map((creature) => creature.place ?? 0);
  return Array.from({ length: Math.max(...places) + 1 }, (_unused, place) => {
    const fighter = fight.team.find((creature) => creature.place === place)?.fighter;
    return newCreature(fighter?.species ?? 'glowbun', fighter?.level ?? 5, battleContent);
  });
}

describe('fight golden replays', () => {
  it('has the six fight goldens', () => {
    expect(files).toEqual([
      'befriend-on-the-second-throw.json',
      'best-of-three-2-1.json',
      'lose-three-lose-fight.json',
      'ring-the-wild-one-out.json',
      'round-replayed-after-a-time-up-tie.json',
      'swap-then-win.json',
    ]);
  });

  it.each(files)('%s replays to its recorded hash', (file) => {
    const name = file.replace(/\.json$/, '');
    // A mismatch means fight or arena rules, or the frozen content in fixtures/golden/arena/content/, changed. If that was intended, run `npm run golden:update`.
    expect(fightReplayHash(golden(name), content)).toBe(golden(name).expectedHash);
    expect(fightReplay(golden(name), content).fight.outcome).not.toBeNull();
  });

  it('befriend on the second throw: a miss lands, is picked back up, and the second throw befriends', () => {
    const { fight, events } = replayOf('befriend-on-the-second-throw');
    const wild = wildOf(fight);
    expect(kinds(events)).toEqual(['treatThrown', 'treatLanded', 'treatPickedUp', 'treatThrown', 'befriended', 'fightEnded']);
    expect(events.filter((event) => event.kind === 'treatThrown')).toMatchObject([{ item: 'sun-treat', liking: 'liked' }, { item: 'sun-treat', liking: 'liked' }]);
    expect(wild.outcome?.result).toBe('befriended');
    expect(befriendedFromFight(wild, battleContent)).toMatchObject({ species: 'glowbun', level: 10 });
    expect(inventoryAfterFight([{ item: 'plain-treat', count: 1 }, { item: 'sun-treat', count: 1 }, { item: 'cloudberry', count: 2 }], wild)).toEqual([
      { item: 'plain-treat', count: 1 },
      { item: 'cloudberry', count: 2 },
    ]);
  });

  it('swap then win: the second creature comes in with its grace, knocks the wild one out, and both get experience', () => {
    const { fight, events } = replayOf('swap-then-win');
    const wild = wildOf(fight);
    expect(kinds(events)).toEqual(['swapped', 'entered', 'fightEnded']);
    expect(events.find((event) => event.kind === 'swapped')).toMatchObject({ from: 0, to: 2 });
    const entered = events.find((event) => event.kind === 'entered')?.at ?? 0;
    expect(events.filter((event) => event.kind === 'hit' && event.side === 0 && event.at < entered + ENTRY_GRACE_TICKS)).toEqual(events.filter((event) => event.kind === 'hit' && event.side === 0 && event.at < entered));
    expect(wild.outcome?.result).toBe('won');
    expect(wild.island.bodies[1].health).toBe(0);
    const after = teamAfterFight(teamFor(wild), wild, content);
    const { rewards } = arenaRewards(after, wild, battleContent);
    expect(rewards.map(({ index, xp }) => [index, xp])).toEqual([
      [0, xpForWin(10)],
      [2, xpForWin(10)],
    ]);
  });

  it('lose three, lose fight: each creature falls, the next comes in, and nothing is won', () => {
    const { fight, events } = replayOf('lose-three-lose-fight');
    const wild = wildOf(fight);
    expect(events.filter((event) => event.kind === 'entered')).toMatchObject([{ place: 1 }, { place: 3 }]);
    expect(wild.outcome?.result).toBe('lost');
    expect(wild.team.every((creature) => creature.fought && (creature.health === 0 || creature.out))).toBe(true);
    for (const { at } of events.filter((event) => event.kind === 'entered')) {
      expect(events.filter((event) => event.kind === 'hit' && event.side === 0 && event.at > at && event.at < at + ENTRY_GRACE_TICKS)).toEqual([]);
    }
    const after = teamAfterFight(teamFor(wild), wild, content);
    expect(after.map((creature) => creature.hp)).toEqual([0, 2, after[2]?.hp, 0]);
    expect(arenaRewards(after, wild, battleContent).rewards).toEqual([]);
    expect(wild.treats).toEqual([{ item: 'plain-treat', count: 3 }]);
  });

  it('ring the wild one out: a win with experience, and no friend', () => {
    const { fight, events } = replayOf('ring-the-wild-one-out');
    const wild = wildOf(fight);
    expect(events.map((event) => event.kind)).toContain('ringOut');
    expect(wild.outcome?.result).toBe('wonByRingOut');
    expect(wild.island.bodies[1].out).toBe(true);
    expect(befriendedFromFight(wild, battleContent)).toBeNull();
    expect(arenaRewards(teamAfterFight(teamFor(wild), wild, content), wild, battleContent).rewards).toEqual([{ index: 0, xp: xpForWin(10), level: expect.any(Number) }]);
  });

  it('best of three, 2-1: side 0, side 1, side 0', () => {
    const rounds = roundsOf(replayOf('best-of-three-2-1').fight);
    expect(rounds.rounds.map(({ round, winner, replayed }) => [round, winner, replayed])).toEqual([
      [0, 0, false],
      [1, 1, false],
      [2, 0, false],
    ]);
    expect(rounds.score).toEqual([2, 1]);
    expect(rounds.outcome).toMatchObject({ result: 'won', winner: 0 });
    expect(rounds.picks.every((side) => side.every((creature) => creature.fought))).toBe(true);
  });

  it('round replayed after a time-up tie: the level round is played again, then side 0 wins 2-0', () => {
    const rounds = roundsOf(replayOf('round-replayed-after-a-time-up-tie').fight);
    expect(rounds.rounds.map(({ round, winner, how, replayed }) => [round, winner, how, replayed])).toEqual([
      [0, null, 'timeUp', true],
      [0, 0, 'ringOut', false],
      [1, 0, 'ringOut', false],
    ]);
    expect(rounds.rounds[0]?.tick).toBe(content.arena.island.limitTicks);
    expect(rounds.outcome).toMatchObject({ result: 'won', winner: 0 });
    expect(rounds.picks[0][2]?.fought).toBe(false);
  });
});
