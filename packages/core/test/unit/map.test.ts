import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import avatars from '../../../../content/avatars.json' with { type: 'json' };
import world from '../../../../content/world.json' with { type: 'json' };
import encounters from '../../../../content/encounters.json' with { type: 'json' };
import shrines from '../../../../content/shrines.json' with { type: 'json' };
import {
  EncountersFile,
  PLAYER_SPAWN,
  ShrinesFile,
  checkContentFile,
  encounterZoneAt,
  freeTileNear,
  isWalkable,
  mapFromRows,
  mapLinkProblems,
  playabilityProblems,
  readTiledMap,
  reachableFrom,
  shrineAt,
  wakePoint,
} from '../../src/index.ts';

const postIsland: unknown = JSON.parse(readFileSync(new URL('../../../../content/maps/post-island.tmj', import.meta.url), 'utf8'));

/** A small valid Tiled map: 3 by 2, all grass, with tile 2 marked as colliding. */
function tinyMap(overrides: Record<string, unknown> = {}) {
  return {
    type: 'map',
    orientation: 'orthogonal',
    infinite: false,
    width: 3,
    height: 2,
    tilewidth: 16,
    tileheight: 16,
    layers: [
      { type: 'tilelayer', name: 'ground', width: 3, height: 2, x: 0, y: 0, data: [1, 1, 1, 1, 1, 1] },
      { type: 'tilelayer', name: 'decor', width: 3, height: 2, x: 0, y: 0, data: [0, 2, 0, 0, 0, 0] },
      { type: 'objectgroup', name: 'spawns', objects: [{ id: 1, name: 'player', x: 8, y: 24, point: true }] },
    ],
    tilesets: [
      {
        firstgid: 1,
        name: 'tiles',
        image: 'tiles.png',
        imagewidth: 32,
        imageheight: 16,
        tilewidth: 16,
        tileheight: 16,
        tilecount: 2,
        columns: 2,
        tiles: [{ id: 1, properties: [{ name: 'collides', type: 'bool', value: true }] }],
      },
    ],
    ...overrides,
  };
}

describe('Tiled maps', () => {
  it('reads the real Post Island map', () => {
    const result = readTiledMap('post-island', postIsland);
    if (!result.ok) throw new Error(result.problems.join('\n'));
    expect(result.map.width).toBe(40);
    expect(result.map.height).toBe(30);
    expect(isWalkable(result.map, result.map.spawns[PLAYER_SPAWN]!)).toBe(true);
    expect(playabilityProblems(result.map)).toEqual([]);
    expect(checkContentFile('maps/post-island.tmj', postIsland)).toEqual({ ok: true });
  });

  it('blocks tiles marked collides on any layer, and tiles with no ground', () => {
    const result = readTiledMap('tiny', tinyMap());
    if (!result.ok) throw new Error(result.problems.join('\n'));
    expect(result.map.walkable).toEqual([true, false, true, true, true, true]);
    expect(result.map.spawns).toEqual({ player: { x: 0, y: 1 } });
    const holes = tinyMap();
    (holes.layers[0] as { data: number[] }).data = [1, 1, 1, 0, 1, 1];
    const holed = readTiledMap('tiny', holes);
    expect(holed.ok && holed.map.walkable[3]).toBe(false);
  });

  it('ignores Tiled flip bits when reading tiles', () => {
    const flipped = tinyMap();
    (flipped.layers[1] as { data: number[] }).data = [0, 2 + 0x80000000, 0, 0, 0, 0];
    const result = readTiledMap('tiny', flipped);
    expect(result.ok && result.map.walkable[1]).toBe(false);
  });

  it.each([
    ['an external tileset', { tilesets: [{ firstgid: 1, source: 'tiles.tsj' }] }, /embedded/],
    ['base64 layer data', { layers: [{ type: 'tilelayer', name: 'ground', width: 3, height: 2, data: 'AQAAAA==' }] }, /CSV/],
    ['an infinite map', { infinite: true }, /fixed-size/],
    ['32 pixel tiles', { tilewidth: 32 }, /16/],
  ])('explains why it refuses %s', (_label, overrides, message) => {
    const result = readTiledMap('tiny', tinyMap(overrides));
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.problems.join('\n')).toMatch(message);
  });

  it('needs ground, decor and spawns layers, a player spawn and known tiles', () => {
    const noLayers = readTiledMap('tiny', tinyMap({ layers: [{ type: 'tilelayer', name: 'other', width: 3, height: 2, data: [9, 0, 0, 0, 0, 0] }] }));
    expect(noLayers.ok ? [] : noLayers.problems).toEqual([
      'needs a tile layer named "ground"',
      'needs a tile layer named "decor"',
      'needs an object layer named "spawns"',
      'layer "other" uses tile 9, which no tileset has',
      'the "spawns" layer needs a point named "player"',
    ]);
    expect(readTiledMap('Bad Id', tinyMap()).ok).toBe(false);
  });

  it('refuses a layer of the wrong size and a spawn outside the map', () => {
    const wrong = tinyMap();
    (wrong.layers[1] as { data: number[] }).data = [0, 0, 0];
    (wrong.layers[2] as { objects: unknown[] }).objects = [{ id: 1, name: 'player', x: 100, y: 0 }];
    const result = readTiledMap('tiny', wrong);
    expect(result.ok ? [] : result.problems).toEqual(['layer "decor" is not 3 by 2', 'spawn "player" is outside the map']);
  });
});

