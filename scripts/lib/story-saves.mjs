// A save part way through the story, for a check or scene that starts a player at one quest step
// (scripts/lib/prepared-saves.mjs writes it). The story is played up to that step by core's story
// bot, by what nextGoal asks, so the save holds what a real player would have by then: the
// starter, the quests done, their items and flags.
import { loadWorld } from '../../apps/server/src/world.ts';
import { emptyProgress, runStoryCommand, storyBotCommand } from '../../packages/core/src/index.ts';

const MAX_COMMANDS = 200;

/** The story played until `quest` is active at the step with id `step`. Throws when the story never gets there. */
export function progressAt(quest, step, world = loadWorld()) {
  const rules = { content: world.story, starters: world.starters };
  const steps = world.story.quests.get(quest)?.steps;
  if (!steps?.some((each) => each.id === step)) throw new Error(`quests.json has no step "${step}" in quest "${quest}"`);
  let progress = emptyProgress();
  for (let played = 0; played < MAX_COMMANDS; played += 1) {
    const active = progress.story.active.find((entry) => entry.quest === quest);
    if (active && steps[active.step]?.id === step) return progress;
    const command = storyBotCommand(progress, rules);
    if (!command) break;
    progress = runStoryCommand(progress, command, rules).progress;
  }
  throw new Error(`the story bot never reached step "${step}" of "${quest}"`);
}

/** The whole save data of a player named `name` at `quest`'s `step`, standing on `at` of the start map. */
export function storySaveAt({ name, language, quest, step, at, world = loadWorld() }) {
  return { name, language, createdAt: new Date().toISOString(), position: { map: world.map.id, x: at.x, y: at.y, facing: 'down' }, ...progressAt(quest, step, world) };
}
