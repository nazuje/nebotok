import { describe, expect, it } from 'vitest';
import { checkContentFile, jobCount, jobCounts, jobLine, pluralForm, skillProblems, type JobTemplate } from '../../src/index.ts';
import { storyContent } from '../support/story-content.ts';

const skills = storyContent.skills!;
const template = (id: string): JobTemplate => skills.templates.get(id)!;

describe('plural forms', () => {
  it('gives Slovenian four forms that follow the last two digits', () => {
    expect([1, 2, 3, 4, 5, 11, 21, 101, 102, 103, 105].map((n) => pluralForm(n, 'sl'))).toEqual(['one', 'two', 'few', 'few', 'other', 'other', 'other', 'one', 'two', 'few', 'other']);
  });

  it('gives English two', () => {
    expect([1, 2, 5].map((n) => pluralForm(n, 'en'))).toEqual(['one', 'other', 'other']);
  });
});

describe('the counts a job can ask for', () => {
  it('are every roll grown at every level the board draws the template at, and no other', () => {
    const berries = template('berries-please');
    const last = Math.min(skills.maxLevel, berries.needs.level + skills.outgrownAfter! - 1);
    const wanted = new Set<number>();
    for (let level = berries.needs.level; level <= last; level += 1) for (let rolled = berries.count[0]; rolled <= berries.count[1]; rolled += 1) wanted.add(jobCount(rolled, level, skills));
    expect(jobCounts(berries, skills)).toEqual([...wanted].toSorted((a, b) => a - b));
    expect(jobCounts(berries, skills)).not.toContain(jobCount(berries.count[1], last + 1, skills));
  });

  it('are the range itself with no growth, up to the top level when nothing is outgrown', () => {
    expect(jobCounts({ count: [2, 4], needs: { skill: 'fishing', level: 3 } }, { maxLevel: 20, countGrowth: null, outgrownAfter: null })).toEqual([2, 3, 4]);
    expect(jobCounts({ count: [2, 2], needs: { skill: 'fishing', level: 1 } }, { maxLevel: 3, countGrowth: { afterLevel: 1, percentPerLevel: 50 }, outgrownAfter: null })).toEqual([2, 3, 4]);
  });
});

describe('the sentence a job card reads aloud', () => {
  it('is its template sentence in the form the count takes, with the count filled in', () => {
    const berries = template('berries-please');
    expect(jobLine(berries, 4, null, 'en')).toBe('Gather 4 cloudberries.');
    expect(jobLine(berries, 4, null, 'sl')).toBe('Naberi 4 oblačnice.');
    expect(jobLine(berries, 5, null, 'sl')).toBe('Naberi 5 oblačnic.');
  });

  it('writes out one and two in Slovenian, where the number agrees with the noun', () => {
    const dumplings = template('dumplings-to-go');
    expect(jobLine(dumplings, 1, 'tobolko', 'sl')).toBe('Odnesi en metin cmoček Tobolku.');
    expect(jobLine(dumplings, 2, 'vetrinka', 'sl')).toBe('Odnesi dva metina cmočka Vetrinki.');
    expect(jobLine(dumplings, 1, 'vetrinka', 'en')).toBe('Take 1 mint dumpling to Vetrinka.');
  });

  it('is null for a character the delivery has no sentence for, and for a template with none', () => {
    const fish = template('fish-for-friends');
    expect(jobLine(fish, 2, 'bavko', 'en')).toBeNull();
    expect(jobLine(fish, 2, null, 'en')).toBeNull();
    const { say: _said, ...silent } = template('pebble-catch');
    expect(jobLine(silent as JobTemplate, 2, null, 'sl')).toBeNull();
  });

  it('has a sentence for every count and character the live board can ask for', () => {
    for (const each of skills.templates.values()) {
      for (const to of each.kind === 'deliver' ? each.to : [null]) {
        for (const count of jobCounts(each, skills)) {
          for (const language of ['en', 'sl'] as const) {
            const line = jobLine(each, count, to, language);
            expect(line, `${each.id} to ${to} × ${count} in ${language}`).not.toBeNull();
            expect(line).not.toMatch(/\{/);
          }
        }
      }
    }
  });

  it('refuses a sentence missing a form, and a delivery whose sentences do not match its characters', () => {
    const jobs = { slots: 3, templates: [{ ...template('pebble-catch'), say: { en: { one: 'Catch {count} fish.' }, sl: template('pebble-catch').say } }] };
    expect(checkContentFile('jobs.json', jobs)).toMatchObject({ ok: false });
    const fish = template('fish-for-friends');
    if (fish.kind !== 'deliver' || !fish.say) throw new Error('fish-for-friends is a delivery with sentences');
    const { mehurka, ...onlyVetrinka } = fish.say;
    const wrong = { ...fish, say: { ...onlyVetrinka, bavko: mehurka! } };
    const problems = skillProblems({ ...storyContent, skills: { ...skills, templates: new Map([...skills.templates, [fish.id, wrong]]) } });
    expect(problems).toEqual([`jobs.json "fish-for-friends" say: no sentence for "mehurka", whom it goes to`, 'jobs.json "fish-for-friends" say: "bavko" is not in its `to`']);
  });
});
