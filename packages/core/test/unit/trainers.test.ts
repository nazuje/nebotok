import { describe, expect, it } from 'vitest';
import {
  TrainersFile,
  advanceConversation,
  canFightTrainer,
  checkContentFile,
  chooseStarter,
  conversationView,
  emptyProgress,
  endTrainerFight,
  loadStoryContent,
  openConversation,
  storyContentProblems,
  trainerMind,
  trainerPicks,
  type Progress,
  type StoryContent,
} from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';
import { liveStory, liveStoryFiles, storyContent } from '../support/story-content.ts';

type Json = Record<string, unknown>;
type TrainerJson = Json & { creatures: Json[]; reward: Json };
const copy = <T>(value: T): T => structuredClone(value);
const vetrinka = () => storyContent.trainers.get('vetrinka')!;

/** A player past every quest of the story, with the sun starter and the first chapter's closing flag. */
function veteran(flags: readonly string[] = []): Progress {
  const chosen = chooseStarter(emptyProgress(), liveStory.starters.species[0]!, liveStory.starters, battleContent);
  if (!chosen) throw new Error('no starter');
  return { ...chosen, story: { active: [], done: [...storyContent.quests.keys()], flags: ['chapter-1-done', ...flags] } };
}

/** The problems of the real story with Vetrinka's trainer changed. */
function withTrainer(change: (trainer: TrainerJson, files: typeof liveStoryFiles) => void) {
  const files = copy(liveStoryFiles);
  change((files.trainers as { trainers: TrainerJson[] }).trainers[0]!, files);
  return storyContentProblems(files, battleContent);
}

const issuesOf = (raw: unknown) => TrainersFile.safeParse(raw).error?.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) ?? [];

/** Talks to Vetrinka from her first node, takes the challenge, and returns the talk at the fight node. */
function toTheFight(progress: Progress) {
  const opened = openConversation('vetrinka', progress, storyContent);
  expect(opened?.conversation?.node).toBe('test-ask');
  const accepted = advanceConversation(opened!.conversation!, 0, progress, storyContent);
  expect(accepted?.conversation?.node).toBe('test-go');
  return accepted!.conversation!;
}

describe('trainers.json', () => {
  it('accepts the real trainers file', () => {
    expect(checkContentFile('trainers.json', liveStoryFiles.trainers)).toEqual({ ok: true });
  });

  it('refuses a trainer with two creatures, a share of experience over 100 and an unknown mind', () => {
    const bad = copy(liveStoryFiles.trainers) as { trainers: TrainerJson[] };
    const trainer = bad.trainers[0]!;
    trainer.creatures = trainer.creatures.slice(0, 2);
    trainer.reward = { xpPercent: 101 };
    trainer['mind'] = 'HUNTER';
    expect(issuesOf(bad)).toEqual([
      'trainers.0.creatures: Too small: expected array to have exactly 3 items',
      'trainers.0.mind: Invalid option: expected one of "WILD"|"BOT"',
      'trainers.0.reward.xpPercent: Too big: expected number to be <=100',
    ]);
  });
});

describe('links of a trainer', () => {
  it('accepts the real trainer', () => {
    expect(withTrainer(() => {})).toEqual([]);
  });

  it('names an unknown species, a move the creature has not learned, an undeclared flag and an unknown item', () => {
    const problems = withTrainer((trainer) => {
      trainer.creatures[0]!['species'] = 'moonbun';
      trainer.creatures[1]!['loadout'] = ['gust-push', null, null];
      trainer['flag'] = 'moon-won';
      trainer.reward = { xpPercent: 50, item: { item: 'moon-cake', count: 1 } };
    });
    expect(problems).toEqual([
      'trainers.json "vetrinka": flag "moon-won" is not declared in story.json',
      'trainers.json "vetrinka" reward: item "moon-cake" is not in items.json',
      'trainers.json "vetrinka" creature 0: species "moonbun" is not in species.json',
      'trainers.json "vetrinka" creature 1: loadout ["gust-push",null,null] is not moves drizzlesnail has learned by level 7, each of its button\'s kind on an unlocked button',
    ]);
  });

  it('needs the trainer\'s character to have a node with their fight, reached only through { canFight }', () => {
    expect(withTrainer((trainer) => void (trainer['npc'] = 'bavko'))).toEqual([
      'dialogue/vetrinka.json node "test-go": fights "vetrinka", whose character is "bavko", not "vetrinka"',
      'trainers.json "vetrinka": no node of dialogue/bavko.json fights it ({ "fight": "vetrinka" })',
    ]);
    expect(
      withTrainer((_, files) => {
        const nodes = (files.dialogue['vetrinka'] as { nodes: Record<string, { choices: Json[] }> }).nodes;
        delete nodes['test-ask']!.choices[0]!['if'];
      }),
    ).toEqual(['dialogue/vetrinka.json node "test-go": fights "vetrinka", so node "test-ask" choice 0 must lead here only with { "canFight": "vetrinka" } (a "next" cannot check it)']);
  });
});

