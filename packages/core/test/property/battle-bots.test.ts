import { describe, expect, it } from 'vitest';
import { simulateBots } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

const SEEDS = Array.from({ length: 200 }, (_seed, at) => at);

describe('battle bots', () => {
  it.each([1, 3, 6])('greedy beats random most of the time with teams of %i', (teamSize) => {
    const report = simulateBots(battleContent, { bots: ['greedy', 'random'], seeds: SEEDS, teamSize, level: 30 });
    expect(report.battles).toBe(SEEDS.length);
    expect(report.wins[0]).toBeGreaterThanOrEqual(SEEDS.length * 0.9);
  });

  it('gives neither side an edge when both bots are the same', () => {
    const report = simulateBots(battleContent, { bots: ['greedy', 'greedy'], seeds: SEEDS, teamSize: 3, level: 30 });
    expect(Math.abs(report.wins[0] - report.wins[1])).toBeLessThan(SEEDS.length * 0.2);
  });
});
