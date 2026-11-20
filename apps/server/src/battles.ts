import {
  MAX_TEAM,
  PLAYER_SIDE,
  STORAGE_LIMIT,
  WILD_SIDE,
  activeCreature,
  addCreature,
  arenaContentOf,
  arenaRewards,
  awardXp,
  battleStep,
  befriendedCreature,
  befriendedFromFight,
  canBattle,
  createRng,
  duelRewards,
  greedyPolicy,
  hasRoomForCreature,
  inventoryAfterFight,
  isLegalAction,
  learnTeamMoves,
  learnedBy,
  legalActions,
  markBefriended,
  randomPolicy,
  rngFromState,
  sentOut,
  startBattle,
  teamAfterBattle,
  teamAfterFight,
  useItem,
  wildBattleSetup,
  type ArenaBefriended,
  type ArenaFight,
  type BattleAction,
  type BattleContent,
  type BattleEvent,
  type BattleOutcome,
  type BattleState,
  type CreatureInstance,
  type CreatureReward,
  type EncounterZone,
  type LearnedMove,
  type PendingMove,
  type Progress,
  type RefusalReason,
  type Rng,
  type RoundsOutcome,
  type Side,
  type WildEncounter,
} from '@nebotok/core';

/** A battle with no request from its player for this long ends as a run, connected or not. */
export const BATTLE_IDLE_MS = 120_000;

/** A wild battle in progress. It lives only in the server's memory, on its player's seat. */
export type LiveBattle = {
  readonly id: string;
  readonly zone: string;
  state: BattleState;
  /** Every event since the start, start events included: experience goes to the creatures they show sent out. */
  readonly events: BattleEvent[];
  /** The battle's own numbers and the wild creature's choices come from separate RNGs, as in core's playBattle. */
  battleRng: Rng;
  wildRng: Rng;
  /** When the player last sent a battle request, by the room's clock. */
  lastInputAt: number;
};

/** What a player asks for in a battle, as the four battle messages carry it. */
export type BattleRequest =
  | { readonly kind: 'move'; readonly slot: number }
  | { readonly kind: 'switch'; readonly index: number }
  | { readonly kind: 'treat'; readonly itemId: string }
  | { readonly kind: 'run' };

export type PlannedRequest = { readonly ok: true; readonly action: BattleAction; readonly progress: Progress } | { readonly ok: false; readonly reason: RefusalReason };

/** How the battle changed the player's creatures, once it is over. */
export type Settlement = {
  readonly progress: Progress;
  readonly rewards: readonly CreatureReward[];
  /** Moves a creature that levelled up learned at once, with room for them. */
  readonly learned: readonly LearnedMove[];
  /** Moves a creature that levelled up can learn by forgetting one, to offer in this order. */
  readonly offers: readonly PendingMove[];
  readonly befriended: { readonly species: string; readonly placedIn: 'team' | 'storage' } | null;
  /** The whole team fainted: the player wakes at their last shrine. */
  readonly fainted: boolean;
};

/**
 * The chance, in percent, that a wild creature at `level` picks any of its moves instead of the one
 * the greedy bot would, so wild creatures at low levels do not play perfectly.
 */
export function wildSlipPercent(level: number): number {
  return Math.max(0, 30 - 2 * level);
}

/** The wild creature's action: the greedy bot's, or now and then a random one. Null when it has nothing to do. */
export function wildAction(state: BattleState, rng: Rng, content: BattleContent): BattleAction | null {
  if (legalActions(state, WILD_SIDE).length === 0) return null;
  const slip = rng.int(1, 100) <= wildSlipPercent(activeCreature(state, WILD_SIDE).level);
  return (slip ? randomPolicy : greedyPolicy)(state, WILD_SIDE, rng, content);
}

type BeginOptions = {
  readonly id: string;
  readonly seed: number;
  readonly zone: EncounterZone;
  readonly wild: WildEncounter;
  readonly team: Progress['team'];
  readonly content: BattleContent;
  readonly now: number;
};

/** A new wild battle against `wild`, with the whole team and the zone's weather. Throws a BattleError when the saved team cannot battle under this content. */
export function beginBattle({ id, seed, zone, wild, team, content, now }: BeginOptions): { readonly battle: LiveBattle; readonly events: readonly BattleEvent[] } {
  const started = startBattle(wildBattleSetup(team, wild, zone.weather), content);
  const battle: LiveBattle = {
    id,
    zone: zone.id,
    state: started.state,
    events: [...started.events],
    battleRng: createRng(seed),
    wildRng: createRng(`${seed}:wild`),
    lastInputAt: now,
  };
  return { battle, events: started.events };
}

