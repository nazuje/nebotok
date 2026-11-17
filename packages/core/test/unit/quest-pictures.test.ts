import { describe, expect, it } from 'vitest';
import { QuestStep, QuestsFile, spriteFor, stepPictures, storyContentProblems } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';
import { liveStoryFiles, storyContent } from '../support/story-content.ts';

type Json = Record<string, unknown>;
const hint = { en: 'Go on.', sl: 'Kar naprej.' };
const step = (fields: Json): QuestStep => QuestStep.parse({ id: 'a-step', hint, ...fields });

describe('the pictures of a quest step', () => {
  it('shows what each kind of step asks for when it names no picture', () => {
    expect(stepPictures(step({ kind: 'talk', npc: 'tobolko' }), storyContent)).toEqual(['portraits/tobolko']);
    expect(stepPictures(step({ kind: 'deliver', item: 'hello-note', count: 1, to: 'tobolko' }), storyContent)).toEqual(['items/hello-note', 'portraits/tobolko']);
    expect(stepPictures(step({ kind: 'winBattles', count: 2 }), storyContent)).toEqual(['pictures/trophy']);
    expect(stepPictures(step({ kind: 'befriend', count: 1, species: 'glowbun' }), storyContent)).toEqual(['icons/glowbun', 'pictures/heart']);
    expect(stepPictures(step({ kind: 'befriend', count: 1, type: 'gale' }), storyContent)).toEqual(['weather/gale', 'pictures/heart']);
    expect(stepPictures(step({ kind: 'befriend', count: 1 }), storyContent)).toEqual(['pictures/heart']);
    expect(stepPictures(step({ kind: 'visitShrine', shrine: 'post-shrine' }), storyContent)).toEqual(['pictures/heart']);
    expect(stepPictures(step({ kind: 'reach', mark: 'lookout' }), storyContent)).toEqual(['pictures/footprints']);
    expect(stepPictures(step({ kind: 'gather', item: 'cloudberry', count: 3 }), storyContent)).toEqual(['items/cloudberry']);
    expect(stepPictures(step({ kind: 'cook', treat: 'berry-bun', count: 1 }), storyContent)).toEqual(['items/berry-bun']);
    const board = [...(storyContent.skills?.stations.values() ?? [])].find((station) => station.kind === 'jobBoard');
    expect(stepPictures(step({ kind: 'finishJobs', count: 1 }), storyContent)).toEqual([spriteFor.station(board?.look ?? '')]);
  });

  it('shows the picture a step names instead', () => {
    const battles = { kind: 'winBattles', count: 1 };
    expect(stepPictures(step({ ...battles, picture: { weather: 'gale' } }), storyContent)).toEqual(['weather/gale']);
    expect(stepPictures(step({ ...battles, picture: { species: 'glowbun' } }), storyContent)).toEqual(['icons/glowbun']);
    expect(stepPictures(step({ ...battles, picture: { npc: 'bavko' } }), storyContent)).toEqual(['portraits/bavko']);
    expect(stepPictures(step({ ...battles, picture: { item: 'plain-treat' } }), storyContent)).toEqual(['items/plain-treat']);
    expect(stepPictures(step({ ...battles, picture: { picture: 'compass' } }), storyContent)).toEqual(['pictures/compass']);
    const spot = [...(storyContent.skills?.spots.values() ?? [])][0];
    expect(stepPictures(step({ ...battles, picture: { spot: spot?.id } }), storyContent)).toEqual([spriteFor.spot(spot?.look ?? '')]);
    const station = [...(storyContent.skills?.stations.values() ?? [])][0];
    expect(stepPictures(step({ ...battles, picture: { station: station?.id } }), storyContent)).toEqual([spriteFor.station(station?.look ?? '')]);
  });

  it('refuses a picture that names two things, nothing, or no picture of the kit', () => {
    const battles = { id: 'a-step', hint, kind: 'winBattles', count: 1 };
    expect(QuestStep.safeParse({ ...battles, picture: { item: 'plain-treat', npc: 'bavko' } }).success).toBe(false);
    expect(QuestStep.safeParse({ ...battles, picture: {} }).success).toBe(false);
    expect(QuestStep.safeParse({ ...battles, picture: { picture: 'moon' } }).success).toBe(false);
    expect(QuestStep.safeParse({ ...battles, picture: { tile: 'shrine' } }).success).toBe(false);
  });

  it('names a picture of something the content does not have', () => {
    const quests = structuredClone(liveStoryFiles.quests) as { quests: { id: string; steps: Json[] }[] };
    const [first] = quests.quests;
    if (!first?.steps[0]) throw new Error('no first step');
    first.steps[0]['picture'] = { species: 'moonbun' };
    expect(QuestsFile.safeParse(quests).success).toBe(true);
    expect(storyContentProblems({ ...liveStoryFiles, quests }, battleContent)).toEqual([`quests.json "${first.id}" step "${String(first.steps[0]['id'])}" picture: species "moonbun" is not in species.json`]);
  });
});
