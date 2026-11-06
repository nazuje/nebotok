import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  WorldSettings,
  addCreature,
  activeCreature,
  awardXp,
  battleStep,
  battleView,
  befriendedCreature,
  canBattle,
  chooseStarter,
  createRng,
  emptyProgress,
  greedyPolicy,
  isLegalAction,
  learnTeamMoves,
  markBefriended,
  markSeen,
  needsStarter,
  newCreature,
  progressMessage,
  reorderTeam,
  sentOut,
  startBattle,
  teamAfterBattle,
  useItem,
  wakeAfterFainting,
  wildBattleSetup,
  type BattleAction,
  type BattleEvent,
  type BattleState,
  type Progress,
  type RefusalReason,
  type WakePoint,
} from '@nebotok/core';
import worldSettings from '../../../content/world.json';
import { CONTENT, SHRINES, STARTERS } from './battle-content.ts';
import type { BattleLink, ClientMessage, ServerMessage } from './battle-link.ts';

/**
 * A stand-in for the server's battle half, for ?test=1&fake=<scenario> and the unit tests: the
 * same core rules the server runs, with a fixed seed, so a page can be played through a battle
 * before the server runs encounters. Walking still goes to the real server; the first finished step
 * (`stepped`) starts the scenario's one wild battle.
 */
export const FAKE_SCENARIOS = ['new', 'faint'] as const;
export type FakeScenario = (typeof FAKE_SCENARIOS)[number];

export const isFakeScenario = (value: string | null): value is FakeScenario => FAKE_SCENARIOS.some((scenario) => scenario === value);

type Scenario = { readonly progress: Progress; readonly wild: { readonly species: string; readonly level: number }; readonly weather: string | null };

const SCENARIOS: Readonly<Record<FakeScenario, () => Scenario>> = {
  // A new player: no creatures yet, then a weak wild creature to fight and befriend.
  new: () => ({ progress: emptyProgress(), wild: { species: 'pinwhirl', level: 2 }, weather: 'rain' }),
  // One worn-out creature against a strong wild one: the whole team faints.
  faint: () => ({
    progress: { ...emptyProgress(), team: [{ ...newCreature('glowbun', 3, CONTENT), hp: 1 }], inventory: [{ item: 'plain-treat', count: 1 }], seen: ['glowbun'], befriended: ['glowbun'] },
    wild: { species: 'puddlepip', level: 40 },
    weather: null,
  }),
};

/** Picked so the browser check's play (attack until a treat is allowed, then offer treats) befriends the wild creature. */
export const FAKE_SEED = 41;
const FAKE_DELAY_MS = 40;
const START_MAP = WorldSettings.parse(worldSettings).startMap;

export type FakeServer = {
  readonly link: BattleLink;
  /** The page joined the world: the server would send `progress` now. */
  joined(): void;
  /** The player finished a step: the server would roll an encounter now. */
  stepped(): void;
};

export type FakeOptions = {
  readonly seed?: number;
  /** Runs a reply later, as the network would; tests pass one that runs at once. */
  readonly later?: (run: () => void) => void;
};

type Battle = { readonly id: string; state: BattleState; readonly events: BattleEvent[] };

