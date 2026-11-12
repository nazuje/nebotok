import { z } from 'zod';
import { MIN_ATTEMPT_MS, judgeAttempt, perfectTaps, planAttempt, type AttemptOutcome, type AttemptPlan, type Tap } from './attempts.ts';
import { ContentId } from './content.ts';
import { emptyProgress, type Progress } from './creatures.ts';
import { cookRefusal, cookResult, gatherRefusal, gatherResult, type SkillRefusal, type SkillResult } from './gathering.ts';
import { stableHash, type Json } from './hash.ts';
import { deliverJob, openBoard, skillEvent, type JobChange, type SkillEvent } from './jobs.ts';
import type { QuestChange } from './quests.ts';
import { createRng, type Rng } from './rng.ts';
import { recipeSkill, type Difficulty, type GameKind, type SkillContent } from './skill-content.ts';
import type { SpotRest } from './skills.ts';
import type { StoryContent } from './story.ts';

/**
 * How a golden's player plays a game: `perfect` taps at its best moment and finishes when it ends,
 * `miss` never taps, and `rushed` taps perfectly but finishes before MIN_ATTEMPT_MS.
 */
export const SkillPlay = z.enum(['perfect', 'miss', 'rushed']);
export type SkillPlay = z.infer<typeof SkillPlay>;

/** One thing a skills golden's player does. Every gather and cook is next to its spot or pot. */
export const SkillCommand = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('openBoard'), seed: z.number().int().min(0).max(0xffffffff) }),
  z.strictObject({ kind: z.literal('gather'), spot: ContentId, play: SkillPlay }),
  z.strictObject({ kind: z.literal('cook'), recipe: ContentId, play: SkillPlay }),
  z.strictObject({ kind: z.literal('deliver'), npc: ContentId }),
  z.strictObject({ kind: z.literal('wait'), ms: z.number().int().min(1).max(600_000) }),
]);
export type SkillCommand = z.infer<typeof SkillCommand>;

/**
 * Skills goldens live in `fixtures/golden/skills/` and replay against the frozen content in
 * `fixtures/golden/skills/content/`. A new player plays `commands`, with games planned by an RNG
 * seeded `seed`. The hash covers every record, the final Progress and the spots' rests.
 */
export const SkillGoldenFile = z.strictObject({
  description: z.string().min(1),
  seed: z.number().int().min(0).max(0xffffffff),
  commands: z.array(SkillCommand).min(1).max(500),
  expectedHash: z.string().regex(/^[0-9a-f]{14}$/),
});
export type SkillGoldenFile = z.infer<typeof SkillGoldenFile>;

/** What one command did. */
export type SkillRecord =
  | { readonly kind: 'refused'; readonly reason: SkillRefusal }
  | { readonly kind: 'attempt'; readonly plan: AttemptPlan; readonly outcome: AttemptOutcome; readonly result: Omit<SkillResult, 'progress'>; readonly jobs: readonly JobChange[]; readonly quests: readonly QuestChange[] }
  | { readonly kind: 'board'; readonly jobs: number }
  | { readonly kind: 'delivered'; readonly jobs: readonly JobChange[]; readonly quests: readonly QuestChange[] }
  | { readonly kind: 'noDelivery' }
  | { readonly kind: 'waited'; readonly now: number };

type ReplayState = { progress: Progress; now: number; rests: SpotRest[] };

const OK_CHECK = { busy: false, inReach: true } as const;

/** The taps a play sends and the server's elapsed time when they arrive. */
function played(plan: AttemptPlan, play: SkillPlay): { readonly taps: readonly Tap[]; readonly elapsedMs: number } {
  if (play === 'miss') return { taps: [], elapsedMs: plan.endsByMs };
  const taps = perfectTaps(plan);
  return play === 'rushed' ? { taps: taps.filter((tap) => tap.at < MIN_ATTEMPT_MS - 1), elapsedMs: MIN_ATTEMPT_MS - 1 } : { taps, elapsedMs: Math.max(plan.endsByMs, MIN_ATTEMPT_MS) };
}

/** Plays one game, moves the clock on and returns how it went. */
function attempt(state: ReplayState, game: GameKind, difficulty: Difficulty, play: SkillPlay, rng: Rng, skills: SkillContent): { readonly plan: AttemptPlan; readonly outcome: AttemptOutcome } {
  const plan = planAttempt(game, difficulty, rng, skills.games);
  const { taps, elapsedMs } = played(plan, play);
  state.now += elapsedMs;
  return { plan, outcome: judgeAttempt(plan, taps, elapsedMs) };
}

