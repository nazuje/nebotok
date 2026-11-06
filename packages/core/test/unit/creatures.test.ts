import { describe, expect, it } from 'vitest';
import renamed from '../../../../content/creatures/renamed.json' with { type: 'json' };
import starters from '../../../../content/starters.json' with { type: 'json' };
import {
  MAX_ITEM_COUNT,
  MAX_TEAM,
  STORAGE_LIMIT,
  RenamedFile,
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
  renameSpecies,
  renamedProblems,
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
    const chosen = chooseStarter(emptyProgress(), 'puddlepip', startersFile, battleContent)!;
    expect(chosen.team).toEqual([blob('puddlepip', startersFile.level)]);
    expect(chosen.inventory).toEqual(startersFile.items);
    expect(chosen.inventory.reduce((sum, entry) => sum + entry.count, 0)).toBe(5);
    expect(chosen).toMatchObject({ seen: ['puddlepip'], befriended: ['puddlepip'] });
    expect(needsStarter(chosen)).toBe(false);
  });

  it('refuses a second starter and a creature that is not one', () => {
    const chosen = chooseStarter(emptyProgress(), 'glowbun', startersFile, battleContent)!;
    expect(chooseStarter(chosen, 'puddlepip', startersFile, battleContent)).toBeNull();
    expect(chooseStarter(emptyProgress(), 'boltkit', startersFile, battleContent)).toBeNull();
  });

  it('reports starters of the same type or an unknown item', () => {
    expect(starterProblems({ ...startersFile, species: ['glowbun', 'dawnshell', 'puddlepip'] }, battleContent)).toEqual(['starters.json: the starters must be of different weather types']);
    expect(starterProblems({ ...startersFile, items: [{ item: 'moon-treat', count: 1 }] }, battleContent)).toEqual(['starters.json: item "moon-treat" is not in items.json']);
  });
});

describe('renamed species', () => {
  const renames = RenamedFile.parse(renamed);
  const old = { species: 'sun-blob', level: 7, xp: 40, hp: 9_999, moves: ['sun-tap', 'sun-wallop'], nickname: 'Sunny' };

  it('point only at species that exist, from ids that are gone', () => {
    expect(renamedProblems(renames, battleContent)).toEqual([]);
    expect(renamedProblems({ species: { 'sun-blob': 'moon-blob', glowbun: 'puddlepip' } }, battleContent)).toEqual([
      'creatures/renamed.json: "sun-blob" becomes "moon-blob", which is not in species.json',
      'creatures/renamed.json: "glowbun" is still in species.json',
    ]);
    expect(RenamedFile.safeParse({ species: { 'sun-blob': 'sun-cube', 'sun-cube': 'dawnshell' } }).success).toBe(false);
  });

  it('turn an old creature into the new species, keeping its level, experience and nickname', () => {
    const progress = { ...emptyProgress(), team: [old, blob('puddlepip')], storage: [{ ...old, species: 'gale-blob', hp: 3 }], seen: ['sun-blob', 'glowbun', 'bloom-blob'], befriended: ['sun-blob'] };
    const after = renameSpecies(progress, renames, battleContent);
    expect(after.team[0]).toEqual({ species: 'glowbun', level: 7, xp: 40, hp: maxHpOf({ species: 'glowbun', level: 7 }, battleContent), moves: blob('glowbun', 7).moves, nickname: 'Sunny' });
    expect(after.team[1]).toBe(progress.team[1]);
    expect(after.storage[0]).toMatchObject({ species: 'pinwhirl', hp: 3 });
    expect(after.seen).toEqual(['glowbun', 'bloomlet']);
    expect(after.befriended).toEqual(['glowbun']);
    expect(renameSpecies(after, renames, battleContent)).toEqual(after);
  });
});

describe('new creatures', () => {
  it('start at full health with no experience and their species\' moves', () => {
    const creature = blob('pinwhirl', 12);
    expect(creature).toEqual({ species: 'pinwhirl', level: 12, xp: 0, hp: maxHpOf(creature, battleContent), moves: battleContent.species.get('pinwhirl')!.moves });
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
    const full = withTeam(...Array.from({ length: MAX_TEAM }, () => 'glowbun'));
    expect(addCreature(withTeam('glowbun'), blob('puddlepip'))?.placedIn).toBe('team');
    const stored = addCreature(full, blob('puddlepip'))!;
    expect(stored.placedIn).toBe('storage');
    expect(stored.progress.storage).toHaveLength(1);
    const packed = { ...full, storage: Array.from({ length: STORAGE_LIMIT }, () => blob('bloomlet')) };
    expect(addCreature(packed, blob('puddlepip'))).toBeNull();
  });

  it('reorders the team only by a full list of its places', () => {
    const progress = withTeam('glowbun', 'puddlepip', 'pinwhirl');
    expect(reorderTeam(progress, [2, 0, 1])!.team.map((c) => c.species)).toEqual(['pinwhirl', 'glowbun', 'puddlepip']);
    expect(reorderTeam(progress, [0, 1])).toBeNull();
    expect(reorderTeam(progress, [0, 0, 1])).toBeNull();
    expect(reorderTeam(progress, [0, 1, 3])).toBeNull();
  });

  it('swaps, stores and brings back creatures, keeping one on the team', () => {
    const progress = { ...withTeam('glowbun', 'puddlepip'), storage: [blob('pinwhirl')] };
    expect(swapStorage(progress, 0, 0)).toMatchObject({ team: [{ species: 'pinwhirl' }, { species: 'puddlepip' }], storage: [{ species: 'glowbun' }] });
    expect(swapStorage(progress, 1, null)).toMatchObject({ team: [{ species: 'glowbun' }], storage: [{ species: 'pinwhirl' }, { species: 'puddlepip' }] });
    expect(swapStorage(progress, null, 0)).toMatchObject({ team: [{ species: 'glowbun' }, { species: 'puddlepip' }, { species: 'pinwhirl' }], storage: [] });
    expect(swapStorage(withTeam('glowbun'), 0, null)).toBeNull();
    expect(swapStorage(progress, 5, 0)).toBeNull();
    expect(swapStorage(progress, null, null)).toBeNull();
  });
});

describe('fainting and shrines', () => {
  const hurt: Progress = { ...withTeam('glowbun', 'puddlepip'), inventory: [{ item: 'plain-treat', count: 3 }] };
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
    const team = [{ ...blob('glowbun', 9), hp: 0 }, blob('boltkit', 60)];
    const setup = wildBattleSetup(team, { species: 'puddlepip', level: 3 }, 'rain');
    let { state } = startBattle(setup, battleContent);
    expect(state.sides[0].active).toBe(1);
    const rng = createRng(2);
    while (state.phase === 'choose') state = battleStep(state, [{ kind: 'move', slot: 0 }, { kind: 'move', slot: 0 }], rng, battleContent).state;
    expect(state.phase).toBe('befriend');
    const after = teamAfterBattle(team, state);
    expect(after[0]!.hp).toBe(0);
    expect(after[1]!.hp).toBe(state.sides[0].creatures[1]!.hp);
    expect(befriendedCreature(state, battleContent)).toEqual(blob('puddlepip', 3));
  });
});
