import { describe, expect, it } from 'vitest';
import goldenArena from '../../fixtures/golden/arena/content/arena.json' with { type: 'json' };
import goldenArenaMoves from '../../fixtures/golden/arena/content/moves.json' with { type: 'json' };
import goldenArenaSpecies from '../../fixtures/golden/arena/content/species.json' with { type: 'json' };
import { ARENA_KINDS, ARENA_SHAPES, battleContentProblems, checkContentFile, type ArenaRules, type Species } from '../../src/index.ts';
import { battleContent, battleFiles } from '../support/battle-content.ts';

const arena = battleFiles.arena;
const moves = battleFiles.moves.moves;

function arenaRules(): ArenaRules {
  if (!battleContent.arena) throw new Error('the test content has no arena.json');
  return battleContent.arena;
}

/** What a creature of `species` can put on each button at `level`: every learned move of that button's kind, or nothing while it is locked. */
function buttonsAt(species: Species, level: number): string[][] {
  const { buttons } = arenaRules();
  const learned = [...species.moves, ...(species.learnset ?? []).filter((entry) => entry.level > 1 && entry.level <= level).map((entry) => entry.move)];
  return ARENA_KINDS.map((kind, button) => (level < (buttons[button] ?? 1) ? [] : learned.filter((id) => battleContent.moves.get(id)?.arena?.kind === kind)));
}

function speciesOf(id: string): Species {
  const species = battleContent.species.get(id);
  if (!species) throw new Error(`no species "${id}"`);
  return species;
}

function arenaProblems(raw: unknown): readonly string[] {
  const result = checkContentFile('creatures/arena.json', raw);
  return result.ok ? [] : result.problems;
}

const withMove = (id: string, change: (move: (typeof moves)[number]) => object) => ({ moves: moves.map((move) => (move.id === id ? change(move) : move)) });