const refused = (reason: RefusalReason): PlannedRequest => ({ ok: false, reason });

/** A treat must be allowed now, in the inventory, a treat, and there must be room for the creature it might bring. Offering one uses it up. */
function planTreat(itemId: string, state: BattleState, progress: Progress, content: BattleContent): PlannedRequest {
  const action: BattleAction = { kind: 'treat', item: itemId };
  const left = useItem(progress, itemId);
  if (!isLegalAction(state, PLAYER_SIDE, action)) return refused('notNow');
  if (!left) return refused('noItem');
  if (content.items.get(itemId)?.kind !== 'treat') return refused('invalid');
  if (!hasRoomForCreature(progress)) return refused('full');
  return { ok: true, action, progress: left };
}

function actionOf(request: Exclude<BattleRequest, { readonly kind: 'treat' }>): BattleAction {
  switch (request.kind) {
    case 'move':
      return { kind: 'move', slot: request.slot };
    case 'switch':
      return { kind: 'switch', to: request.index };
    case 'run':
      return { kind: 'run' };
  }
}

/** The engine action a request asks for, with the progress after it, or why it is refused. */
export function planRequest(request: BattleRequest, state: BattleState, progress: Progress, content: BattleContent): PlannedRequest {
  if (request.kind === 'treat') return planTreat(request.itemId, state, progress, content);
  const action = actionOf(request);
  return isLegalAction(state, PLAYER_SIDE, action) ? { ok: true, action, progress } : refused('notNow');
}

/** A step played but not yet applied: the battle's next state, the step's events, and its RNGs after the step. */
export type PlayedStep = { readonly state: BattleState; readonly events: readonly BattleEvent[]; readonly battleRng: Rng; readonly wildRng: Rng };

/**
 * Plays one step with the player's action and the wild creature's on copies of the battle's RNGs,
 * changing nothing, so a step that throws leaves the battle as it was. `commitStep` applies it.
 */
export function nextStep(battle: LiveBattle, action: BattleAction, content: BattleContent): PlayedStep {
  const battleRng = rngFromState(battle.battleRng.state());
  const wildRng = rngFromState(battle.wildRng.state());
  const wild = wildAction(battle.state, wildRng, content);
  const result = battleStep(battle.state, [action, wild], battleRng, content);
  return { state: result.state, events: result.events, battleRng, wildRng };
}

export function commitStep(battle: LiveBattle, step: PlayedStep): void {
  battle.state = step.state;
  battle.events.push(...step.events);
  battle.battleRng = step.battleRng;
  battle.wildRng = step.wildRng;
}

/** Plays one step and applies it, and returns what happened. */
export function playStep(battle: LiveBattle, action: BattleAction, content: BattleContent): readonly BattleEvent[] {
  const step = nextStep(battle, action, content);
  commitStep(battle, step);
  return step.events;
}

/**
 * Ends a battle its player left (no input for BATTLE_IDLE_MS, the seat given up, the server
 * stopping) as the engine ends a run: before the wild creature is beaten it is a run, after it the
 * player has won.
 */
export function abandonBattle(battle: LiveBattle): readonly BattleEvent[] {
  const outcome: BattleOutcome = battle.state.phase === 'befriend' ? { winner: PLAYER_SIDE, reason: 'fainted' } : { winner: null, reason: 'ran' };
  const events: BattleEvent[] = [
    { kind: 'ran', side: PLAYER_SIDE },
    { kind: 'ended', winner: outcome.winner, reason: outcome.reason },
  ];
  battle.state = { ...battle.state, phase: 'over', mustSwap: [false, false], outcome };
  battle.events.push(...events);
  return events;
}

