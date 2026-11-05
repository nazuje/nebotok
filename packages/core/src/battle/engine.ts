import { befriendChance, treatLiking } from '../befriend.ts';
import type { Rng } from '../rng.ts';
import type { BattleContent } from './content.ts';
import { battleCreature, damageOf, moveOf } from './damage.ts';
import {
  ACTION_ORDER,
  BattleError,
  BattleSetup,
  PLAYER_SIDE,
  SIDES,
  WILD_SIDE,
  activeCreature,
  creatureId,
  hasFainted,
  isDefeated,
  opponentOf,
  type BattleAction,
  type BattleActions,
  type BattleCreature,
  type BattleEvent,
  type BattleOutcome,
  type BattleState,
  type BattleStepResult,
  type FieldWeather,
  type SideIndex,
  type WildBattle,
} from './state.ts';

type DraftSide = { creatures: BattleCreature[]; active: number };
type Draft = {
  phase: BattleState['phase'];
  turn: number;
  weather: FieldWeather | null;
  sides: [DraftSide, DraftSide];
  mustSwap: [boolean, boolean];
  outcome: BattleOutcome | null;
  wild?: WildBattle;
};

/** Steps work on a copy, so the state passed in never changes. */
function draftOf(state: BattleState): Draft {
  const side = (at: SideIndex): DraftSide => ({ creatures: [...state.sides[at].creatures], active: state.sides[at].active });
  return { ...state, sides: [side(0), side(1)], mustSwap: [...state.mustSwap] };
}

function setupCreature(content: BattleContent, side: SideIndex, slot: number, setup: BattleSetup['sides'][number]['creatures'][number]): BattleCreature {
  const entry = content.species.get(setup.species);
  if (!entry) throw new BattleError(`unknown species "${setup.species}"`);
  const creature = battleCreature(creatureId(side, slot), entry, setup.level);
  for (const move of setup.moves ?? []) if (!content.moves.has(move)) throw new BattleError(`unknown move "${move}"`);
  return { ...creature, moves: setup.moves ?? creature.moves, hp: Math.min(setup.hp ?? creature.maxHp, creature.maxHp) };
}

/** Each side starts with its first creature that has health left. */
export function startBattle(setup: BattleSetup, content: BattleContent): BattleStepResult {
  const parsed = BattleSetup.parse(setup);
  if (parsed.weather !== null && !content.weather.has(parsed.weather)) throw new BattleError(`unknown weather "${parsed.weather}"`);
  const sides = SIDES.map((side): DraftSide => {
    const creatures = parsed.sides[side].creatures.map((entry, slot) => setupCreature(content, side, slot, entry));
    const active = creatures.findIndex((creature) => !hasFainted(creature));
    if (active < 0) throw new BattleError(`side ${side} has no creature that can battle`);
    return { creatures, active };
  });
  const [first, second] = sides as [DraftSide, DraftSide];
  const wildMaxHp = second.creatures[0]?.maxHp ?? 0;
  const wild: WildBattle | null = parsed.wild ? { treatHp: Math.floor((wildMaxHp * content.befriending.windowPercent) / 100) } : null;
  const state: BattleState = {
    phase: 'choose',
    turn: 0,
    weather: parsed.weather === null ? null : { type: parsed.weather, turnsLeft: null },
    sides: [first, second],
    mustSwap: [false, false],
    outcome: null,
    ...(wild ? { wild } : {}),
  };
  const events: BattleEvent[] = SIDES.map((side) => ({ kind: 'switched', side, from: null, to: activeCreature(state, side).id }));
  if (state.weather) events.push({ kind: 'weatherStarted', weather: state.weather.type, turns: null });
  return { state, events };
}

/**
 * Whether `side` may offer a treat now: only the player in a wild battle, while the wild creature
 * is up but worn down to `wild.treatHp` or less, or after it fainted (phase `befriend`). Which
 * treats the player has is the server's business, so `legalActions` never lists treats.
 */
