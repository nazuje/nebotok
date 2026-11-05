import { describe, expect, it } from 'vitest';
import starters from '../../../../content/starters.json' with { type: 'json' };
import {
  MAX_ITEM_COUNT,
  MAX_TEAM,
  STORAGE_LIMIT,
  StartersFile,
  addCreature,
  addItems,
  battleStep,
  befriendedCreature,
  canBattle,
  chooseStarter,
  createRng,
  emptyProgress,
  healTeam,
  maxHpOf,
  needsStarter,
  newCreature,
  reorderTeam,
  starterProblems,
  startBattle,
  swapStorage,
  teamAfterBattle,
  useItem,
  wakeAfterFainting,
  wildBattleSetup,
  type Progress,
} from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

const startersFile = StartersFile.parse(starters);
const blob = (species: string, level = 5) => newCreature(species, level, battleContent);
const withTeam = (...species: string[]): Progress => ({ ...emptyProgress(), team: species.map((id) => blob(id)) });

describe('starters', () => {
  it('offers three starters of different weather types and gives treats with the one chosen', () => {
    expect(starterProblems(startersFile, battleContent)).toEqual([]);
    expect(needsStarter(emptyProgress())).toBe(true);
    const chosen = chooseStarter(emptyProgress(), 'rain-blob', startersFile, battleContent)!;
    expect(chosen.team).toEqual([blob('rain-blob', startersFile.level)]);
    expect(chosen.inventory).toEqual(startersFile.items);
    expect(chosen.inventory.reduce((sum, entry) => sum + entry.count, 0)).toBe(5);
    expect(chosen).toMatchObject({ seen: ['rain-blob'], befriended: ['rain-blob'] });
    expect(needsStarter(chosen)).toBe(false);
  });

  it('refuses a second starter and a creature that is not one', () => {
    const chosen = chooseStarter(emptyProgress(), 'sun-blob', startersFile, battleContent)!;
    expect(chooseStarter(chosen, 'rain-blob', startersFile, battleContent)).toBeNull();
    expect(chooseStarter(emptyProgress(), 'storm-blob', startersFile, battleContent)).toBeNull();
  });

  it('reports starters of the same type or an unknown item', () => {
    expect(starterProblems({ ...startersFile, species: ['sun-blob', 'sun-cube', 'rain-blob'] }, battleContent)).toEqual(['starters.json: the starters must be of different weather types']);
    expect(starterProblems({ ...startersFile, items: [{ item: 'moon-treat', count: 1 }] }, battleContent)).toEqual(['starters.json: item "moon-treat" is not in items.json']);
  });
});

describe('new creatures', () => {
  it('start at full health with no experience and their species\' moves', () => {
    const creature = blob('gale-blob', 12);
    expect(creature).toEqual({ species: 'gale-blob', level: 12, xp: 0, hp: maxHpOf(creature, battleContent), moves: battleContent.species.get('gale-blob')!.moves });
    expect(() => blob('moon-blob')).toThrow(RangeError);
  });
});

describe('treats in the bag', () => {
  it('adds up to the most a player can carry and takes one at a time', () => {
    let progress = addItems(emptyProgress(), 'plain-treat', 2);
    progress = addItems(progress, 'sun-treat', 1);
    progress = addItems(progress, 'plain-treat', 3);
    expect(progress.inventory).toEqual([{ item: 'plain-treat', count: 5 }, { item: 'sun-treat', count: 1 }]);
    expect(addItems(progress, 'plain-treat', 5_000).inventory[0]!.count).toBe(MAX_ITEM_COUNT);
    progress = useItem(progress, 'sun-treat')!;
    expect(progress.inventory).toEqual([{ item: 'plain-treat', count: 5 }]);
    expect(useItem(progress, 'sun-treat')).toBeNull();
    expect(() => addItems(progress, 'plain-treat', 0)).toThrow(RangeError);
  });
});

