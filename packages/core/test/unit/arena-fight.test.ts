import { describe, expect, it } from 'vitest';
import {
  ARENA_IDLE,
  DUEL_XP_PERCENT,
  ENTRY_GRACE_TICKS,
  TRAINER_LOSS_XP_PERCENT,
  TREAT_WINDOW_CAP_PERCENT,
  arenaRewards,
  arenaWildSetup,
  bestTreat,
  duelRewards,
  fightStart,
  fightStep,
  gaveUpInFirstRound,
  maxHpOf,
  newCreature,
  roundsGiveUp,
  teamAfterFight,
  teamRested,
  trainerRewards,
  treatRadius,
  treatWindowOpen,
  treatWindowPercent,
  xpForWin,
  type ArenaFight,
  type ArenaInput,
  type ArenaInputs,
  type Body,
  type FightContent,
  type FightEvent,
  type FightTreat,
  type RoundsFight,
  type WildFight,
  type WildFightSetup,
} from '../../src/index.ts';
import { fightContent as content } from '../support/arena-content.ts';
import { battleContent } from '../support/battle-content.ts';
import { fighter, loadoutWith, stick } from '../support/arena-fighters.ts';

const rules = content.arena;
const UNIT = 256;
const glowbun = content.species.get('glowbun')!;

function wildSetup(overrides: Partial<WildFightSetup> = {}): WildFightSetup {
  return {
    mode: 'wild',
    seed: 'arena-fight',
    team: [
      { place: 0, hp: 9999, fighter: fighter('puddlepip', { id: 'a1', level: 12, loadout: loadoutWith('rain-tap') }) },
      { place: 1, hp: 9999, fighter: fighter('pinwhirl', { id: 'a2', level: 12 }) },
    ],
    wild: fighter('glowbun', { id: 'b1', computer: true }),
    treats: [{ item: 'sun-treat', count: 2 }],
    ...overrides,
  };
}

const choose = (bag: readonly { item: string; count: number }[]) => bestTreat(bag, glowbun, content.items);
const pick = (species: string, place: number | null = null) => ({ place, fighter: fighter(species, { id: `${species}-${place}`, level: 12 }) });

const wildOf = (fight: ArenaFight): WildFight => {
  if (fight.mode !== 'wild') throw new Error('expected a wild fight');
  return fight;
};
const roundsOf = (fight: ArenaFight): RoundsFight => {
  if (fight.mode !== 'rounds') throw new Error('expected a best of 3');
  return fight;
};

function hold(fight: ArenaFight, inputs: ArenaInputs, ticks: number, using: FightContent = content): { fight: ArenaFight; events: FightEvent[] } {
  const events: FightEvent[] = [];
  let now = fight;
  for (let tick = 0; tick < ticks && !now.outcome; tick += 1) {
    const step = fightStep(now, inputs, using);
    now = step.fight;
    events.push(...step.events);
  }
  return { fight: now, events };
}

/** The wild fight with the bodies changed: side 0 at x = -apart/2, side 1 at +apart/2, both facing each other. */
function facing(fight: WildFight, apart: number, wild: Partial<Body> = {}): WildFight {
  const [mine, other] = fight.island.bodies;
  const half = (apart * UNIT) / 2;
  return { ...fight, island: { ...fight.island, bodies: [{ ...mine, x: -half, y: 0, facing: 0 }, { ...other, x: half, y: 0, facing: 8, ...wild }] } };
}

const press = (input: Partial<ArenaInput>): ArenaInputs => [{ ...ARENA_IDLE, ...input }, ARENA_IDLE];
const kindsOf = (events: readonly FightEvent[]) => events.map((event) => event.kind);