export function canOfferTreat(state: BattleState, side: SideIndex): boolean {
  if (!state.wild || side !== PLAYER_SIDE) return false;
  if (state.phase === 'befriend') return true;
  if (state.phase !== 'choose') return false;
  const wild = activeCreature(state, WILD_SIDE);
  return !hasFainted(wild) && wild.hp <= state.wild.treatHp;
}

/**
 * Every action a side may take now, apart from treats (see `canOfferTreat`): moves first in slot
 * order, then switches in team order, then `run` for the player in a wild battle.
 */
export function legalActions(state: BattleState, side: SideIndex): readonly BattleAction[] {
  if (state.phase === 'over') return [];
  const canRun = state.wild !== undefined && side === PLAYER_SIDE;
  if (state.phase === 'befriend') return canRun ? [{ kind: 'run' }] : [];
  const { creatures, active } = state.sides[side];
  const switches = creatures.flatMap((creature, to): BattleAction[] => (to !== active && !hasFainted(creature) ? [{ kind: 'switch', to }] : []));
  if (state.phase === 'swap') return state.mustSwap[side] ? switches : [];
  const moves = activeCreature(state, side).moves.map((_move, slot): BattleAction => ({ kind: 'move', slot }));
  return canRun ? [...moves, ...switches, { kind: 'run' }] : [...moves, ...switches];
}

function sameAction(a: BattleAction, b: BattleAction): boolean {
  switch (a.kind) {
    case 'move':
      return b.kind === 'move' && a.slot === b.slot;
    case 'switch':
      return b.kind === 'switch' && a.to === b.to;
    case 'treat':
      return b.kind === 'treat' && a.item === b.item;
    case 'run':
      return b.kind === 'run';
  }
}

/** A side with no legal action must pass null; any other side must pick one of its legal actions, or a treat when it may offer one. */
export function isLegalAction(state: BattleState, side: SideIndex, action: BattleAction | null): boolean {
  if (action?.kind === 'treat') return canOfferTreat(state, side);
  const legal = legalActions(state, side);
  return action === null ? legal.length === 0 : legal.some((candidate) => sameAction(candidate, action));
}

function switchTo(draft: Draft, side: SideIndex, to: number, events: BattleEvent[]): void {
  const team = draft.sides[side];
  const from = team.creatures[team.active];
  const next = team.creatures[to];
  if (!from || !next) throw new BattleError(`side ${side} cannot switch to ${to}`);
  team.active = to;
  events.push({ kind: 'switched', side, from: from.id, to: next.id });
}

function activeOf(draft: Draft, side: SideIndex): BattleCreature {
  const creature = draft.sides[side].creatures[draft.sides[side].active];
  if (!creature) throw new BattleError(`side ${side} has no active creature`);
  return creature;
}

function useMove(draft: Draft, side: SideIndex, slot: number, rng: Rng, content: BattleContent, events: BattleEvent[]): void {
  const attacker = activeOf(draft, side);
  const targetSide = opponentOf(side);
  const target = activeOf(draft, targetSide);
  // A creature knocked out earlier in the turn does not get to move.
  if (hasFainted(attacker) || hasFainted(target)) return;
  const move = moveOf(content, attacker.moves[slot] ?? '');
  events.push({ kind: 'used', side, creature: attacker.id, move: move.id });
  if (rng.int(1, 100) > move.accuracy) {
    events.push({ kind: 'missed', side, creature: attacker.id, target: target.id });
    return;
  }
  if (move.power > 0) {
    const roll = damageOf(content, attacker, target, move, draft.weather, rng.int(content.rules.minRollPercent, 100));
    const hp = Math.max(0, target.hp - roll.damage);
    const team = draft.sides[targetSide];
    team.creatures[team.active] = { ...target, hp };
    events.push({ kind: 'hit', side, creature: attacker.id, target: target.id, damage: target.hp - hp, hp, effectiveness: roll.effectiveness, field: roll.field });
    if (hp === 0) events.push({ kind: 'fainted', side: targetSide, creature: target.id });
  }
  if (move.setsWeather !== undefined) {
    draft.weather = { type: move.setsWeather, turnsLeft: content.rules.weatherTurns };
    events.push({ kind: 'weatherStarted', weather: move.setsWeather, turns: content.rules.weatherTurns });
  }
}

