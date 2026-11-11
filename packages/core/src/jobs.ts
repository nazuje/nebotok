/**
 * The Sky Post job board, as pure functions on a Progress: opening it (`openBoard`), drawing jobs
 * (`drawJob`, seeded by the board's seed and the job's number), counting gathers and cooks
 * (`jobEvent`), deliveries at a character (`deliverJob`), rewards (`jobRewards`), the `jobs`
 * message (`jobsView`) and dropping jobs today's content no longer has (`pruneJobs`). `skillEvent`
 * counts one attempt for quests and jobs together. A job finishes the moment its count is reached:
 * its rewards go in at once and the next job is drawn straight away.
 */
import type { Progress } from './creatures.ts';
import { deliveryTo } from './deliveries.ts';
import { giveItems, takeItems, type ItemCount } from './inventory.ts';
import { questEvent, type QuestChange } from './quests.ts';
import { createRng } from './rng.ts';
import type { BoardJob, JobsProgress } from './save.ts';
import type { JobKind, JobTemplate, SkillContent } from './skill-content.ts';
import { gainSkillXp, skillLevel, type SkillGain } from './skills.ts';
import type { StoryContent } from './story.ts';

/** A job as the board shows it, with its template's kind. */
export type JobView = { readonly job: number; readonly template: string; readonly kind: JobKind; readonly item: string; readonly count: number; readonly to: string | null; readonly progress: number };

/** What a finished job gave: items in the bag, what did not fit, and the skills' XP and levels after. */
export type JobRewards = { readonly items: readonly ItemCount[]; readonly extra: readonly ItemCount[]; readonly skills: readonly SkillGain[] };

/** `job.changed`: a job moved on (`progress`) or was done, with its rewards and the job drawn in its place (null when none could be). */
export type JobChange = { readonly job: number; readonly change: 'progress' | 'done'; readonly progress: number; readonly rewards: JobRewards | null; readonly next: JobView | null };

/** Something a player did that a job or quest step may count: gathered or cooked `count` of `item`. */
export type SkillEvent = { readonly kind: 'gathered' | 'cooked'; readonly item: string; readonly count: number };

/** A Progress after a job rule, the jobs and quests that changed in order, and items that did not fit in the bag. */
export type JobResult = { readonly progress: Progress; readonly jobs: readonly JobChange[]; readonly quests: readonly QuestChange[]; readonly extra: readonly ItemCount[] };

const EVENT_KIND: Readonly<Record<SkillEvent['kind'], JobKind>> = { gathered: 'gather', cooked: 'cook' };

/** Whether the player's skill is at the level a template needs. */
const meetsNeeds = (progress: Progress, template: JobTemplate) => skillLevel(progress, template.needs.skill).level >= template.needs.level;

/**
 * The job the board draws next (number `drawn + 1`), from an RNG seeded by the board's seed and
 * that number, so the same save always draws the same job: a template whose needs the player meets
 * and that is not on the board already, picked by weight. Null when the board is unopened or no
 * template fits.
 */
export function drawJob(progress: Progress, content: SkillContent): BoardJob | null {
  return progress.jobs ? nextJob(progress.jobs, progress, content) : null;
}

function nextJob(jobs: Pick<JobsProgress, 'seed' | 'drawn' | 'board'>, progress: Progress, content: SkillContent): BoardJob | null {
  const onBoard = new Set(jobs.board.map((job) => job.template));
  const fits = [...content.templates.values()].filter((template) => !onBoard.has(template.id) && meetsNeeds(progress, template));
  if (fits.length === 0) return null;
  const number = jobs.drawn + 1;
  const rng = createRng(`job:${jobs.seed}:${number}`);
  let roll = rng.int(1, fits.reduce((sum, template) => sum + template.weight, 0));
  const template = fits.find((candidate) => (roll -= candidate.weight) <= 0) ?? (fits[0] as JobTemplate);
  const count = rng.int(template.count[0], template.count[1]);
  const to = template.kind === 'deliver' ? rng.pick(template.to) : null;
  return { job: number, template: template.id, item: template.item, count, to, progress: 0 };
}

