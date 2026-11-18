import { maxHpAt } from '../battle/damage.ts';
import { aimOf, isBusy } from './abilities.ts';
import { percentOf } from './fixed.ts';
import type { FightCreature, FightEvent, FightStepResult, WildFight, WildFightSetup, WildResult } from './fight-state.ts';
import type { FightContent } from './rules.ts';
import { arenaStart, startBody, type ArenaFighter, type ArenaInput, type ArenaInputs, type ArenaState, type Body } from './state.ts';
import { arenaStep } from './step.ts';
import { bestTreat, eatenHealth, moveTreat, throwTreat, treatWindowOpen, treatsWith } from './treats.ts';

/**
 * A wild fight (docs/arena.md, "Fight modes"): the team in order against one wild creature, with
 * Swap, Treat and Leave. The island runs on through swaps and knockouts; only the time limit,
 * the wild creature down, a befriending treat, the whole team down or leaving end it.
 */

/** A creature that comes onto the island cannot be hit, bumped or knocked for this long. */
export const ENTRY_GRACE_TICKS = 60;
/** It comes in this share of the island's radius left of the centre, where side 0 starts. */
const ENTRY_PERCENT = 45;

const down = (ticks: number): number => Math.max(0, ticks - 1);

function speciesOf(fighter: ArenaFighter, content: FightContent) {
  const species = content.species.get(fighter.species);
  if (!species) throw new RangeError(`arena: no species "${fighter.species}"`);
  return species;
}

/** A team creature at its real health, scaled to the arena's. */
function teamCreature({ place, fighter, hp }: WildFightSetup['team'][number], content: FightContent): FightCreature {
  const scale = content.arena.island.hpScale;
  const full = maxHpAt(speciesOf(fighter, content), fighter.level);
  return { place, fighter, health: Math.min(hp, full) * scale, maxHealth: full * scale, fought: false, out: false };
}

const fighterOfBody = (body: Body): ArenaFighter => ({ id: body.id, species: body.species, level: body.level, loadout: body.loadout, turtle: body.turtle, computer: body.computer });

export function wildStart(setup: WildFightSetup, content: FightContent): WildFight {
  const team = setup.team.map((entry) => teamCreature(entry, content));
  const lead = team[0];
  if (!lead) throw new RangeError('arena: a wild fight needs a creature that can fight');
  const island = arenaStart({ seed: setup.seed, fighters: [lead.fighter, setup.wild] }, content);
  const [mine, wild] = island.bodies;
  return {
    mode: 'wild',
    tick: 0,
    island: { ...island, bodies: [{ ...mine, health: lead.health }, wild] },
    team: team.with(0, { ...lead, fought: true }),
    active: 0,
    swapCooldown: 0,
    treats: setup.treats,
    treat: null,
    treatWait: 0,
    outcome: null,
  };
}

/** The next creature after `active`, in team order and round again, that can still fight. */
function nextStanding(team: readonly FightCreature[], active: number): number | null {
  for (let step = 1; step < team.length; step += 1) {
    const at = (active + step) % team.length;
    const creature = team[at];
    if (creature && creature.health > 0 && !creature.out) return at;
  }
  return null;
}

/** The team with the island's side-0 body's health and fall written back to the creature it carries. */
function withBodyBack(team: readonly FightCreature[], active: number, body: Body): readonly FightCreature[] {
  const creature = team[active];
  return creature ? team.with(active, { ...creature, health: body.health, out: body.out }) : team;
}

/** Brings the team creature at `at` onto the island at the centre-left, with its health and a grace. */
function enter(island: ArenaState, team: readonly FightCreature[], at: number, content: FightContent, events: FightEvent[]): Pick<WildFight, 'island' | 'team' | 'active'> {
  const creature = team[at];
  if (!creature) throw new RangeError(`arena: no team creature at ${at}`);
  const wild = island.bodies[1];
  const fresh = startBody(0, creature.fighter, fighterOfBody(wild), content);
  const body: Body = { ...fresh, x: -percentOf(island.radius, ENTRY_PERCENT), health: creature.health, graceTicks: ENTRY_GRACE_TICKS };
  events.push({ kind: 'entered', side: 0, id: creature.fighter.id, place: creature.place });
  return { island: { ...island, bodies: [body, wild], outcome: null }, team: team.with(at, { ...creature, fought: true }), active: at };
}

function ended(fight: WildFight, result: WildResult, events: FightEvent[]): FightStepResult {
  events.push({ kind: 'fightEnded', result });
  const team = withBodyBack(fight.team, fight.active, fight.island.bodies[0]);
  return { fight: { ...fight, team, treat: null, outcome: { result, tick: fight.tick } }, events };
}

