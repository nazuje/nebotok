import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CLOCK_SLACK_MS,
  MIN_ATTEMPT_MS,
  SaveData,
  createRng,
  judgeAttempt,
  perfectTaps,
  planAttempt,
  skillReplay,
  stackLimit,
  type AttemptPlan,
  type Progress,
  type SkillCommand,
} from '../../src/index.ts';
import { storyContent } from '../support/story-content.ts';

const skills = storyContent.skills!;
const saveOf = (progress: Progress) => ({ name: 'Skill Courier', language: 'en' as const, createdAt: '2026-05-01T09:00:00.000Z', position: null, ...progress });

const plans: fc.Arbitrary<AttemptPlan> = fc
  .record({ game: fc.constantFrom('dip', 'sparkle', 'marker' as const), difficulty: fc.constantFrom(1, 2, 3 as const), seed: fc.integer({ min: 0, max: 0xffffffff }) })
  .map(({ game, difficulty, seed }) => planAttempt(game, difficulty, createRng(seed), skills.games));
const taps = fc.array(fc.record({ at: fc.integer({ min: 0, max: 20_000 }), place: fc.integer({ min: 0, max: 3 }) }), { maxLength: 8 }).map((list) => list.toSorted((a, b) => a.at - b.at));

describe('judging an attempt', () => {
  it('never passes a tap later than the time the server waited plus its slack', () => {
    const tooLate = fc.record({ elapsed: fc.integer({ min: 0, max: 19_000 }), by: fc.integer({ min: 1, max: 900 }) });
    fc.assert(
      fc.property(plans, taps, tooLate, (plan, list, { elapsed, by }) => {
        const early = list.filter((tap) => tap.at <= elapsed);
        expect(judgeAttempt(plan, [...early, { at: elapsed + CLOCK_SLACK_MS + by, place: 0 }], elapsed)).toBe('miss');
      }),
    );
  });

  it('never passes a finish sooner than MIN_ATTEMPT_MS, whatever the taps', () => {
    fc.assert(
      fc.property(plans, taps, fc.integer({ min: 0, max: MIN_ATTEMPT_MS - 1 }), (plan, list, elapsed) => {
        expect(judgeAttempt(plan, list, elapsed)).toBe('miss');
      }),
    );
  });

  it('judges a perfect player perfect, from the same seed always the same', () => {
    fc.assert(
      fc.property(plans, (plan) => {
        const elapsed = Math.max(plan.endsByMs, MIN_ATTEMPT_MS);
        expect(judgeAttempt(plan, perfectTaps(plan), elapsed)).toBe('perfect');
        expect(judgeAttempt(plan, perfectTaps(plan), elapsed)).toBe(judgeAttempt(plan, perfectTaps(plan), elapsed));
      }),
    );
  });
});

const spots = [...skills.spots.keys()];
const recipes = [...skills.recipes.keys()];
const npcs = [...storyContent.npcs.keys()];
const play = fc.constantFrom('perfect', 'perfect', 'miss', 'rushed' as const);
const command: fc.Arbitrary<SkillCommand> = fc.oneof(
  fc.integer({ min: 0, max: 0xffffffff }).map((seed): SkillCommand => ({ kind: 'openBoard', seed })),
  fc.record({ spot: fc.constantFrom('moon-bush', ...spots), play }).map(({ spot, play: how }): SkillCommand => ({ kind: 'gather', spot, play: how })),
  fc.record({ recipe: fc.constantFrom('moon-cake', ...recipes), play }).map(({ recipe, play: how }): SkillCommand => ({ kind: 'cook', recipe, play: how })),
  fc.constantFrom(...npcs).map((npc): SkillCommand => ({ kind: 'deliver', npc })),
  fc.integer({ min: 1, max: 120_000 }).map((ms): SkillCommand => ({ kind: 'wait', ms })),
);
const runs = fc.record({ seed: fc.integer({ min: 0, max: 0xffffffff }), commands: fc.array(command, { minLength: 1, maxLength: 120 }) });

describe('random gathers, cooks and deliveries on the live content', () => {
  it('always leave a valid save, with every stack within its limit', () => {
    fc.assert(
      fc.property(runs, (run) => {
        const { progress } = skillReplay(run, storyContent);
        expect(SaveData.safeParse(saveOf(progress)).success).toBe(true);
        for (const entry of progress.inventory) expect(entry.count).toBeLessThanOrEqual(stackLimit(entry.item, storyContent));
        expect(progress.jobs?.board.length ?? 0).toBeLessThanOrEqual(skills.slots);
      }),
      { numRuns: 200 },
    );
  });

  it('never gather a spot more often than its rest allows, however well they play', () => {
    fc.assert(
      fc.property(runs, (run) => {
        const { records, now } = skillReplay(run, storyContent);
        const gathered = new Map<string, number>();
        for (const record of records) if (record.kind === 'attempt' && record.result.rest) gathered.set(record.result.rest.spot, (gathered.get(record.result.rest.spot) ?? 0) + 1);
        for (const [spot, times] of gathered) {
          const skill = skills.skills.get(skills.spots.get(spot)!.skill)!;
          if (skill.uses !== 'spots') throw new Error(`${spot} has no rest`);
          expect(times).toBeLessThanOrEqual(Math.floor(now / (skill.restSeconds * 1000)) + 1);
        }
      }),
      { numRuns: 200 },
    );
  });
});