function end(draft: Draft, outcome: BattleOutcome, events: BattleEvent[]): void {
  draft.phase = 'over';
  draft.outcome = outcome;
  draft.mustSwap = [false, false];
  events.push({ kind: 'ended', winner: outcome.winner, reason: outcome.reason });
}

/**
 * Offers a treat to the wild creature: one roll of `befriendChance`. Accepted, the battle ends as
 * `befriended`. Refused while the creature is up, the turn goes on; refused after it fainted, it
 * wanders off and the player has won.
 */
function offerTreat(draft: Draft, side: SideIndex, itemId: string, rng: Rng, content: BattleContent, events: BattleEvent[]): void {
  const target = activeOf(draft, opponentOf(side));
  const item = content.items.get(itemId);
  if (item?.kind !== 'treat') throw new BattleError(`"${itemId}" is not a treat`);
  const species = content.species.get(target.species);
  if (!species) throw new BattleError(`unknown species "${target.species}"`);
  const chance = befriendChance({ hp: target.hp, maxHp: target.maxHp, level: target.level, liking: treatLiking(item, species) }, content.befriending);
  const accepted = rng.int(1, 100) <= chance;
  events.push({ kind: 'treatOffered', side, item: item.id, target: target.id, chance, accepted });
  if (accepted) end(draft, { winner: side, reason: 'befriended' }, events);
  else if (draft.phase === 'befriend') end(draft, { winner: side, reason: 'fainted' }, events);
}

/** Running always works. Before the wild creature is beaten it is a run; after, the player simply leaves the battle they won. */
function run(draft: Draft, side: SideIndex, events: BattleEvent[]): void {
  events.push({ kind: 'ran', side });
  end(draft, draft.phase === 'befriend' ? { winner: side, reason: 'fainted' } : { winner: null, reason: 'ran' }, events);
}

type Resolver = (draft: Draft, side: SideIndex, action: BattleAction, rng: Rng, content: BattleContent, events: BattleEvent[]) => void;

/** One resolver per action kind; a new kind of action adds its resolver here. */
const RESOLVERS: Readonly<Record<BattleAction['kind'], Resolver>> = {
  switch: (draft, side, action, _rng, _content, events) => {
    if (action.kind === 'switch') switchTo(draft, side, action.to, events);
  },
  move: (draft, side, action, rng, content, events) => {
    if (action.kind === 'move') useMove(draft, side, action.slot, rng, content, events);
  },
  treat: (draft, side, action, rng, content, events) => {
    if (action.kind === 'treat') offerTreat(draft, side, action.item, rng, content, events);
  },
  run: (draft, side, _action, _rng, _content, events) => run(draft, side, events),
};

/** Who acts first: by kind of action, then the faster creature, then a seeded coin toss. */
function turnOrder(draft: Draft, actions: readonly [BattleAction, BattleAction], rng: Rng): readonly SideIndex[] {
  const rank = (side: SideIndex): number => ACTION_ORDER[actions[side].kind];
  const byRank = rank(0) - rank(1);
  if (byRank !== 0) return byRank < 0 ? [0, 1] : [1, 0];
  const bySpeed = activeOf(draft, 1).speed - activeOf(draft, 0).speed;
  if (bySpeed !== 0) return bySpeed < 0 ? [0, 1] : [1, 0];
  return rng.int(0, 1) === 0 ? [0, 1] : [1, 0];
}

