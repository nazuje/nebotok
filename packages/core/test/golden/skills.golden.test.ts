import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SkillGoldenFile, skillLevel, skillReplay, skillReplayHash } from '../../src/index.ts';
import { goldenSkills } from '../support/story-content.ts';

const SKILLS_DIR = fileURLToPath(new URL('../../fixtures/golden/skills/', import.meta.url));
const files = readdirSync(SKILLS_DIR).filter((name) => name.endsWith('.json')).toSorted();
const golden = (name: string) => SkillGoldenFile.parse(JSON.parse(readFileSync(join(SKILLS_DIR, name), 'utf8')));

describe('skills golden replays', () => {
  it('has several scripted players', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s replays to its recorded hash', (name) => {
    // A mismatch means skill or job rules or the frozen content in fixtures/golden/skills/content/ changed. If that
    // was intended, put the hash this test received into the file, and say why in the commit.
    expect(skillReplayHash(golden(name), goldenSkills)).toBe(golden(name).expectedHash);
  });

  it('refuses each start the rules refuse, in the order they check', () => {
    const { records } = skillReplay(golden('refusals.json'), goldenSkills);
    expect(records.flatMap((record) => (record.kind === 'refused' ? [record.reason] : []))).toEqual(['noItem', 'needsLevel', 'resting', 'needsLevel', 'invalid']);
    expect(records.flatMap((record) => (record.kind === 'attempt' ? [record.outcome] : []))).toEqual(['perfect', 'miss', 'miss', 'miss', 'perfect']);
    const rested = records.flatMap((record) => (record.kind === 'attempt' && record.result.rest ? [record.result.rest.spot] : []));
    expect(rested).toEqual(['cloudberry-bush-a']);
  });

  it('levels foraging past the second spot, and stops at a full stack', () => {
    const { progress, records } = skillReplay(golden('to-level-five.json'), goldenSkills);
    expect(skillLevel(progress, 'foraging').level).toBeGreaterThanOrEqual(5);
    expect(records.some((record) => record.kind === 'refused' && record.reason === 'bagFull')).toBe(true);
    expect(records.at(-1)).toMatchObject({ kind: 'attempt', outcome: 'perfect', result: { items: [{ item: 'skymint', count: 2 }] } });
  });

  it('opens the board, counts gathers and cooks for its jobs, and hands over a delivery', () => {
    const { progress, records } = skillReplay(golden('board-day.json'), goldenSkills);
    expect(records.filter((record) => record.kind === 'attempt').flatMap((record) => record.jobs).length).toBeGreaterThan(0);
    expect(records.some((record) => record.kind === 'delivered')).toBe(true);
    expect(progress.jobs?.done).toBeGreaterThan(0);
    expect(progress.jobs?.board).toHaveLength(goldenSkills.skills!.slots);
  });
});