describe('treats', () => {
  it('opens the window at 30%, 35% for a liked treat and 40% for a favourite, plus a cooked treat strength, at most 45%', () => {
    expect(treatWindowPercent({ liking: 'none', strength: 0 }, rules)).toBe(30);
    expect(treatWindowPercent({ liking: 'liked', strength: 0 }, rules)).toBe(35);
    expect(treatWindowPercent({ liking: 'favourite', strength: 0 }, rules)).toBe(40);
    expect(treatWindowPercent({ liking: 'none', strength: 10 }, rules)).toBe(40);
    expect(treatWindowPercent({ liking: 'liked', strength: 5 }, rules)).toBe(40);
    expect(treatWindowPercent({ liking: 'favourite', strength: 20 }, rules)).toBe(TREAT_WINDOW_CAP_PERCENT);
    expect(treatWindowPercent({ liking: 'none', strength: 30 }, rules)).toBe(TREAT_WINDOW_CAP_PERCENT);
  });

  it('opens only while the wild creature is under its window and on the island', () => {
    const body = fightStart(wildSetup(), content).island.bodies[1];
    const plain = { liking: 'none', strength: 0 } as const;
    const at = (percent: number): Body => ({ ...body, health: Math.trunc((body.maxHealth * percent) / 100) });
    expect(treatWindowOpen(plain, at(31), rules)).toBe(false);
    expect(treatWindowOpen(plain, at(29), rules)).toBe(true);
    expect(treatWindowOpen({ liking: 'favourite', strength: 0 }, at(39), rules)).toBe(true);
    expect(treatWindowOpen(plain, { ...at(10), out: true }, rules)).toBe(false);
    expect(treatWindowOpen(plain, at(0), rules)).toBe(false);
  });

  it('flies bigger for a liked treat and bigger still for a favourite', () => {
    expect([treatRadius('none', rules), treatRadius('liked', rules), treatRadius('favourite', rules)]).toEqual([26, 33, 40]);
  });

  it('chooses the favourite, then the strongest liked one, then the strongest plain one', () => {
    // glowbun is a sun creature whose favourite is berry-bun.
    expect(choose([{ item: 'plain-treat', count: 1 }, { item: 'sun-treat', count: 1 }, { item: 'sunroot-bake', count: 1 }, { item: 'berry-bun', count: 1 }])).toEqual({ item: 'berry-bun', liking: 'favourite', strength: 5 });
    expect(choose([{ item: 'plain-treat', count: 1 }, { item: 'sun-treat', count: 1 }, { item: 'sunroot-bake', count: 1 }])).toEqual({ item: 'sunroot-bake', liking: 'liked', strength: 15 });
    expect(choose([{ item: 'plain-treat', count: 1 }, { item: 'frost-pudding', count: 1 }, { item: 'rain-treat', count: 1 }])).toEqual({ item: 'frost-pudding', liking: 'none', strength: 20 });
    expect(choose([{ item: 'rain-treat', count: 1 }, { item: 'gale-treat', count: 1 }])).toEqual({ item: 'gale-treat', liking: 'none', strength: 0 });
    expect(choose([{ item: 'berry-bun', count: 0 }, { item: 'cloudberry', count: 3 }])).toBeNull();
  });

  it('refuses the treat button while the window is shut, and throws the best treat, used up, once it opens', () => {
    const fight = facing(wildOf(fightStart(wildSetup(), content)), 400);
    expect(kindsOf(hold(fight, press({ treat: true }), 1).events)).not.toContain('treatThrown');
    const weak = facing(fight, 400, { health: 10 });
    const thrown = hold(weak, press({ treat: true }), 1);
    expect(thrown.events).toContainEqual({ kind: 'treatThrown', item: 'sun-treat', liking: 'liked' });
    expect(wildOf(thrown.fight).treats).toEqual([{ item: 'sun-treat', count: 1 }]);
    expect(wildOf(thrown.fight).treat?.radius).toBe(33 * UNIT);
  });

  it('befriends when the treat touches the wild creature', () => {
    const fight = facing(wildOf(fightStart(wildSetup(), content)), 400, { health: 10 });
    const { fight: after, events } = hold(fight, press({ treat: true }), 60);
    expect(wildOf(after).outcome?.result).toBe('befriended');
    expect(events).toContainEqual({ kind: 'befriended', species: 'glowbun', level: 10 });
  });

  it('lets the wild creature eat a treat on the ground and heal 10%, then waits 120 ticks for the next', () => {
    const start = facing(wildOf(fightStart(wildSetup(), content)), 400, { health: 10 });
    const wild = start.island.bodies[1];
    const ground: FightTreat = { item: 'sun-treat', liking: 'liked', x: wild.x, y: wild.y, vx: 0, vy: 0, radius: 33 * UNIT, ticks: 300, landed: true };
    const { fight, events } = hold({ ...start, treat: ground }, press({}), 1);
    const amount = Math.trunc(wild.maxHealth / 10);
    expect(events).toContainEqual({ kind: 'treatEaten', item: 'sun-treat', amount, health: 10 + amount });
    expect(wildOf(fight).treatWait).toBe(rules.treat.againTicks);
    expect(kindsOf(hold(fight, press({ treat: true }), rules.treat.againTicks - 1).events)).not.toContain('treatThrown');
  });

  it('gives a treat back when your creature walks over it, and loses one left on the ground for 300 ticks', () => {
    const start = facing(wildOf(fightStart(wildSetup(), content)), 400, { health: 10 });
    const mine = start.island.bodies[0];
    const ground: FightTreat = { item: 'sun-treat', liking: 'liked', x: mine.x, y: mine.y, vx: 0, vy: 0, radius: 33 * UNIT, ticks: 300, landed: true };
    const picked = hold({ ...start, treat: ground }, press({}), 1);
    expect(picked.events).toContainEqual({ kind: 'treatPickedUp', item: 'sun-treat' });
    expect(wildOf(picked.fight).treats).toEqual([{ item: 'sun-treat', count: 3 }]);
    const lying = hold({ ...start, treat: { ...ground, x: 0, y: -300 * UNIT } }, press({}), 300);
    expect(kindsOf(lying.events)).toContain('treatLost');
    expect(wildOf(lying.fight).treat).toBeNull();
  });
});

