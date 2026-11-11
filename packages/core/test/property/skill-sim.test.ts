import { describe, expect, it } from 'vitest';
import { simulateSkills } from '../../src/index.ts';
import { storyContent } from '../support/story-content.ts';

describe('the skill XP curve', () => {
  // The design asks for two to three hours of steady play per skill to reach the top level.
  it('takes a steady player 120 to 180 minutes to the top level of each skill', () => {
    const results = simulateSkills(storyContent, 20);
    expect(results.map((result) => result.skill)).toEqual([...storyContent.skills!.skills.keys()]);
    for (const result of results) {
      expect(result.minutes).toHaveLength(storyContent.skills!.maxLevel - 1);
      expect(result.minutes.at(-1)).toBeGreaterThanOrEqual(120);
      expect(result.minutes.at(-1)).toBeLessThanOrEqual(180);
    }
  });
});