/** Applies a judged attempt's result, then counts what it gave for quests and jobs. */
function applied(state: ReplayState, kind: SkillEvent['kind'], plan: AttemptPlan, outcome: AttemptOutcome, result: SkillResult, content: StoryContent): SkillRecord {
  const count = result.items.reduce((sum, entry) => sum + entry.count, 0);
  const item = result.items[0]?.item;
  const counted = item === undefined ? null : skillEvent(result.progress, { kind, item, count }, content);
  state.progress = counted?.progress ?? result.progress;
  if (result.rest) state.rests = [...state.rests.filter((rest) => rest.spot !== result.rest?.spot), result.rest];
  const { progress: _progress, ...shown } = result;
  return { kind: 'attempt', plan, outcome, result: shown, jobs: counted?.jobs ?? [], quests: counted?.quests ?? [] };
}

function gather(state: ReplayState, spot: string, play: SkillPlay, rng: Rng, content: StoryContent, skills: SkillContent): SkillRecord {
  const refusal = gatherRefusal(state.progress, spot, { ...OK_CHECK, rests: state.rests, now: state.now }, content);
  const found = skills.spots.get(spot);
  const skill = found && skills.skills.get(found.skill);
  if (refusal || !found || !skill) return { kind: 'refused', reason: refusal ?? 'invalid' };
  const { plan, outcome } = attempt(state, skill.game, found.difficulty, play, rng, skills);
  return applied(state, 'gathered', plan, outcome, gatherResult(state.progress, spot, outcome, state.now, content), content);
}

function cook(state: ReplayState, recipe: string, play: SkillPlay, rng: Rng, content: StoryContent, skills: SkillContent): SkillRecord {
  const pot = [...skills.stations.values()].find((station) => station.kind === 'cookingPot')?.id ?? '';
  const refusal = cookRefusal(state.progress, recipe, pot, OK_CHECK, content);
  const found = skills.recipes.get(recipe);
  const skill = recipeSkill(skills);
  if (refusal || !found || !skill) return { kind: 'refused', reason: refusal ?? 'invalid' };
  const { plan, outcome } = attempt(state, skill.game, found.difficulty, play, rng, skills);
  return applied(state, 'cooked', plan, outcome, cookResult(state.progress, recipe, outcome, content), content);
}

function run(state: ReplayState, command: SkillCommand, rng: Rng, content: StoryContent, skills: SkillContent): SkillRecord {
  switch (command.kind) {
    case 'openBoard':
      state.progress = openBoard(state.progress, command.seed, content);
      return { kind: 'board', jobs: state.progress.jobs?.board.length ?? 0 };
    case 'gather':
      return gather(state, command.spot, command.play, rng, content, skills);
    case 'cook':
      return cook(state, command.recipe, command.play, rng, content, skills);
    case 'deliver': {
      const delivered = deliverJob(state.progress, command.npc, content);
      if (!delivered) return { kind: 'noDelivery' };
      state.progress = delivered.progress;
      return { kind: 'delivered', jobs: delivered.jobs, quests: delivered.quests };
    }
    case 'wait':
      state.now += command.ms;
      return { kind: 'waited', now: state.now };
  }
}

export type SkillReplay = { readonly progress: Progress; readonly records: readonly SkillRecord[]; readonly rests: readonly SpotRest[]; readonly now: number };

/** Plays a golden's commands from a new player at time 0. */
export function skillReplay(golden: Pick<SkillGoldenFile, 'seed' | 'commands'>, content: StoryContent): SkillReplay {
  const skills = content.skills;
  if (!skills) throw new RangeError('skillReplay() needs skill content');
  const rng = createRng(golden.seed);
  const state: ReplayState = { progress: emptyProgress(), now: 0, rests: [] };
  const records = golden.commands.map((command) => run(state, command, rng, content, skills));
  return { progress: state.progress, records, rests: state.rests, now: state.now };
}

export function skillReplayHash(golden: Pick<SkillGoldenFile, 'seed' | 'commands'>, content: StoryContent): string {
  const plain: Json = JSON.parse(JSON.stringify(skillReplay(golden, content)));
  return stableHash(plain);
}