/** Swap (Q): the next standing creature comes in, if the swap has cooled down and the one on the island is free to go. */
function swapped(fight: WildFight, content: FightContent, events: FightEvent[]): WildFight {
  const body = fight.island.bodies[0];
  const next = nextStanding(fight.team, fight.active);
  if (fight.swapCooldown > 0 || next === null || isBusy(body) || body.dashTicks > 0) return fight;
  const from = fight.team[fight.active]?.place ?? null;
  const team = withBodyBack(fight.team, fight.active, body);
  events.push({ kind: 'swapped', from, to: team[next]?.place ?? null });
  return { ...fight, ...enter(fight.island, team, next, content, events), swapCooldown: content.arena.swap.cooldownTicks };
}

/**
 * Treat (E): throws the best treat in the bag, if none is out already and the wild creature is
 * weak enough for it. It goes where the stick turns the creature this tick, as an ability would.
 */
function thrown(fight: WildFight, input: ArenaInput, content: FightContent, events: FightEvent[]): WildFight {
  const [body, wild] = fight.island.bodies;
  if (fight.treat !== null || fight.treatWait > 0 || isBusy(body)) return fight;
  const choice = bestTreat(fight.treats, speciesOf(fighterOfBody(wild), content), content.items);
  const rules = content.arena;
  if (!choice || !treatWindowOpen(choice, wild, rules)) return fight;
  const steered: Body = { ...body, facing: input.dir ?? body.facing };
  events.push({ kind: 'treatThrown', item: choice.item, liking: choice.liking });
  return { ...fight, treats: treatsWith(fight.treats, choice.item, -1), treat: throwTreat(steered, aimOf([steered, wild], 0, rules), choice, rules) };
}

/** The thrown treat's tick, after the island's. Returns whether it befriended the wild creature. */
function treatTick(fight: WildFight, content: FightContent, events: FightEvent[]): { readonly fight: WildFight; readonly befriended: boolean } {
  const { treat, island } = fight;
  if (!treat) return { fight, befriended: false };
  const rules = content.arena;
  const moved = moveTreat(treat, island.bodies, island.radius, rules);
  const { item } = treat;
  switch (moved.kind) {
    case 'flying':
    case 'lying':
      return { fight: { ...fight, treat: moved.treat }, befriended: false };
    case 'landed':
      events.push({ kind: 'treatLanded', item, x: moved.treat.x, y: moved.treat.y });
      return { fight: { ...fight, treat: moved.treat }, befriended: false };
    case 'befriended':
      return { fight: { ...fight, treat: null }, befriended: true };
    case 'pickedUp':
      events.push({ kind: 'treatPickedUp', item });
      return { fight: { ...fight, treat: null, treats: treatsWith(fight.treats, item, 1) }, befriended: false };
    case 'eaten': {
      const [mine, wild] = island.bodies;
      const { health, amount } = eatenHealth(wild);
      events.push({ kind: 'treatEaten', item, amount, health });
      return { fight: { ...fight, treat: null, treatWait: rules.treat.againTicks, island: { ...island, bodies: [mine, { ...wild, health }] } }, befriended: false };
    }
    case 'lost':
      events.push({ kind: 'treatLost', item });
      return { fight: { ...fight, treat: null, treatWait: rules.treat.againTicks }, befriended: false };
  }
}

/**
 * How the island's step ends the fight, or carries it on: the wild creature down wins, with a
 * ring-out its own result; the time limit is `timeUp`; your creature down brings in the next
 * standing one, and with none left the fight is lost.
 */
function settled(fight: WildFight, content: FightContent, events: FightEvent[]): FightStepResult {
  const { outcome, bodies } = fight.island;
  if (!outcome) return { fight, events };
  const [mine, wild] = bodies;
  if (wild.health === 0) return ended(fight, 'won', events);
  if (wild.out) return ended(fight, 'wonByRingOut', events);
  if (outcome.how === 'timeUp') return ended(fight, 'timeUp', events);
  const team = withBodyBack(fight.team, fight.active, mine);
  const next = nextStanding(team, fight.active);
  if (next === null) return ended({ ...fight, team }, 'lost', events);
  return { fight: { ...fight, ...enter(fight.island, team, next, content, events) }, events };
}

/** One tick of a wild fight: leave, swap, treat, the island's step, the treat's flight, then the ending. */
export function wildStep(fight: WildFight, inputs: ArenaInputs, content: FightContent): FightStepResult {
  if (fight.outcome) return { fight, events: [] };
  const [mine] = inputs;
  const events: FightEvent[] = [];
  let next: WildFight = { ...fight, tick: fight.tick + 1, swapCooldown: down(fight.swapCooldown), treatWait: down(fight.treatWait) };
  if (mine.leave) return ended(next, 'ran', events);
  if (mine.swap) next = swapped(next, content, events);
  if (mine.treat) next = thrown(next, mine, content, events);
  const step = arenaStep(next.island, inputs, content);
  events.push(...step.events);
  const flown = treatTick({ ...next, island: step.state }, content, events);
  const wild = flown.fight.island.bodies[1];
  if (flown.befriended && wild.health > 0 && !wild.out) {
    events.push({ kind: 'befriended', species: wild.species, level: wild.level });
    return ended(flown.fight, 'befriended', events);
  }
  return settled(flown.fight, content, events);
}