describe('map playability', () => {
  it('finds tiles nobody can reach', () => {
    const map = mapFromRows('t', ['..#.', '..#.'], { x: 0, y: 0 });
    expect(reachableFrom(map, { x: 0, y: 0 }).filter(Boolean)).toHaveLength(4);
    expect(playabilityProblems(map)).toEqual(['2 walkable tile(s) cannot be reached from the spawn, first at 3,0 3,1']);
  });

  it('refuses a blocked spawn', () => {
    expect(playabilityProblems(mapFromRows('t', ['#.'], { x: 0, y: 0 }))).toEqual(['the "player" spawn at 0,0 is not walkable']);
  });

  it('turns map problems into content problems', () => {
    const stranded = tinyMap();
    (stranded.layers[1] as { data: number[] }).data = [0, 2, 0, 0, 2, 0];
    expect(checkContentFile('maps/tiny.tmj', stranded)).toEqual({
      ok: false,
      problems: ['(root): 2 walkable tile(s) cannot be reached from the spawn, first at 2,0 2,1'],
    });
  });
});

describe('where a new arrival stands', () => {
  const open = mapFromRows('t', ['.....', '.....', '.....', '.....', '.....'], { x: 2, y: 2 });
  const spawn = { x: 2, y: 2 };

  it('is the spawn itself while nobody stands there', () => {
    expect(freeTileNear(open, spawn, [])).toEqual(spawn);
    expect(freeTileNear(open, spawn, [{ x: 1, y: 2 }])).toEqual(spawn);
  });

  it('fills the tiles around the spawn one ring at a time, in a fixed order', () => {
    const taken = [spawn];
    for (let arrival = 0; arrival < 12; arrival += 1) taken.push(freeTileNear(open, spawn, taken));
    expect(taken.map(({ x, y }) => `${x},${y}`)).toEqual([
      '2,2',
      '2,1', '1,2', '3,2', '2,3',
      '2,0', '1,1', '3,1', '0,2', '4,2', '1,3', '3,3', '2,4',
    ]);
  });

  it('skips blocked tiles and tiles that cannot be reached from the spawn', () => {
    const walled = mapFromRows('t', ['.#.', '.#.', '.#.'], { x: 0, y: 0 });
    // 2,0 is as near as 0,2 and comes first in the ring, but the wall cuts it off.
    expect(freeTileNear(walled, { x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 0, y: 1 }])).toEqual({ x: 0, y: 2 });
  });

  it('is the spawn again when every reachable tile is taken', () => {
    const tiny = mapFromRows('t', ['..#.'], { x: 0, y: 0 });
    expect(freeTileNear(tiny, { x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 0 }])).toEqual({ x: 0, y: 0 });
  });
});

describe('world and avatar content', () => {
  it('accepts the real files', () => {
    expect(checkContentFile('world.json', world)).toEqual({ ok: true });
    expect(checkContentFile('avatars.json', avatars)).toEqual({ ok: true });
  });

  it('refuses a walk speed out of range and a repeated avatar', () => {
    expect(checkContentFile('world.json', { ...world, walkTilesPerSecond: 0 }).ok).toBe(false);
    const first = avatars.avatars[0]!;
    expect(checkContentFile('avatars.json', { avatars: [first, first] })).toEqual({
      ok: false,
      problems: [`avatars.1.id: avatar "${first.id}" appears twice`],
    });
  });
});

