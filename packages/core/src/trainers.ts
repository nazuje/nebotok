/**
 * Trainer fights (docs/arena.md, "Trainers"), as pure functions on a Progress: whether a trainer
 * would fight the player now, the trainer's side of the best of 3 and the mind that plays it, and
 * what a win does to the story. A talk reaches a trainer's fight at a node with `fight`;
 * `endTrainerFight` in dialogue.ts takes the talk on to its `won` or `lost` node.
 */
import type { RoundPick } from './arena/fight-state.ts';
import { wildMindFor } from './arena/mind.ts';
import type { ArenaMindName } from './content.ts';
import { canBattle, type Progress } from './creatures.ts';
import { giveItems, type ItemCount } from './inventory.ts';
import { questEvent, type QuestChange } from './quests.ts';
import { MAX_STORY_IDS } from './save.ts';
import type { StoryContent } from './story.ts';
import type { Trainer } from './story-content.ts';

/** Whether the player has beaten the trainer before: their flag is set. */
export const beatenBefore = (progress: Progress, trainer: Trainer): boolean => progress.story.flags.includes(trainer.flag);

/**
 * Whether trainer `id` would fight the player now: the content has them (the server leaves trainers
 * out while arena fights are off), the player has a creature that can fight, and the trainer's
 * `rematch` rule allows it, `once` only until the first win.
 */
export function canFightTrainer(progress: Progress, id: string, content: StoryContent): boolean {
  const trainer = content.trainers.get(id);
  return trainer !== undefined && canBattle(progress) && (trainer.rematch === 'again' || !beatenBefore(progress, trainer));
}

/** The trainer's side of a best of 3: their creatures in order, as the computer's fighters `b1` to `b3`. */
export function trainerPicks(trainer: Trainer): RoundPick[] {
  return trainer.creatures.map(({ species, level, loadout }, at) => ({ place: null, fighter: { id: `b${at + 1}`, species, level, loadout, turtle: false, computer: true } }));
}

/** The mind that plays the trainer's creatures: `WILD` turns into the gentler `WILD_EASIER` against a player with the turtle setting, as a wild creature's does. */
export function trainerMind(trainer: Trainer, turtle: boolean): ArenaMindName {
  return trainer.mind === 'WILD' ? wildMindFor(turtle) : trainer.mind;
}

/** What a win against a trainer did to the story: the Progress after, the quests that changed, and items that did not fit in the bag. */
export type TrainerWin = { readonly progress: Progress; readonly changes: readonly QuestChange[]; readonly extra: readonly ItemCount[] };

/**
 * A win against `trainer`: the first one gives the reward's item and sets the trainer's flag, and
 * every one counts for a `beatTrainer` step. The experience comes from the fight itself, which only
 * the server plays (`trainerRewards` in arena/results.ts).
 */
export function trainerWon(progress: Progress, trainer: Trainer, content: StoryContent): TrainerWin {
  let next = progress;
  const extra: ItemCount[] = [];
  const { item } = trainer.reward;
  if (!beatenBefore(progress, trainer)) {
    if (item) {
      const gift = giveItems(next, [item], content);
      next = gift.progress;
      extra.push(...gift.extra);
    }
    const { story } = next;
    if (story.flags.length < MAX_STORY_IDS) next = { ...next, story: { ...story, flags: [...story.flags, trainer.flag] } };
  }
  const counted = questEvent(next, { kind: 'trainerBeaten', trainer: trainer.id }, content);
  return { progress: counted.progress, changes: counted.changes, extra: [...extra, ...counted.extra] };
}