/** At the turn limit, the side with the larger share of its team's health left wins. */
function healthLeader(draft: Draft): SideIndex | null {
  const share = draft.sides.map((side) => ({
    hp: side.creatures.reduce((sum, creature) => sum + creature.hp, 0),
    max: side.creatures.reduce((sum, creature) => sum + creature.maxHp, 0),
  }));
  const [a, b] = share as [{ hp: number; max: number }, { hp: number; max: number }];
  const difference = a.hp * b.max - b.hp * a.max;
  if (difference === 0) return null;
  return difference > 0 ? 0 : 1;
}

function endTurn(draft: Draft, content: BattleContent, events: BattleEvent[]): void {
  draft.turn += 1;
  const { weather } = draft;
  if (weather && weather.turnsLeft !== null) {
    const turnsLeft = weather.turnsLeft - 1;
    draft.weather = turnsLeft > 0 ? { type: weather.type, turnsLeft } : null;
    if (turnsLeft === 0) events.push({ kind: 'weatherEnded', weather: weather.type });
  }
  const defeated = SIDES.filter((side) => isDefeated(draft.sides[side]));
  if (draft.wild && defeated.length === 1 && defeated[0] === WILD_SIDE) {
    draft.phase = 'befriend';
    events.push({ kind: 'canBefriend', creature: activeOf(draft, WILD_SIDE).id });
    return;
  }
  if (defeated.length > 0) {
    end(draft, { winner: defeated.length === 1 ? opponentOf(defeated[0] as SideIndex) : null, reason: 'fainted' }, events);
    return;
  }
  if (draft.turn >= content.rules.turnLimit) {
    end(draft, { winner: healthLeader(draft), reason: 'turnLimit' }, events);
    return;
  }
  for (const side of SIDES) {
    draft.mustSwap[side] = hasFainted(activeOf(draft, side));
    if (draft.mustSwap[side]) events.push({ kind: 'mustSwap', side });
  }
  draft.phase = draft.mustSwap.includes(true) ? 'swap' : 'choose';
}

/**
 * Advances a battle by one step. In `choose` both sides act and a turn resolves; in `swap` the
 * sides that must swap send out a creature; in `befriend` the player offers a treat or runs. Throws
 * a BattleError on an illegal action; check `isLegalAction` first. The same state, actions and RNG
 * state always give the same result.
 */
export function battleStep(state: BattleState, actions: BattleActions, rng: Rng, content: BattleContent): BattleStepResult {
  if (state.phase === 'over') throw new BattleError('the battle is over');
  for (const side of SIDES) {
    if (!isLegalAction(state, side, actions[side])) throw new BattleError(`side ${side} cannot ${JSON.stringify(actions[side])} in ${state.phase}`);
  }
  const draft = draftOf(state);
  const events: BattleEvent[] = [];
  const [first, second] = actions;
  if (state.phase === 'swap') {
    for (const side of SIDES) {
      const action = actions[side];
      if (action?.kind === 'switch') switchTo(draft, side, action.to, events);
    }
    draft.mustSwap = [false, false];
    draft.phase = 'choose';
    return { state: draft, events };
  }
  if (state.phase === 'befriend') {
    const action = actions[PLAYER_SIDE];
    if (action) RESOLVERS[action.kind](draft, PLAYER_SIDE, action, rng, content, events);
    return { state: draft, events };
  }
  if (!first || !second) throw new BattleError('both sides must act in a turn');
  events.push({ kind: 'turnStarted', turn: draft.turn + 1 });
  const chosen: readonly [BattleAction, BattleAction] = [first, second];
  for (const side of turnOrder(draft, chosen, rng)) {
    // A run or an accepted treat ends the battle before the other side acts.
    if (draft.phase === 'over') break;
    const action = chosen[side];
    RESOLVERS[action.kind](draft, side, action, rng, content, events);
  }
  if (draft.phase !== 'over') endTurn(draft, content, events);
  return { state: draft, events };
}
