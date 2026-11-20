/**
 * What a quest step looks like, for players who cannot read yet: the sprites the quest banner and
 * the journal draw for its goal. A step's `picture` in quests.json chooses one; without it the
 * step's own ids give a sensible default.
 */
import { spriteFor } from './art.ts';
import type { StoryContent } from './story.ts';
import type { QuestStep, StepPicture } from './story-content.ts';

/** The sprite a step's `picture` names, or null when the spot or station it names is not in the content. */
export function pictureSprite(picture: StepPicture, content: StoryContent): string | null {
  if ('item' in picture) return spriteFor.item(picture.item);
  if ('npc' in picture) return spriteFor.portrait(picture.npc);
  if ('species' in picture) return spriteFor.speciesIcon(picture.species);
  if ('weather' in picture) return spriteFor.weatherIcon(picture.weather);
  if ('spot' in picture) {
    const look = content.skills?.spots.get(picture.spot)?.look;
    return look === undefined ? null : spriteFor.spot(look);
  }
  if ('station' in picture) {
    const look = content.skills?.stations.get(picture.station)?.look;
    return look === undefined ? null : spriteFor.station(look);
  }
  return spriteFor.picture(picture.picture);
}

/** The job board's picture, or a tick when the content has no board. */
function boardSprite(content: StoryContent): string {
  const board = [...(content.skills?.stations.values() ?? [])].find((station) => station.kind === 'jobBoard');
  return board ? spriteFor.station(board.look) : spriteFor.picture('check');
}

/**
 * The pictures of what a step asks for, in the order they read: the thing to bring before the
 * one to bring it to. A delivery shows the item and the receiver's portrait, a talk the
 * character, gathering and cooking the item, befriending the creature or its weather with a
 * heart, battles a trophy, a shrine a heart (it heals the team), reaching a place footprints,
 * the job board its own picture and a trainer the challenge with their portrait.
 */
export function stepPictures(step: QuestStep, content: StoryContent): string[] {
  const chosen = step.picture === undefined ? null : pictureSprite(step.picture, content);
  if (chosen !== null) return [chosen];
  const heart = spriteFor.picture('heart');
  switch (step.kind) {
    case 'talk':
      return [spriteFor.portrait(step.npc)];
    case 'deliver':
      return [spriteFor.item(step.item), spriteFor.portrait(step.to)];
    case 'winBattles':
      return [spriteFor.picture('trophy')];
    case 'befriend':
      if (step.species !== undefined) return [spriteFor.speciesIcon(step.species), heart];
      return step.type === undefined ? [heart] : [spriteFor.weatherIcon(step.type), heart];
    case 'visitShrine':
      return [heart];
    case 'reach':
      return [spriteFor.picture('footprints')];
    case 'gather':
      return [spriteFor.item(step.item)];
    case 'cook':
      return [spriteFor.item(step.treat)];
    case 'finishJobs':
      return [boardSprite(content)];
    case 'beatTrainer': {
      const npc = content.trainers.get(step.trainer)?.npc;
      const challenge = spriteFor.picture('challenge');
      return npc === undefined ? [challenge] : [challenge, spriteFor.portrait(npc)];
    }
  }
}