/** The board filled up to `slots` with new draws. */
function fillBoard(progress: Progress, content: SkillContent): Progress {
  const { jobs } = progress;
  if (!jobs) return progress;
  const board = [...jobs.board];
  let { drawn } = jobs;
  while (board.length < content.slots) {
    const job = nextJob({ seed: jobs.seed, drawn, board }, progress, content);
    if (!job) break;
    board.push(job);
    drawn = job.job;
  }
  return drawn === jobs.drawn ? progress : { ...progress, jobs: { ...jobs, drawn, board } };
}

/**
 * Opens the board: the first open starts it from `seed` (a 32-bit number from the server's
 * randomness) and draws `slots` jobs; a later open refills any slot a pruned job left empty.
 */
export function openBoard(progress: Progress, seed: number, content: StoryContent): Progress {
  if (!content.skills) return progress;
  const jobs: JobsProgress = progress.jobs ?? { seed: seed >>> 0, drawn: 0, done: 0, board: [] };
  return fillBoard({ ...progress, jobs }, content.skills);
}

/** A job's kind, from its template; null when the content no longer has it. */
function kindOf(job: BoardJob, content: SkillContent): JobKind | null {
  return content.templates.get(job.template)?.kind ?? null;
}

/** What finishing `job` gives: its template's items, and each XP line's `perItem` times the job's count. */
export function jobRewards(job: BoardJob, content: SkillContent): { readonly items: readonly ItemCount[]; readonly xp: readonly { readonly skill: string; readonly xp: number }[] } {
  const template = content.templates.get(job.template);
  if (!template) return { items: [], xp: [] };
  return { items: template.rewards.items, xp: template.rewards.xp.flatMap((line) => (line.perItem > 0 ? [{ skill: line.skill, xp: line.perItem * job.count }] : [])) };
}

/** A board job as the board shows it, or null when the content no longer has its template. */
function viewOf(job: BoardJob, content: SkillContent): JobView | null {
  const kind = kindOf(job, content);
  return kind ? { ...job, kind } : null;
}

/** The `jobs` message: the board in order. */
export function jobsView(progress: Progress, content: StoryContent): { readonly board: readonly JobView[] } {
  const skills = content.skills;
  return { board: skills ? (progress.jobs?.board ?? []).flatMap((job) => viewOf(job, skills) ?? []) : [] };
}

/** Takes `job` off the board, gives its rewards and draws the next one. */
function finishJob(progress: Progress, job: BoardJob, content: SkillContent, bag: StoryContent): { readonly progress: Progress; readonly change: JobChange } {
  const jobs = progress.jobs as JobsProgress;
  const rewards = jobRewards(job, content);
  const gift = giveItems({ ...progress, jobs: { ...jobs, done: jobs.done + 1, board: jobs.board.filter((other) => other.job !== job.job) } }, rewards.items, bag);
  let next = gift.progress;
  const skills: SkillGain[] = [];
  for (const { skill, xp } of rewards.xp) {
    const grown = gainSkillXp(next, skill, xp, content);
    next = grown.progress;
    skills.push(grown.gain);
  }
  const before = next.jobs?.drawn ?? 0;
  next = fillBoard(next, content);
  const drawn = next.jobs?.board.find((other) => other.job > before);
  const change: JobChange = { job: job.job, change: 'done', progress: job.count, rewards: { items: gift.given, extra: gift.extra, skills }, next: drawn ? viewOf(drawn, content) : null };
  return { progress: next, change };
}

/** Each finished job also counts as a `jobDone` quest event, in order. */
function countJobsDone(progress: Progress, changes: readonly JobChange[], content: StoryContent): { readonly progress: Progress; readonly quests: QuestChange[]; readonly extra: ItemCount[] } {
  let next = progress;
  const quests: QuestChange[] = [];
  const extra: ItemCount[] = [];
  for (const change of changes) {
    if (change.change !== 'done') continue;
    const counted = questEvent(next, { kind: 'jobDone' }, content);
    next = counted.progress;
    quests.push(...counted.changes);
    extra.push(...counted.extra);
  }
  return { progress: next, quests, extra };
}