describe('wild fights', () => {
  it('swaps to the next standing creature at the centre-left with a grace, then cools down for 300 ticks', () => {
    const fight = fightStart(wildSetup(), content);
    const { fight: swapped, events } = hold(fight, press({ swap: true }), 1);
    const wild = wildOf(swapped);
    expect(events).toContainEqual({ kind: 'swapped', from: 0, to: 1 });
    expect(wild.active).toBe(1);
    expect(wild.island.bodies[0].species).toBe('pinwhirl');
    expect(wild.island.bodies[0].graceTicks).toBe(ENTRY_GRACE_TICKS - 1);
    expect(wild.team.map((creature) => creature.fought)).toEqual([true, true]);
    expect(kindsOf(hold(swapped, press({ swap: true }), rules.swap.cooldownTicks - 1).events)).not.toContain('swapped');
    expect(kindsOf(hold(swapped, press({ swap: true }), rules.swap.cooldownTicks).events)).toContain('swapped');
  });

  it('cannot be hit during its grace', () => {
    const setup = wildSetup({ wild: fighter('glowbun', { id: 'b1', level: 20, loadout: loadoutWith('heat-shimmer') }) });
    const swapped = wildOf(hold(fightStart(setup, content), press({ swap: true }), 1).fight);
    const close = facing(swapped, 120);
    const pressing: ArenaInputs = [ARENA_IDLE, stick(8, 0)];
    expect(kindsOf(hold(close, pressing, 2).events)).toContain('cast');
    expect(hold(close, pressing, 2).events.filter((event) => event.kind === 'hit')).toEqual([]);
    const late = { ...close, island: { ...close.island, bodies: [{ ...close.island.bodies[0], graceTicks: 0 }, close.island.bodies[1]] as const } };
    expect(hold(late, pressing, 2).events.filter((event) => event.kind === 'hit' && event.side === 0)).toHaveLength(1);
  });

  it('ends as ran when you leave, with no experience', () => {
    const { fight } = hold(fightStart(wildSetup(), content), press({ leave: true }), 1);
    expect(wildOf(fight).outcome).toEqual({ result: 'ran', tick: 1 });
    const team = [newCreature('puddlepip', 12, battleContent), newCreature('pinwhirl', 12, battleContent)];
    expect(arenaRewards(teamAfterFight(team, fight, content), wildOf(fight), battleContent).rewards).toEqual([]);
  });

  it('ends at the time limit as timeUp, which still gives experience to the creatures that fought', () => {
    const quick = { ...content, arena: { ...rules, island: { ...rules.island, limitTicks: 30 } } };
    const { fight } = hold(fightStart(wildSetup(), quick), press({}), 40, quick);
    expect(wildOf(fight).outcome).toEqual({ result: 'timeUp', tick: 30 });
    const team = [newCreature('puddlepip', 12, battleContent), newCreature('pinwhirl', 12, battleContent)];
    expect(arenaRewards(team, wildOf(fight), battleContent).rewards).toEqual([{ index: 0, xp: xpForWin(10), level: expect.any(Number) }]);
  });

  it('saves arena health back rounded up, and keeps creatures that stayed off the island as they were', () => {
    const fight = wildOf(fightStart(wildSetup(), content));
    const hurt: WildFight = { ...fight, team: [{ ...fight.team[0]!, health: 15 }, fight.team[1]!] };
    const team = [newCreature('puddlepip', 12, battleContent), { ...newCreature('pinwhirl', 12, battleContent), hp: 5 }];
    expect(teamAfterFight(team, hurt, content).map((creature) => creature.hp)).toEqual([3, 5]);
  });

  it('rests the whole team to full health after a lost fight, and leaves it as it is after any other', () => {
    const fight = wildOf(fightStart(wildSetup(), content));
    const team = [{ ...newCreature('puddlepip', 12, battleContent), hp: 0 }, { ...newCreature('pinwhirl', 12, battleContent), hp: 5 }, { ...newCreature('glowbun', 6, battleContent), hp: 0 }];
    const lost: WildFight = { ...fight, outcome: { result: 'lost', tick: 90 } };
    expect(teamRested(team, lost, content).map((creature) => creature.hp)).toEqual(team.map((creature) => maxHpOf(creature, battleContent)));
    for (const result of ['won', 'wonByRingOut', 'befriended', 'ran', 'timeUp'] as const) {
      expect(teamRested(team, { ...fight, outcome: { result, tick: 90 } }, content)).toEqual(team);
    }
    expect(teamRested(team, fight, content)).toEqual(team);
  });
});