/** The team keeps the health it ended with, gains experience and the moves of its new levels, and welcomes a befriended creature. */
export function settleBattle(progress: Progress, battle: LiveBattle, content: BattleContent): Settlement {
  const { state } = battle;
  const ended = teamAfterBattle(progress.team, state);
  const grown = awardXp(ended, state, sentOut(battle.events), content);
  const taught = learnTeamMoves(ended, grown.team, content);
  const after: Progress = { ...progress, team: taught.team };
  const creature = state.outcome?.reason === 'befriended' ? befriendedCreature(state, content) : null;
  const added = creature ? addCreature(after, creature) : null;
  const next = creature && added ? markBefriended(added.progress, creature.species) : after;
  return {
    progress: next,
    rewards: grown.rewards,
    learned: taught.learned,
    offers: taught.offers,
    befriended: creature && added ? { species: creature.species, placedIn: added.placedIn } : null,
    fainted: !canBattle(next),
  };
}

/** An arena fight's settlement: the arena keeps every move a creature learns, so nothing is offered. */
export type FightSettlement = Omit<Settlement, 'befriended' | 'offers'> & { readonly befriended: ArenaBefriended | null };

/** Every move each team creature learned by growing from `before` to `after`, in team order, then learnset order. */
function newlyLearned(before: readonly CreatureInstance[], after: readonly CreatureInstance[], content: BattleContent): LearnedMove[] {
  return after.flatMap((creature, index) => {
    const was = before[index];
    if (!was || was.level === creature.level) return [];
    const known = new Set(learnedBy(was, content));
    return learnedBy(creature, content).flatMap((move) => (known.has(move) ? [] : [{ index, move }]));
  });
}

/**
 * A wild fight's results, as settleBattle gives a battle's: health first, then experience to the
 * creatures still standing, the moves of new levels, the treats left and a befriended creature.
 * Every move a level up teaches is `learned`; the four a turn battle uses take the new ones while
 * there is room, and the rest are not offered. A best of 3, or a fight that never started, changes
 * nothing.
 */
export function settleFight(progress: Progress, fight: ArenaFight | null, content: BattleContent): FightSettlement {
  if (fight?.mode !== 'wild' || !fight.outcome) return { progress, rewards: [], learned: [], befriended: null, fainted: !canBattle(progress) };
  const ended = teamAfterFight(progress.team, fight, arenaContentOf(content));
  const grown = arenaRewards(ended, fight, content);
  const taught = learnTeamMoves(ended, grown.team, content);
  const after: Progress = { ...progress, team: taught.team, inventory: inventoryAfterFight(progress.inventory, fight) };
  const creature = befriendedFromFight(fight, content);
  const added = creature ? addCreature(after, creature) : null;
  const next = creature && added ? markBefriended(added.progress, creature.species) : after;
  return {
    progress: next,
    rewards: grown.rewards,
    learned: newlyLearned(ended, grown.team, content),
    befriended: creature && added ? { species: creature.species, level: creature.level, placedIn: added.placedIn } : null,
    fainted: !canBattle(next),
  };
}

/**
 * A duel's results for its player on `side`, win or lose: `duelRewards` to each of their creatures
 * that fought, and every move its new levels teach in `learned`. Health is put back as it was
 * before the duel, which never touched the team. A duel stopped with no result gives nothing.
 */
export function settleDuel(progress: Progress, fight: ArenaFight | null, side: Side, content: BattleContent): FightSettlement {
  if (fight?.mode !== 'rounds' || !fight.outcome) return { progress, rewards: [], learned: [], befriended: null, fainted: !canBattle(progress) };
  const grown = duelRewards(progress.team, fight, side, content);
  const taught = learnTeamMoves(progress.team, grown.team, content);
  const next: Progress = { ...progress, team: taught.team };
  return { progress: next, rewards: grown.rewards, learned: newlyLearned(progress.team, grown.team, content), befriended: null, fainted: !canBattle(next) };
}

/** A best of 3's outcome as the player on `side` hears it: `won` and `lost` are side 0's, so side 1 hears them the other way round. */
export function duelOutcomeFor(outcome: RoundsOutcome, side: Side): RoundsOutcome {
  if (side === 0 || outcome.result === 'draw') return outcome;
  return { ...outcome, result: outcome.result === 'won' ? 'lost' : 'won' };
}

/** Why `storage.swap` could not be done: `full` when there was no room on the side a creature was going to. */
export function storageRefusal(progress: Progress, team: number | null, storage: number | null): RefusalReason {
  if (team === null && storage !== null && progress.team.length >= MAX_TEAM) return 'full';
  if (storage === null && team !== null && progress.storage.length >= STORAGE_LIMIT) return 'full';
  return 'invalid';
}