/**
 * Counts a gather or cook for every gather or cook job of that item on the board, in board order.
 * A job whose count is reached finishes at once; a job drawn in its place does not count the same event.
 */
export function jobEvent(progress: Progress, event: SkillEvent, content: StoryContent): { readonly progress: Progress; readonly changes: readonly JobChange[]; readonly extra: readonly ItemCount[] } {
  const skills = content.skills;
  if (!skills || !progress.jobs) return { progress, changes: [], extra: [] };
  const counting = progress.jobs.board.filter((job) => job.item === event.item && kindOf(job, skills) === EVENT_KIND[event.kind]);
  let next = progress;
  const changes: JobChange[] = [];
  const extra: ItemCount[] = [];
  for (const job of counting) {
    const counted = Math.min(job.progress + event.count, job.count);
    if (counted >= job.count) {
      const finished = finishJob(next, job, skills, content);
      next = finished.progress;
      changes.push(finished.change);
      extra.push(...(finished.change.rewards?.extra ?? []));
    } else {
      const jobs = next.jobs as JobsProgress;
      const at = jobs.board.findIndex((other) => other.job === job.job);
      next = { ...next, jobs: { ...jobs, board: jobs.board.with(at, { ...job, progress: counted }) } };
      changes.push({ job: job.job, change: 'progress', progress: counted, rewards: null, next: null });
    }
  }
  return { progress: next, changes, extra };
}

/**
 * One judged attempt that gave items, counted for quests (`questEvent`) and then jobs (`jobEvent`),
 * and each job it finished as a `jobDone` quest event. The server sends the changes in this order.
 */
export function skillEvent(progress: Progress, event: SkillEvent, content: StoryContent): JobResult {
  const quest = questEvent(progress, event, content);
  const job = jobEvent(quest.progress, event, content);
  const done = countJobsDone(job.progress, job.changes, content);
  return { progress: done.progress, jobs: job.changes, quests: [...quest.changes, ...done.quests], extra: [...quest.extra, ...job.extra, ...done.extra] };
}

/**
 * Hands `npc` the first delivery job to them that the player carries all of: the items are taken,
 * the job is done with its rewards, the next one is drawn, and the finish counts for quests. Null
 * when there is none, so a dialogue node with `deliverJob` cannot happen.
 */
export function deliverJob(progress: Progress, npc: string, content: StoryContent): JobResult | null {
  const job = deliveryTo(progress, npc, true);
  const taken = job ? takeItems(progress, job.item, job.count) : null;
  if (!job || !taken || !content.skills) return null;
  const finished = finishJob(taken, job, content.skills, content);
  const done = countJobsDone(finished.progress, [finished.change], content);
  return { progress: done.progress, jobs: [finished.change], quests: done.quests, extra: [...(finished.change.rewards?.extra ?? []), ...done.extra] };
}

/**
 * The board checked against today's content, as a save loads: jobs whose template, item or
 * character is gone are dropped (by template id, for the log); the next open refills the board.
 */
export function pruneJobs(jobs: JobsProgress | null, content: Pick<StoryContent, 'items' | 'npcs' | 'skills'>): { readonly jobs: JobsProgress | null; readonly dropped: readonly string[] } {
  const skills = content.skills;
  if (!jobs || !skills) return { jobs, dropped: [] };
  const known = (job: BoardJob) => skills.templates.has(job.template) && content.items.has(job.item) && (job.to === null || content.npcs.has(job.to));
  const dropped = jobs.board.filter((job) => !known(job)).map((job) => job.template);
  return { jobs: dropped.length > 0 ? { ...jobs, board: jobs.board.filter(known) } : jobs, dropped };
}