function layers(extra: readonly unknown[]) {
  return { layers: [...tinyMap().layers, ...extra] };
}

describe('tall grass and shrines', () => {
  const grass = { type: 'objectgroup', name: 'encounters', objects: [{ id: 2, name: 'post-meadow', x: 16, y: 0, width: 20, height: 16 }] };
  const shrine = { type: 'objectgroup', name: 'shrines', objects: [{ id: 3, name: 'post-shrine', x: 40, y: 24, point: true }] };

  it('reads tall grass rectangles as every tile they touch, and shrines as points', () => {
    const result = readTiledMap('tiny', tinyMap(layers([grass, shrine])));
    if (!result.ok) throw new Error(result.problems.join('\n'));
    expect(result.map.encounterAreas).toEqual([{ zone: 'post-meadow', x: 1, y: 0, width: 2, height: 1 }]);
    expect(result.map.shrines).toEqual({ 'post-shrine': { x: 2, y: 1 } });
    expect([encounterZoneAt(result.map, { x: 2, y: 0 }), encounterZoneAt(result.map, { x: 0, y: 0 }), encounterZoneAt(result.map, { x: 2, y: 1 })]).toEqual(['post-meadow', null, null]);
    expect(mapLinkProblems(result.map, EncountersFile.parse(encounters), ShrinesFile.parse(shrines))).toEqual([]);
  });

  it('touches a shrine from its own tile or the next one, never diagonally', () => {
    const result = readTiledMap('tiny', tinyMap(layers([shrine])));
    if (!result.ok) throw new Error(result.problems.join('\n'));
    expect(shrineAt(result.map, { x: 2, y: 1 })).toBe('post-shrine');
    expect(shrineAt(result.map, { x: 1, y: 1 })).toBe('post-shrine');
    expect(shrineAt(result.map, { x: 1, y: 0 })).toBeNull();
  });

  it('wakes a player at their last shrine on this map, else at the player spawn', () => {
    const result = readTiledMap('tiny', tinyMap(layers([shrine])));
    if (!result.ok) throw new Error(result.problems.join('\n'));
    expect(wakePoint(result.map, { map: 'tiny', shrine: 'post-shrine' })).toEqual({ x: 2, y: 1 });
    expect(wakePoint(result.map, { map: 'other-island', shrine: 'post-shrine' })).toEqual({ x: 0, y: 1 });
    expect(wakePoint(result.map, null)).toEqual({ x: 0, y: 1 });
  });

  it('reports grass without a size, a shrine on a blocked tile, and names no content file has', () => {
    const pointGrass = { ...grass, objects: [{ id: 2, name: 'post-meadow', x: 16, y: 0, point: true }] };
    expect(readTiledMap('tiny', tinyMap(layers([pointGrass])))).toMatchObject({ ok: false });
    const blocked = readTiledMap('tiny', tinyMap(layers([{ ...shrine, objects: [{ id: 3, name: 'post-shrine', x: 24, y: 8, point: true }] }])));
    if (!blocked.ok) throw new Error(blocked.problems.join('\n'));
    expect(playabilityProblems(blocked.map)).toContain('shrine "post-shrine" at 1,0 is not walkable');
    const unknown = readTiledMap('tiny', tinyMap(layers([{ ...grass, objects: [{ ...grass.objects[0], name: 'moon-grass' }] }, { ...shrine, objects: [{ ...shrine.objects[0], name: 'moon-shrine' }] }])));
    if (!unknown.ok) throw new Error(unknown.problems.join('\n'));
    expect(mapLinkProblems(unknown.map, EncountersFile.parse(encounters), ShrinesFile.parse(shrines))).toEqual([
      'encounter area "moon-grass" is not a zone in encounters.json',
      'shrine "moon-shrine" is not in shrines.json',
    ]);
  });

  it('gives a map drawn from rows no grass and no shrines', () => {
    expect(mapFromRows('rows', ['..'])).toMatchObject({ shrines: {}, encounterAreas: [] });
  });
});