describe('setting up a wild fight', () => {
  it('takes the standing team in order, with their loadouts and the turtle setting, and the treats in the bag', () => {
    const team = [{ ...newCreature('glowbun', 8, battleContent), hp: 0 }, newCreature('puddlepip', 12, battleContent), newCreature('pinwhirl', 3, battleContent)];
    const setup = arenaWildSetup({
      seed: 7,
      team,
      wild: { species: 'snowsnoot', level: 9 },
      wildLoadout: loadoutWith('frost-tap'),
      turtle: true,
      inventory: [{ item: 'cloudberry', count: 4 }, { item: 'sun-treat', count: 2 }, { item: 'plain-treat', count: 0 }],
      content: battleContent,
    });
    expect(setup.team.map(({ place, hp, fighter: { id, species, turtle, loadout } }) => ({ place, hp, id, species, turtle, loadout }))).toEqual([
      { place: 1, hp: team[1]!.hp, id: 'a2', species: 'puddlepip', turtle: true, loadout: team[1]!.loadout },
      { place: 2, hp: team[2]!.hp, id: 'a3', species: 'pinwhirl', turtle: true, loadout: team[2]!.loadout },
    ]);
    expect(setup.wild).toEqual({ id: 'b1', species: 'snowsnoot', level: 9, loadout: loadoutWith('frost-tap'), turtle: false, computer: true });
    expect(setup.treats).toEqual([{ item: 'sun-treat', count: 2 }]);
    expect(wildOf(fightStart(setup, content)).island.bodies[0].health).toBe(team[1]!.hp * rules.island.hpScale);
    expect(setup).not.toHaveProperty('weather');
    expect(wildOf(fightStart(setup, content)).island.weather).toBeNull();
  });

  it('puts the zone’s weather on the island for the whole fight', () => {
    const team = [newCreature('puddlepip', 12, battleContent)];
    const setup = arenaWildSetup({ seed: 7, team, wild: { species: 'glowbun', level: 9 }, wildLoadout: loadoutWith('sun-tap'), turtle: false, inventory: [], content: battleContent, weather: 'rain' });
    expect(setup.weather).toBe('rain');
    const fight = wildOf(fightStart(setup, content));
    expect(fight.island.weather).toEqual({ type: 'rain', ticks: rules.island.limitTicks });
    expect(wildOf(hold(fight, press({}), 600).fight).island.weather).toEqual({ type: 'rain', ticks: rules.island.limitTicks - 600 });
  });
});

