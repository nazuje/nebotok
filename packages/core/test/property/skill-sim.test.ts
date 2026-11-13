import { describe, expect, it } from 'vitest';
import { simulateGames, simulatePlayers, simulateSkills } from '../../src/index.ts';
import { storyContent } from '../support/story-content.ts';

const skills = storyContent.skills!;
const skillIds = [...skills.skills.keys()];

describe('the skill XP curve', () => {
  // The design asks for two to three hours of steady play per skill to reach the top level.
  it('takes a steady player 120 to 180 minutes to the top level of each skill', () => {
    const results = simulateSkills(storyContent, 20);
    expect(results.map((result) => result.skill)).toEqual(skillIds);
    for (const result of results) {
      expect(result.minutes).toHaveLength(skills.maxLevel - 1);
      expect(result.minutes.at(-1)).toBeGreaterThanOrEqual(120);
      expect(result.minutes.at(-1)).toBeLessThanOrEqual(180);
    }
  });

  // With the board's XP on top, a child training all three at once still takes the same two to
  // three hours, and a few games' worth of minutes per level at the start.
  it('takes a mixed player, board and free play by turns, 10 to 20 minutes to level 5 and 120 to 180 to the top', () => {
    const { skills: results } = simulatePlayers('mixed', storyContent, 20);
    expect(results.map((result) => result.skill)).toEqual(skillIds);
    for (const result of results) {
      expect(result.minutes).toHaveLength(skills.maxLevel - 1);
      expect(result.minutes[3]).toBeGreaterThanOrEqual(10);
      expect(result.minutes[3]).toBeLessThanOrEqual(20);
      expect(result.minutes.at(-1)).toBeGreaterThanOrEqual(120);
      expect(result.minutes.at(-1)).toBeLessThanOrEqual(180);
    }
  });

  it('keeps a board-first player at least 100 minutes from the top level of every skill', () => {
    const { skills: results, jobsPerHour } = simulatePlayers('boardFirst', storyContent, 20);
    for (const result of results) {
      expect(result.minutes).toHaveLength(skills.maxLevel - 1);
      expect(result.minutes.at(-1)).toBeGreaterThanOrEqual(100);
    }
    expect(jobsPerHour).toBeLessThanOrEqual(120);
  });
});

describe('the tiny games for a child', () => {
  // A child of CHILD_MODEL (reactions 330 to 650 ms, stops about 110 ms off) wins every game at
  // difficulty 1, and harder games ask more of them without turning into a coin toss.
  it('wins nearly every game at difficulty 1, and at least 70% at every difficulty', () => {
    const rates = simulateGames(skills.games, 2_000);
    expect(rates.filter((rate) => rate.miss > (rate.difficulty === 1 ? 2 : 30))).toEqual([]);
    // Fishing and cooking ask more of a child as they get harder.
    const harder = (['dip', 'marker'] as const).filter((game) => {
      const [easy, , hard] = rates.filter((rate) => rate.game === game);
      return hard!.miss > easy!.miss;
    });
    expect(harder).toEqual(['dip', 'marker']);
  });
});
