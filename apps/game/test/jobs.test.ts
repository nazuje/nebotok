import { emptyProgress, emptyStory, newCreature, progressMessage, type JobChanged, type JobView } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT, itemName } from '../src/battle-content.ts';
import { applyJobChange, jobCard, jobToastLines, jobVerb, placeJobs } from '../src/job-board.ts';
import { STORY } from '../src/story-content.ts';
import { format, text } from '../src/strings.ts';
import { headMarks } from '../src/talk.ts';

const job = (number: number, extra: Partial<JobView> = {}): JobView => ({ job: number, template: 'berries-please', kind: 'gather', item: 'cloudberry', count: 5, to: null, progress: 0, ...extra });
const delivery = (number: number, extra: Partial<JobView> = {}): JobView => job(number, { template: 'fish-for-friends', kind: 'deliver', item: 'pebblefish', count: 3, to: 'mehurka', ...extra });

describe('a job card', () => {
  it('heads each kind with its verb, and a gather of something fished with Catch', () => {
    expect(jobVerb({ kind: 'gather', item: 'cloudberry' })).toBe('jobs.verb.gather');
    expect(jobVerb({ kind: 'gather', item: 'pebblefish' })).toBe('jobs.verb.catch');
    expect(jobVerb({ kind: 'cook', item: 'berry-bun' })).toBe('jobs.verb.cook');
    expect(jobVerb({ kind: 'deliver', item: 'pebblefish' })).toBe('jobs.verb.deliver');
  });

  it('shows the item, its count and how far the job has got', () => {
    const card = jobCard(job(4, { progress: 2 }), [], 'en');
    expect(card).toMatchObject({ job: 4, heading: 'Gather', item: 'cloudberry', itemName: itemName('cloudberry', 'en'), count: '× 5', progress: '2 / 5', to: null, ready: false });
  });

  it('shows a delivery to its character with what the bag holds, never more than the job wants', () => {
    const waiting = jobCard(delivery(7), [{ item: 'pebblefish', count: 1 }], 'sl');
    expect(waiting.to).toEqual({ npc: 'mehurka', line: format('jobs.to', 'sl', { npc: STORY.npcs.get('mehurka')!.name.sl }) });
    expect(waiting.progress).toBe(format('jobs.inBag', 'sl', { count: 1, of: 3 }));
    expect(waiting.ready).toBe(false);
    const ready = jobCard(delivery(7), [{ item: 'pebblefish', count: 9 }], 'en');
    expect(ready.progress).toBe('In your bag: 3 / 3');
    expect(ready.ready).toBe(true);
  });

  it('lists the rewards: the template items, and XP for each item the job wants', () => {
    const card = jobCard(delivery(7), [], 'en');
    expect(card.rewards.items).toEqual([{ item: 'skymint', count: '×1' }]);
    expect(card.rewards.xp).toEqual(['+42 Fishing XP']);
    expect(jobCard(delivery(7), [], 'sl').rewards.xp).toEqual([format('jobs.rewardXp', 'sl', { skill: STORY.skills!.skills.get('fishing')!.name.sl, xp: 42 })]);
  });

  it('never leaves English XP in the Slovenian rewards', () => {
    expect(jobCard(delivery(7), [], 'sl').rewards.xp.join(' ')).not.toMatch(/XP/);
  });
});

describe('job toasts', () => {
  it('say how far a job has got, by the item', () => {
    const change: JobChanged = { job: 4, change: 'progress', progress: 2, rewards: null, next: null };
    expect(jobToastLines(change, { item: 'pebblefish', count: 3 }, 'en')).toEqual([`${itemName('pebblefish', 'en')} 2 / 3`]);
    expect(jobToastLines(change, null, 'en')).toEqual([]);
  });

  it('say a job is done, with what it gave and what did not fit', () => {
    const change: JobChanged = {
      job: 4,
      change: 'done',
      progress: 3,
      rewards: { items: [{ item: 'skymint', count: 1 }], extra: [{ item: 'cloudberry', count: 2 }], skills: [{ skill: 'fishing', xp: 42, level: 2, levelUp: true }] },
      next: null,
    };
    const lines = jobToastLines(change, delivery(4), 'en');
    expect(lines[0]).toBe(text('jobs.toastDone', 'en'));
    expect(lines[1]).toBe(`${itemName('skymint', 'en')} ×1, +42 Fishing XP`);
    expect(lines[2]).toBe(format('quest.noRoom', 'en', { items: `${itemName('cloudberry', 'en')} ×2` }));
  });
});

describe('the board between messages', () => {
  it('counts progress and swaps a done job for the next one', () => {
    const board = [job(1), delivery(2), job(3, { template: 'bun-batch', kind: 'cook', item: 'berry-bun', count: 2 })];
    expect(applyJobChange(board, { job: 1, change: 'progress', progress: 3, rewards: null, next: null })[0]?.progress).toBe(3);
    const after = applyJobChange(board, { job: 2, change: 'done', progress: 3, rewards: null, next: job(4, { template: 'pebble-catch', item: 'pebblefish' }) });
    expect(after.map((each) => each.job)).toEqual([1, 3, 4]);
  });

  it('keeps each card in its place, a new job taking the place of the one it replaced', () => {
    const board = [job(1), job(3), job(4)];
    expect(placeJobs([1, 2, 3], board).map((each) => each.job)).toEqual([1, 4, 3]);
    expect(placeJobs([], board).map((each) => each.job)).toEqual([1, 3, 4]);
    expect(placeJobs([1, 2, 3], [job(1), job(3)]).map((each) => each.job)).toEqual([1, 3]);
    expect(placeJobs([1], [job(1), job(5), job(6)]).map((each) => each.job)).toEqual([1, 5, 6]);
  });
});

describe('a delivery ready to hand over', () => {
  const starter = [...CONTENT.species.keys()][0]!;
  const carrying = (count: number) => progressMessage({ ...emptyProgress(), team: [newCreature(starter, 5, CONTENT)], inventory: [{ item: 'pebblefish', count }] });

  it('marks its character for a turn-in once the bag holds all of it', () => {
    expect(headMarks(carrying(3), emptyStory(), STORY, [delivery(1)]).get('mehurka')).toBe('turnIn');
    expect(headMarks(carrying(2), emptyStory(), STORY, [delivery(1)]).get('mehurka')).toBeUndefined();
    expect(headMarks(carrying(3), emptyStory(), STORY, null).get('mehurka')).toBeUndefined();
  });
});