describe('best of 3', () => {
  const quick = { ...content, arena: { ...rules, island: { ...rules.island, limitTicks: 30 } } };

  it('replays a level round once, then counts it a draw; a side short of creatures loses the rounds it cannot fill', () => {
    const fight = fightStart({ mode: 'rounds', seed: 3, picks: [[pick('glowbun', 0)], [pick('glowbun'), pick('puddlepip'), pick('pinwhirl')]] }, quick);
    const { fight: ended, events } = hold(fight, [ARENA_IDLE, ARENA_IDLE], 200, quick);
    const rounds = roundsOf(ended);
    expect(rounds.rounds.map(({ round, winner, how, replayed }) => [round, winner, how, replayed])).toEqual([
      [0, null, 'timeUp', true],
      [0, null, 'timeUp', false],
      [1, 1, 'forfeit', false],
      [2, 1, 'forfeit', false],
    ]);
    expect(rounds.score).toEqual([0, 2]);
    expect(rounds.outcome).toEqual({ result: 'lost', winner: 1, tick: 60 });
    expect(events.filter((event) => event.kind === 'roundEnded')).toHaveLength(4);
  });

  it('ends after the last round on the score, level a draw', () => {
    const fight = fightStart({ mode: 'rounds', seed: 4, picks: [[pick('glowbun', 0)], [pick('glowbun')]] }, quick);
    expect(roundsOf(hold(fight, [ARENA_IDLE, ARENA_IDLE], 200, quick).fight).outcome).toEqual({ result: 'draw', winner: null, tick: 60 });
  });

  it('gives each creature that fought a quarter of a win against the creature it faced, win or lose, and changes no health', () => {
    const fight = fightStart({ mode: 'rounds', seed: 5, picks: [[pick('glowbun', 0), pick('puddlepip', 2)], [pick('baskit'), pick('snowsnoot')]] }, quick);
    const ended = roundsOf(hold(fight, [ARENA_IDLE, ARENA_IDLE], 400, quick).fight);
    const team = [newCreature('glowbun', 12, battleContent), newCreature('pinwhirl', 12, battleContent), { ...newCreature('puddlepip', 12, battleContent), hp: 4 }];
    expect(teamAfterFight(team, ended, content)).toEqual(team);
    const share = Math.trunc((xpForWin(12) * DUEL_XP_PERCENT) / 100);
    expect(duelRewards(team, ended, 0, battleContent).rewards.map(({ index, xp }) => [index, xp])).toEqual([
      [0, share],
      [2, share],
    ]);
    expect(duelRewards(team, ended, 1, battleContent).rewards).toEqual([]);
  });

  it('gives no duel experience to a side that gave up in the first round, and the other side its share', () => {
    const picks = [[pick('glowbun', 0), pick('puddlepip', 1)], [pick('baskit', 0), pick('snowsnoot', 1)]] as const;
    const team = [newCreature('glowbun', 12, battleContent), newCreature('puddlepip', 12, battleContent)];
    const share = Math.trunc((xpForWin(12) * DUEL_XP_PERCENT) / 100);
    const early = roundsOf(roundsGiveUp(roundsOf(hold(fightStart({ mode: 'rounds', seed: 6, picks: [[...picks[0]], [...picks[1]]] }, content), [ARENA_IDLE, ARENA_IDLE], 30).fight), 0).fight);
    expect(gaveUpInFirstRound(early, 0)).toBe(true);
    expect(gaveUpInFirstRound(early, 1)).toBe(false);
    expect(duelRewards(team, early, 0, battleContent).rewards).toEqual([]);
    expect(duelRewards(team, early, 1, battleContent).rewards.map(({ index, xp }) => [index, xp])).toEqual([[0, share]]);
    // Giving up after the first round keeps the share for every creature that fought.
    const played = roundsOf(hold(fightStart({ mode: 'rounds', seed: 6, picks: [[...picks[0]], [...picks[1]]] }, quick), [ARENA_IDLE, ARENA_IDLE], 70, quick).fight);
    expect(played.round).toBe(1);
    const late = roundsOf(roundsGiveUp(played, 0).fight);
    expect(gaveUpInFirstRound(late, 0)).toBe(false);
    expect(duelRewards(team, late, 0, battleContent).rewards.map(({ index, xp }) => [index, xp])).toEqual([
      [0, share],
      [1, share],
    ]);
  });

  it('gives a trainer fight’s full share after a win and half of it after a loss or a draw', () => {
    const team = [newCreature('glowbun', 12, battleContent)];
    const full = Math.trunc((xpForWin(12) * 50) / 100);
    const half = Math.trunc((full * TRAINER_LOSS_XP_PERCENT) / 100);
    const fight = roundsOf(hold(fightStart({ mode: 'rounds', seed: 7, picks: [[pick('glowbun', 0)], [pick('glowbun')]] }, quick), [ARENA_IDLE, ARENA_IDLE], 200, quick).fight);
    const xpAfter = (winner: 0 | 1 | null) => trainerRewards(team, { ...fight, outcome: { result: winner === 0 ? 'won' : winner === 1 ? 'lost' : 'draw', winner, tick: 60 } }, 0, 50, battleContent).rewards.map(({ xp }) => xp);
    expect(half).toBeGreaterThan(0);
    expect(xpAfter(0)).toEqual([full]);
    expect(xpAfter(1)).toEqual([half]);
    expect(xpAfter(null)).toEqual([half]);
  });
});