export function createFakeServer(scenario: FakeScenario, options: FakeOptions = {}): FakeServer {
  const later = options.later ?? ((run: () => void) => void setTimeout(run, FAKE_DELAY_MS));
  const rng = createRng(options.seed ?? FAKE_SEED);
  const setup = SCENARIOS[scenario]();
  const handlers = new Set<(message: ServerMessage) => void>();
  let progress = setup.progress;
  let battle: Battle | null = null;
  let battles = 0;

  const emit = (message: ServerMessage) =>
    later(() => {
      for (const handler of handlers) handler(message);
    });
  const sendProgress = () => emit({ type: SERVER_MESSAGES.progress, payload: progressMessage(progress) });
  const refuse = (request: ClientMessage['type'], reason: RefusalReason) => emit({ type: SERVER_MESSAGES.refused, payload: { request, reason } });

  function start() {
    battles += 1;
    const id = `fake-${battles}`;
    progress = markSeen(progress, setup.wild.species);
    const { state, events } = startBattle(wildBattleSetup(progress.team, setup.wild, setup.weather), CONTENT);
    battle = { id, state, events: [...events] };
    emit({ type: SERVER_MESSAGES.battleStarted, payload: { battle: battleView(id, state), events } });
  }

  function end({ id, state, events }: Battle) {
    battle = null;
    const ended = teamAfterBattle(progress.team, state);
    const awarded = awardXp(ended, state, sentOut(events), CONTENT);
    // The fake teaches moves there is room for, as the server does, but offers none: no fake scenario grows a creature that far.
    const taught = learnTeamMoves(ended, awarded.team, CONTENT);
    progress = { ...progress, team: taught.team };
    if (state.outcome?.reason === 'befriended') {
      const species = activeCreature(state, 1).species;
      const placed = addCreature(progress, befriendedCreature(state, CONTENT));
      if (placed) {
        progress = markBefriended(placed.progress, species);
        emit({ type: SERVER_MESSAGES.battleBefriend, payload: { battle: id, species, placedIn: placed.placedIn } });
      }
    }
    let woke: WakePoint | null = null;
    if (state.outcome?.winner === 1) {
      progress = wakeAfterFainting(progress, SHRINES.teamFainted, CONTENT);
      woke = { map: progress.lastShrine?.map ?? START_MAP, shrine: progress.lastShrine?.shrine ?? null };
    }
    if (state.outcome) emit({ type: SERVER_MESSAGES.battleResult, payload: { battle: id, outcome: state.outcome, rewards: awarded.rewards, learned: taught.learned, woke } });
    sendProgress();
  }

  function act(request: ClientMessage['type'], action: BattleAction) {
    const current = battle;
    if (!current) return refuse(request, 'notInBattle');
    if (!isLegalAction(current.state, 0, action)) return refuse(request, 'notNow');
    if (action.kind === 'treat') {
      const used = useItem(progress, action.item);
      if (!used) return refuse(request, 'noItem');
      progress = used;
    }
    const wild = greedyPolicy(current.state, 1, rng, CONTENT);
    const { state, events } = battleStep(current.state, [action, wild], rng, CONTENT);
    current.state = state;
    current.events.push(...events);
    emit({ type: SERVER_MESSAGES.battleTurn, payload: { battle: battleView(current.id, state), events } });
    if (state.phase === 'over') end(current);
    else if (action.kind === 'treat') sendProgress();
  }

  function handle(message: ClientMessage) {
    switch (message.type) {
      case CLIENT_MESSAGES.battleMove:
        return act(message.type, { kind: 'move', slot: message.payload.slot });
      case CLIENT_MESSAGES.battleSwitch:
        return act(message.type, { kind: 'switch', to: message.payload.index });
      case CLIENT_MESSAGES.battleTreat:
        return act(message.type, { kind: 'treat', item: message.payload.itemId });
      case CLIENT_MESSAGES.battleRun:
        return act(message.type, { kind: 'run' });
      case CLIENT_MESSAGES.teamReorder: {
        if (battle) return refuse(message.type, 'inBattle');
        const next = reorderTeam(progress, message.payload.order);
        if (!next) return refuse(message.type, 'invalid');
        progress = next;
        return sendProgress();
      }
      case CLIENT_MESSAGES.storageSwap:
        return refuse(message.type, 'notAtShrine');
      case CLIENT_MESSAGES.starterChoose: {
        const next = chooseStarter(progress, message.payload.species, STARTERS, CONTENT);
        if (!next) return refuse(message.type, 'invalid');
        progress = next;
        return sendProgress();
      }
    }
  }

  return {
    link: {
      listen: (handler) => {
        handlers.add(handler);
        return () => handlers.delete(handler);
      },
      send: (message) => handle(message),
    },
    joined: () => sendProgress(),
    stepped: () => {
      if (battle || battles > 0 || needsStarter(progress) || !canBattle(progress)) return;
      start();
    },
  };
}