describe('team and storage', () => {
  it('puts a new friend on the team, then in storage, and refuses when both are full', () => {
    const full = withTeam(...Array.from({ length: MAX_TEAM }, () => 'sun-blob'));
    expect(addCreature(withTeam('sun-blob'), blob('rain-blob'))?.placedIn).toBe('team');
    const stored = addCreature(full, blob('rain-blob'))!;
    expect(stored.placedIn).toBe('storage');
    expect(stored.progress.storage).toHaveLength(1);
    const packed = { ...full, storage: Array.from({ length: STORAGE_LIMIT }, () => blob('bloom-blob')) };
    expect(addCreature(packed, blob('rain-blob'))).toBeNull();
  });

  it('reorders the team only by a full list of its places', () => {
    const progress = withTeam('sun-blob', 'rain-blob', 'gale-blob');
    expect(reorderTeam(progress, [2, 0, 1])!.team.map((c) => c.species)).toEqual(['gale-blob', 'sun-blob', 'rain-blob']);
    expect(reorderTeam(progress, [0, 1])).toBeNull();
    expect(reorderTeam(progress, [0, 0, 1])).toBeNull();
    expect(reorderTeam(progress, [0, 1, 3])).toBeNull();
  });

  it('swaps, stores and brings back creatures, keeping one on the team', () => {
    const progress = { ...withTeam('sun-blob', 'rain-blob'), storage: [blob('gale-blob')] };
    expect(swapStorage(progress, 0, 0)).toMatchObject({ team: [{ species: 'gale-blob' }, { species: 'rain-blob' }], storage: [{ species: 'sun-blob' }] });
    expect(swapStorage(progress, 1, null)).toMatchObject({ team: [{ species: 'sun-blob' }], storage: [{ species: 'gale-blob' }, { species: 'rain-blob' }] });
    expect(swapStorage(progress, null, 0)).toMatchObject({ team: [{ species: 'sun-blob' }, { species: 'rain-blob' }, { species: 'gale-blob' }], storage: [] });
    expect(swapStorage(withTeam('sun-blob'), 0, null)).toBeNull();
    expect(swapStorage(progress, 5, 0)).toBeNull();
    expect(swapStorage(progress, null, null)).toBeNull();
  });
});

describe('fainting and shrines', () => {
  const hurt: Progress = { ...withTeam('sun-blob', 'rain-blob'), inventory: [{ item: 'plain-treat', count: 3 }] };
  const fainted: Progress = { ...hurt, team: hurt.team.map((creature) => ({ ...creature, hp: 0 })) };

  it('heals the whole team', () => {
    expect(canBattle(fainted)).toBe(false);
    expect(healTeam(fainted, battleContent).team).toEqual(hurt.team);
  });

  it('wakes with the team healed and nothing lost by default, and as the rules say otherwise', () => {
    expect(wakeAfterFainting(fainted, { healTeam: true, itemsKeptPercent: 100 }, battleContent)).toEqual(hurt);
    const harsh = wakeAfterFainting(fainted, { healTeam: false, itemsKeptPercent: 50 }, battleContent);
    expect(harsh.team).toEqual(fainted.team);
    expect(harsh.inventory).toEqual([{ item: 'plain-treat', count: 1 }]);
    expect(wakeAfterFainting(fainted, { healTeam: true, itemsKeptPercent: 0 }, battleContent).inventory).toEqual([]);
  });
});

describe('from the team to a battle and back', () => {
  it('brings the whole team, fainted creatures too, and keeps the health they end with', () => {
    const team = [{ ...blob('sun-blob', 9), hp: 0 }, blob('storm-blob', 60)];
    const setup = wildBattleSetup(team, { species: 'rain-blob', level: 3 }, 'rain');
    let { state } = startBattle(setup, battleContent);
    expect(state.sides[0].active).toBe(1);
    const rng = createRng(2);
    while (state.phase === 'choose') state = battleStep(state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], rng, battleContent).state;
    expect(state.phase).toBe('befriend');
    const after = teamAfterBattle(team, state);
    expect(after[0]!.hp).toBe(0);
    expect(after[1]!.hp).toBe(state.sides[0].creatures[1]!.hp);
    expect(befriendedCreature(state, battleContent)).toEqual(blob('rain-blob', 3));
  });
});
