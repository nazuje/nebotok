import { describe, expect, it } from 'vitest';
import { emptyProgress, isRepaired, maxHpOf, newCreature, sanitizeProgress, type CreatureInstance, type Progress } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

const progressWith = (progress: Partial<Progress>): Progress => ({ ...emptyProgress(), ...progress });
const gone = (species = 'gone-species'): CreatureInstance => ({ species, level: 5, xp: 0, hp: 20, moves: ['sun-tap'] });

describe('sanitizeProgress', () => {
  it('leaves progress that matches the content as it is', () => {
    const progress = progressWith({
      team: [newCreature('glowbun', 20, battleContent), { ...newCreature('puddlepip', 6, battleContent), moves: ['rain-tap', 'gale-tap'], hp: 0 }],
      storage: [newCreature('snowsnoot', 4, battleContent)],
      inventory: [{ item: 'plain-treat', count: 3 }],
      seen: ['glowbun', 'puddlepip'],
      befriended: ['glowbun'],
    });
    const { progress: after, repairs } = sanitizeProgress(progress, battleContent);
    expect(after).toBe(progress);
    expect(isRepaired(repairs)).toBe(false);
  });

  it('drops a creature whose species is gone, and items and seen species that are gone', () => {
    const kept = newCreature('glowbun', 7, battleContent);
    const progress = progressWith({
      team: [gone(), kept],
      storage: [gone('old-cloud')],
      inventory: [
        { item: 'gone-treat', count: 1 },
        { item: 'plain-treat', count: 2 },
      ],
      seen: ['glowbun', 'gone-species'],
      befriended: ['gone-species'],
    });
    const { progress: after, repairs } = sanitizeProgress(progress, battleContent);
    expect(after).toEqual({ ...progress, team: [kept], storage: [], inventory: [{ item: 'plain-treat', count: 2 }], seen: ['glowbun'], befriended: [] });
    expect(repairs).toEqual({ droppedCreatures: ['gone-species', 'old-cloud'], droppedItems: ['gone-treat'], replacedMoves: [], clamped: 0, forgottenSpecies: ['gone-species'], refilledTeam: false });
  });

  it("keeps the moves a creature can know and fills the others' slots from its species' moves", () => {
    const creature: CreatureInstance = { ...newCreature('glowbun', 30, battleContent), moves: ['sun-wallop', 'gone-move', 'drip-drop'] };
    const { progress, repairs } = sanitizeProgress(progressWith({ team: [creature] }), battleContent);
    // heat-shimmer and sun-ray are glowbun's first moves; sun-wallop is in its learnset.
    expect(progress.team[0]?.moves).toEqual(['sun-wallop', 'heat-shimmer', 'sun-ray']);
    expect(repairs.replacedMoves).toEqual(['gone-move', 'drip-drop']);
  });

  it('gives a creature that knew only gone moves one of its species', () => {
    const { progress } = sanitizeProgress(progressWith({ team: [{ ...newCreature('glowbun', 3, battleContent), moves: ['gone-move'] }] }), battleContent);
    expect(progress.team[0]?.moves).toEqual(['heat-shimmer']);
  });

  it('caps health at full health', () => {
    const creature = { ...newCreature('glowbun', 7, battleContent), hp: 999 };
    const { progress, repairs } = sanitizeProgress(progressWith({ team: [creature] }), battleContent);
    expect(progress.team[0]?.hp).toBe(maxHpOf(creature, battleContent));
    expect(repairs.clamped).toBe(1);
  });

  it('moves a stored creature that can battle onto a team left empty', () => {
    const fainted = { ...newCreature('snowsnoot', 4, battleContent), hp: 0 };
    const ready = newCreature('puddlepip', 5, battleContent);
    const { progress, repairs } = sanitizeProgress(progressWith({ team: [gone()], storage: [fainted, ready] }), battleContent);
    expect(progress.team).toEqual([ready]);
    expect(progress.storage).toEqual([fainted]);
    expect(repairs.refilledTeam).toBe(true);
  });

  it('leaves a player whose every creature is gone to choose a starter again', () => {
    const { progress } = sanitizeProgress(progressWith({ team: [gone()], storage: [gone('old-cloud')] }), battleContent);
    expect(progress.team).toEqual([]);
    expect(progress.storage).toEqual([]);
  });
});
