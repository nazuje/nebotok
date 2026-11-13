import { emptyProgress, emptyStory, mapFromRows, newCreature, progressMessage, type Progress, type WorldMap } from '@nebotok/core';
import { describe, expect, it } from 'vitest';
import { CONTENT } from '../src/battle-content.ts';
import { STORY } from '../src/talk-content.ts';
import { LETTERS_PER_SECOND, facedNpc, facedTarget, facingToward, headMarks, npcAt, portraitFrame, standBeside, starterNpc, talkLine, talkSpot, targetAt, targetTile, typedLength } from '../src/talk.ts';

// Bavko stands at 3,1 behind a wall on his left; the tile right of him is the only way up to him.
const MAP: WorldMap = { ...mapFromRows('test', ['......', '..#.#.', '......']), npcs: { bavko: { x: 3, y: 1 } } };
const blocked = (map: WorldMap, ...tiles: { x: number; y: number }[]): WorldMap => ({
  ...map,
  walkable: map.walkable.map((ok, at) => ok && !tiles.some((tile) => tile.y * map.width + tile.x === at)),
});

const progress = (extra: Partial<Progress> = {}) => progressMessage({ ...emptyProgress(), ...extra });

describe('the words of a talk', () => {
  it('finds the line, its speaker and the choices the server shows, in the player language', () => {
    const line = talkLine({ npc: 'bavko', node: 'offer', choices: [1] }, STORY, 'sl');
    expect(line).toMatchObject({ speaker: 'bavko', name: STORY.npcs.get('bavko')!.name.sl, mood: 'happy', pace: STORY.npcs.get('bavko')!.voice.pace });
    expect(line?.say).toBe(STORY.dialogue.get('bavko')!.nodes['offer']!.say.sl);
    expect(line?.choices).toEqual([{ say: STORY.dialogue.get('bavko')!.nodes['offer']!.choices![1]!.say.sl, index: 1 }]);
    expect(talkLine({ npc: 'bavko', node: 'nowhere', choices: [] }, STORY, 'en')).toBeNull();
  });

  it('uses a portrait mood the art has, and neutral otherwise', () => {
    expect(portraitFrame(['neutral', 'happy'], 'happy')).toBe('happy');
    expect(portraitFrame(['neutral', 'happy'], 'worried')).toBe('neutral');
    expect(portraitFrame(['neutral'], null)).toBe('neutral');
  });

  it('types quicker for a quicker voice, and never past the end', () => {
    expect(typedLength(100, 1_000, 1)).toBe(LETTERS_PER_SECOND[1]);
    expect(typedLength(100, 1_000, 3)).toBeGreaterThan(typedLength(100, 1_000, 1));
    expect(typedLength(10, 60_000, 2)).toBe(10);
    expect(typedLength(10, -5, 2)).toBe(0);
  });
});

describe('walking up to a character', () => {
  it('knows who stands where and whom the courier faces', () => {
    expect(npcAt(MAP, { x: 3, y: 1 })).toBe('bavko');
    expect(npcAt(MAP, { x: 0, y: 0 })).toBeNull();
    expect(facedNpc(MAP, { x: 3, y: 0 }, 'down')).toBe('bavko');
    expect(facedNpc(MAP, { x: 3, y: 0 }, 'up')).toBeNull();
  });

  it('talks from where the courier stands when it is already beside them', () => {
    expect(talkSpot(MAP, { x: 3, y: 2 }, 'bavko', () => true)).toEqual({ x: 3, y: 2 });
  });

  it('walks to the nearest free tile beside them, never diagonal, and only where it can go', () => {
    expect(talkSpot(MAP, { x: 0, y: 0 }, 'bavko', () => true)).toEqual({ x: 3, y: 0 });
    expect(talkSpot(MAP, { x: 5, y: 2 }, 'bavko', () => true)).toEqual({ x: 3, y: 2 });
    expect(talkSpot(MAP, { x: 5, y: 2 }, 'bavko', (tile) => tile.y !== 2)).toEqual({ x: 3, y: 0 });
    expect(talkSpot(blocked(MAP, { x: 3, y: 0 }, { x: 3, y: 2 }), { x: 0, y: 0 }, 'bavko', () => true)).toBeNull();
    expect(talkSpot(MAP, { x: 0, y: 0 }, 'nobody', () => true)).toBeNull();
  });

  it('stands out of the tall grass when a tile beside them is not much further', () => {
    const grassy: WorldMap = { ...MAP, encounterAreas: [{ zone: 'meadow', x: 3, y: 0, width: 1, height: 1 }] };
    expect(talkSpot(grassy, { x: 0, y: 0 }, 'bavko', () => true)).toEqual({ x: 3, y: 2 });
  });

  it('finds spots and stations too, and where to stand to use them', () => {
    const map: WorldMap = { ...MAP, spots: { 'pebble-cove': { x: 0, y: 2 } }, stations: { 'post-pot': { x: 5, y: 0 } } };
    expect(targetAt(map, { x: 3, y: 1 })).toEqual({ kind: 'npc', id: 'bavko' });
    expect(targetAt(map, { x: 0, y: 2 })).toEqual({ kind: 'spot', id: 'pebble-cove' });
    expect(targetAt(map, { x: 5, y: 0 })).toEqual({ kind: 'station', id: 'post-pot' });
    expect(targetAt(map, { x: 1, y: 1 })).toBeNull();
    expect(targetTile(map, { kind: 'station', id: 'post-pot' })).toEqual({ x: 5, y: 0 });
    expect(facedTarget(map, { x: 4, y: 0 }, 'right')).toEqual({ kind: 'station', id: 'post-pot' });
    expect(standBeside(map, { x: 4, y: 0 }, { x: 5, y: 0 }, () => true)).toEqual({ x: 4, y: 0 });
    expect(standBeside(map, { x: 5, y: 2 }, { x: 0, y: 2 }, () => true)).toEqual({ x: 1, y: 2 });
  });

  it('turns a character toward whoever talks to them', () => {
    expect(facingToward({ x: 3, y: 1 }, { x: 3, y: 2 })).toBe('down');
    expect(facingToward({ x: 3, y: 1 }, { x: 3, y: 0 })).toBe('up');
    expect(facingToward({ x: 3, y: 1 }, { x: 2, y: 1 })).toBe('left');
    expect(facingToward({ x: 3, y: 1 }, { x: 4, y: 1 })).toBe('right');
  });
});

describe('marks over heads', () => {
  it('points a new player to the character who gives the first creature', () => {
    const starter = [...STORY.dialogue].find(([, dialogue]) => Object.values(dialogue.nodes).some((node) => node.effects?.some((effect) => 'offerStarter' in effect)))![0];
    expect(starterNpc(progress(), emptyStory(), STORY)).toBe(starter);
    expect([...headMarks(progress(), emptyStory(), STORY)]).toEqual([[starter, 'newQuest']]);
  });

  it('shows the quest marks once the player has a creature, and nothing before the story is known', () => {
    const player = progress({ team: [newCreature('glowbun', 5, CONTENT)] });
    expect(starterNpc(player, emptyStory(), STORY)).toBeNull();
    const marks = headMarks(player, emptyStory(), STORY);
    expect(marks.size).toBeGreaterThan(0);
    expect([...marks.values()].every((mark) => mark === 'newQuest')).toBe(true);
    expect(headMarks(player, null, STORY).size).toBe(0);
    expect(headMarks(null, emptyStory(), STORY).size).toBe(0);
  });
});