describe('arena content', () => {
  it('accepts the real arena.json, and every move and creature fits it', () => {
    expect(checkContentFile('creatures/arena.json', arena)).toEqual({ ok: true });
    expect(battleContentProblems(battleFiles)).toEqual([]);
    expect(arenaRules().buttons).toEqual([1, 7, 12]);
  });

  it('gives every move its kind and shape: taps are bolts, wallops lunges, calls weather', () => {
    const kindOfPower: Record<number, string> = { 0: 'ultimate', 40: 'quick', 50: 'quick', 65: 'special', 80: 'special', 100: 'ultimate' };
    const shapeOfName: Record<string, string> = { tap: 'bolt', wallop: 'lunge', call: 'weather' };
    const wrong = [...battleContent.moves.values()].flatMap((move) => {
      const shape = shapeOfName[move.id.split('-').at(-1) ?? ''] ?? move.arena?.shape;
      return move.arena?.kind === kindOfPower[move.power] && move.arena?.shape === shape ? [] : [move.id];
    });
    expect(wrong).toEqual([]);
    const used = new Set([...battleContent.moves.values()].map((move) => move.arena?.shape));
    expect(ARENA_SHAPES.filter((shape) => !used.has(shape))).toEqual([]);
  });

  it('has a move for every unlocked button of every creature at levels 1, 7 and 12', () => {
    const empty: string[] = [];
    for (const species of battleContent.species.values()) {
      for (const level of arenaRules().buttons) {
        buttonsAt(species, level).forEach((choices, button) => {
          if (level >= (arenaRules().buttons[button] ?? 1) && choices.length === 0) empty.push(`${species.id} at level ${level}: button ${button + 1}`);
        });
      }
    }
    expect(empty).toEqual([]);
    expect(buttonsAt(speciesOf('dawnshell'), 7)).toEqual([['sun-tap', 'heat-shimmer', 'storm-tap'], ['sun-ray'], []]);
    expect(buttonsAt(speciesOf('dawnshell'), 12)).toEqual([['sun-tap', 'heat-shimmer', 'storm-tap'], ['sun-ray'], ['sun-call']]);
    expect(buttonsAt(speciesOf('dawnshell'), 1)).toEqual([['sun-tap', 'heat-shimmer', 'storm-tap'], [], []]);
  });

  it('reports a dash slower than a creature walks, naming each creature', () => {
    const problems = battleContentProblems({ ...battleFiles, arena: { ...arena, dash: { ...arena.dash, speed: 450 } } });
    expect(problems).toContain('species.json "rimemoth": walks at up to 517 units a second, so a dash (arena.json dash.speed 450) must be faster');
    expect(problems.some((problem) => problem.includes('"dawnshell"'))).toBe(false);
  });

  it('reports a quick move that cools down longer than a special one', () => {
    const slowTap = withMove('sun-tap', (move) => ({ ...move, arena: { ...move.arena, cooldownTicks: 400 } }));
    expect(battleContentProblems({ ...battleFiles, moves: slowTap })).toEqual(['moves.json "sun-tap": a quick move that cools down in 400 ticks must be quicker than the special move "sun-wallop" (360)']);
    const slowQuick = { ...arena, kinds: { ...arena.kinds, quick: { ...arena.kinds.quick, cooldownTicks: 400 } } };
    expect(checkContentFile('creatures/arena.json', slowQuick)).toEqual({ ok: false, problems: ['kinds.quick.cooldownTicks: quick moves cool down in 400 ticks, which must be quicker than special moves (360)'] });
  });

  it('reports a storm floor too small for two creatures and a reach across the whole island', () => {
    expect(arenaProblems({ ...arena, storm: { ...arena.storm, floorPercent: 15 } })).toEqual(["storm.floorPercent: the storm's floor, 156 across, must be wider than two bodies side by side (184)"]);
    expect(arenaProblems({ ...arena, shapes: { ...arena.shapes, bolt: { ...arena.shapes.bolt, reach: 1040 } } })).toEqual(["shapes.bolt: a bolt reaches 1040, which must be shorter than the island's diameter (1040)"]);
    expect(arenaProblems({ ...arena, shapes: { ...arena.shapes, strike: { ...arena.shapes.strike, count: 3, spacing: 400 } } })).toEqual(["shapes.strike: a strike reaches 1100, which must be shorter than the island's diameter (1040)"]);
    expect(arenaProblems({ ...arena, treat: { ...arena.treat, range: 2000 } })).toEqual(["treat.range: a treat flies 2000, which must be shorter than the island's diameter (1040)"]);
    const farDrip = withMove('drip-drop', (move) => ({ ...move, arena: { ...move.arena, reach: 1200 } }));
    expect(battleContentProblems({ ...battleFiles, moves: farDrip })).toEqual(['moves.json "drip-drop": reaches 1200, which must be shorter than the island\'s diameter (1040)']);
  });

  it('keeps the arena type chart a real advantage: strong above 100%, weak below', () => {
    expect(arenaRules()).toMatchObject({ strongPercent: 150, weakPercent: 75 });
    expect(arenaProblems({ ...arena, strongPercent: 100, weakPercent: 100 })).toEqual(['strongPercent: a strong hit does 100%, which must be more than 100%', 'weakPercent: a weak hit does 100%, which must be less than 100%']);
  });

  it('rejects buttons that do not start at level 1 or rise', () => {
    expect(arenaProblems({ ...arena, buttons: [2, 7, 12] })).toEqual(['buttons.0: button 1 is there from level 1']);
    expect(arenaProblems({ ...arena, buttons: [1, 12, 7] })).toEqual(['buttons: buttons unlock at rising levels']);
  });

  it('reports a creature with no special move by the level button 2 unlocks', () => {
    const late = {
      id: 'test-blob',
      name: { en: 'Test Blob', sl: 'Testna kepica' },
      type: 'sun',
      stats: { hp: 50, attack: 50, defense: 50, speed: 50 },
      moves: ['sun-tap', 'heat-shimmer', 'storm-tap', 'sun-call'],
      learnset: [...['sun-tap', 'heat-shimmer', 'storm-tap', 'sun-call'].map((move) => ({ level: 1, move })), { level: 9, move: 'sun-ray' }],
    };
    expect(battleContentProblems({ ...battleFiles, species: { species: [late] } })).toEqual(['species.json "test-blob": learns no special move by level 7, for button 2']);
  });

  it('needs every move in content/ to have an arena block, with only its shape numbers, in whole numbers', () => {
    const bare = withMove('sun-tap', ({ arena: _arena, ...move }) => move);
    expect(checkContentFile('creatures/moves.json', bare)).toEqual({ ok: false, problems: ['moves.0.arena: "sun-tap" needs an arena block with its kind and shape'] });
    expect(battleContentProblems({ ...battleFiles, moves: bare })).toEqual(['moves.json "sun-tap": needs an arena block with its kind and shape']);
    const broken = [{ kind: 'quick', shape: 'bolt', rootTicks: 4 }, { kind: 'quick', shape: 'bolt', speed: 900.5 }, { kind: 'quick', shape: 'beam' }, { kind: 'super', shape: 'bolt' }];
    expect(broken.filter((block) => checkContentFile('creatures/moves.json', withMove('sun-tap', (move) => ({ ...move, arena: block }))).ok)).toEqual([]);
  });

  it('keeps a valid frozen copy of the arena content for arena goldens', () => {
    expect(battleContentProblems({ ...battleFiles, moves: goldenArenaMoves, species: goldenArenaSpecies, arena: goldenArena })).toEqual([]);
  });
});