describe('fighting a trainer from a talk', () => {
  it('fights while the player has a creature that can, and the rematch rule allows it', () => {
    expect(canFightTrainer(veteran(), 'vetrinka', storyContent)).toBe(true);
    expect(canFightTrainer({ ...veteran(), team: [] }, 'vetrinka', storyContent)).toBe(false);
    expect(canFightTrainer(veteran(), 'nobody', storyContent)).toBe(false);
    const once: StoryContent = { ...storyContent, trainers: new Map([['vetrinka', { ...vetrinka(), rematch: 'once' }]]) };
    expect(canFightTrainer(veteran(), 'vetrinka', once)).toBe(true);
    expect(canFightTrainer(veteran([vetrinka().flag]), 'vetrinka', once)).toBe(false);
    expect(canFightTrainer(veteran([vetrinka().flag]), 'vetrinka', storyContent)).toBe(true);
  });

  it('never offers the challenge without the trainer, as the server loads the story with arena fights off', () => {
    const off: StoryContent = { ...storyContent, trainers: new Map() };
    expect(openConversation('vetrinka', veteran(), off)?.conversation?.node).toBe('after');
  });

  it('stops the talk at the fight node until the fight ends, then goes on to won or lost', () => {
    const progress = veteran();
    const fight = toTheFight(progress);
    expect(conversationView(fight, progress, storyContent)).toMatchObject({ node: 'test-go', choices: [], ends: false });
    expect(advanceConversation(fight, null, progress, storyContent)).toBeNull();

    const won = endTrainerFight(fight, true, progress, storyContent);
    expect(won?.conversation?.node).toBe('test-won');
    expect(won?.progress.story.flags).toEqual(['chapter-1-done', vetrinka().flag]);
    expect(won?.progress.inventory).toEqual([...progress.inventory, vetrinka().reward.item]);

    const again = endTrainerFight(toTheFight(won!.progress), true, won!.progress, storyContent);
    expect(again?.conversation?.node).toBe('test-won');
    expect(again?.progress).toEqual(won?.progress);

    const lost = endTrainerFight(fight, false, progress, storyContent);
    expect(lost?.conversation?.node).toBe('test-lost');
    expect(lost?.progress).toEqual(progress);
    expect(endTrainerFight({ npc: 'vetrinka', node: 'after' }, true, progress, storyContent)).toBeNull();
  });

  it('puts the trainer\'s creatures on the computer\'s side in order, played by the gentler mind for a turtle', () => {
    const trainer = vetrinka();
    expect(trainerPicks(trainer).map(({ place, fighter }) => [place, fighter.id, fighter.species, fighter.level, fighter.computer])).toEqual(
      trainer.creatures.map((creature, at) => [null, `b${at + 1}`, creature.species, creature.level, true]),
    );
    expect([trainerMind(trainer, false), trainerMind(trainer, true), trainerMind({ ...trainer, mind: 'BOT' }, true)]).toEqual(['WILD', 'WILD_EASIER', 'BOT']);
  });

  it('counts a win for a beatTrainer step', () => {
    const files = copy(liveStoryFiles) as typeof liveStoryFiles & { quests: { quests: Json[] } };
    const odd = files.quests.quests.find((quest) => quest['id'] === 'treats-from-scratch')!;
    const steps = odd['steps'] as Json[];
    steps.push({ id: 'beat', kind: 'beatTrainer', trainer: 'vetrinka', hint: { en: 'Beat Vetrinka.', sl: 'Premagaj Vetrinko.' } });
    const content = loadStoryContent(files, battleContent);
    const progress = { ...veteran(), story: { active: [{ quest: 'treats-from-scratch', step: steps.length - 1, count: 0 }], done: [], flags: ['chapter-1-done'] } };
    const fight = { npc: 'vetrinka', node: 'test-go' };
    expect(endTrainerFight(fight, true, progress, content)?.changes).toEqual([expect.objectContaining({ quest: 'treats-from-scratch', change: 'done' })]);
    expect(endTrainerFight(fight, false, progress, content)?.changes).toEqual([]);
  });
});
