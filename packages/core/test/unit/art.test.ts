import { describe, expect, it } from 'vitest';
import { DEFAULT_COURIER, animationFrameAt, checkContentFile, loadArt, missingArt, pixelColour, type PixelSprite } from '../../src/index.ts';

const row = (pixels: string) => pixels.padEnd(16, '.');
const tile = (frames: Record<string, string[]> = { still: Array.from({ length: 16 }, () => row('g')) }, extra: object = {}) => ({
  width: 16,
  height: 16,
  palette: { g: '#5bbf5b', k: '#1b1b2f' },
  frames,
  ...extra,
});
const problems = (file: string, raw: unknown) => {
  const result = checkContentFile(file, raw);
  return result.ok ? [] : result.problems;
};

describe('art schemas', () => {
  it('accepts a drawn sprite, a recolour and a PNG sprite', () => {
    expect(problems('art/tiles/grass.json', tile())).toEqual([]);
    expect(problems('art/couriers/blue.json', { recolour: 'couriers/courier', palette: { y: '#3a7bd5' } })).toEqual([]);
    expect(problems('art/tiles/grass.json', { width: 16, height: 16, png: 'tiles/grass.png', frames: ['still', 'sway'], animations: { sway: { frames: ['still', 'sway'], ms: [500, 500] } } })).toEqual([]);
    expect(problems('art/tilesets/sky-tiles.json', { columns: 4, tiles: ['tiles/grass'] })).toEqual([]);
  });

  it('checks every frame is the sprite size', () => {
    const short = tile({ still: Array.from({ length: 15 }, () => row('g')) });
    expect(problems('art/tiles/grass.json', short)).toEqual(['frames.still: frame "still" has 15 rows, not 16']);
    const narrow = tile({ still: [...Array.from({ length: 15 }, () => row('g')), 'ggg'] });
    expect(problems('art/tiles/grass.json', narrow)).toEqual(['frames.still.15: frame "still" row 15 is 3 wide, not 16']);
  });

  it('checks every character is in the palette', () => {
    const stray = tile({ still: [row('gxq'), ...Array.from({ length: 15 }, () => row('g'))] });
    expect(problems('art/tiles/grass.json', stray)).toEqual(['frames.still.0: frame "still" row 0 uses "x", "q", not in the palette']);
  });

  it('keeps palettes to 16 colours, with "." always transparent', () => {
    const big = Object.fromEntries('abcdefghijklmnopq'.split('').map((key) => [key, '#000000']));
    expect(problems('art/tiles/grass.json', { ...tile(), palette: big })).toEqual(['palette: has 1 to 16 colours, not 17']);
    expect(problems('art/tiles/grass.json', { ...tile(), palette: { '.': '#000000', g: '#5bbf5b' } })).toEqual(['palette..: palette key "." must be one character other than "."']);
    expect(problems('art/tiles/grass.json', tile({ Still: Array.from({ length: 16 }, () => row('g')) })).join()).toContain('"Still": frame and animation names');
    expect(problems('art/tiles/grass.json', { ...tile(), palette: { g: 'green' } }).join()).toContain('#3a7bd5');
  });

  it('checks animations play frames the sprite has, with a time for each', () => {
    expect(problems('art/tiles/grass.json', tile(undefined, { animations: { sway: { frames: ['still', 'bent'], ms: [500, 500] } } }))).toEqual([
      'animations.sway.frames.1: animation "sway" plays frame "bent", which this sprite does not have',
    ]);
    expect(problems('art/tiles/grass.json', tile(undefined, { animations: { sway: { frames: ['still'], ms: [500, 500] } } })).join()).toContain('one "ms" for each frame');
  });

  it('checks each kind of sprite has its size and the frames the game asks for', () => {
    expect(problems('art/creatures/glowbun.json', tile())).toEqual([
      '(root): creatures sprites are 32×32 or 48×48, not 16×16',
      '(root): creatures sprites need a frame "front"',
      '(root): creatures sprites need a frame "back"',
    ]);
    expect(problems('art/couriers/courier.json', tile()).join()).toContain('need a frame "down-stand"');
    expect(problems('art/monsters/x.json', tile())).toEqual(['(root): "monsters" is not a kind of sprite; use one of tiles, couriers, creatures, icons, backgrounds, items, weather, characters, portraits, effects']);
  });
});

const courier = (cap: string) => ({
  width: 16,
  height: 16,
  palette: { k: '#1b1b2f', y: cap },
  frames: Object.fromEntries(['down', 'up', 'right'].flatMap((facing) => ['stand', 'step-a', 'step-b'].map((pose) => [`${facing}-${pose}`, Array.from({ length: 16 }, () => row('ky'))]))),
  animations: Object.fromEntries(['down', 'up', 'right'].map((facing) => [`walk-${facing}`, { frames: [`${facing}-stand`], ms: [100] }])),
});

describe('loadArt', () => {
  it('applies recolours to their base', () => {
    const art = loadArt({ 'art/couriers/courier.json': courier('#8a8a8a'), 'art/couriers/blue.json': { recolour: 'couriers/courier', palette: { y: '#3a7bd5' } } });
    expect(art.problems).toEqual([]);
    const blue = art.sprites.get('couriers/blue') as PixelSprite;
    expect(blue.palette).toEqual({ k: '#1b1b2f', y: '#3a7bd5' });
    expect(pixelColour(blue, 'down-stand', 1, 0)).toBe(0x3a7bd5);
    expect(pixelColour(blue, 'down-stand', 5, 0)).toBeNull();
  });

  it('reports recolours of a missing, a PNG or a mismatched base', () => {
    const png = { width: 16, height: 16, png: 'tiles/grass.png', frames: ['still'] };
    const art = loadArt({
      'art/tiles/grass.json': png,
      'art/tiles/a.json': { recolour: 'tiles/none', palette: { g: '#000000' } },
      'art/tiles/b.json': { recolour: 'tiles/grass', palette: { g: '#000000' } },
      'art/tiles/c.json': tile(),
      'art/tiles/d.json': { recolour: 'tiles/c', palette: { z: '#000000' } },
    });
    expect(art.problems).toEqual([
      'content/art/tiles/a.json: tiles/a recolours tiles/none, which does not exist',
      'content/art/tiles/b.json: tiles/b recolours tiles/grass, which is not drawn in its file',
      'content/art/tiles/d.json: tiles/d recolours "z", not in the palette of tiles/c',
    ]);
  });

  it('checks a tileset names tiles that exist', () => {
    const art = loadArt({ 'art/tiles/grass.json': tile(), 'art/tilesets/island.json': { columns: 2, tiles: ['tiles/grass', 'tiles/none', 'items/grass'] } });
    expect(art.problems).toEqual([
      'content/art/tilesets/island.json: tile 1 is tiles/none, which does not exist',
      'content/art/tilesets/island.json: tile 2 is items/grass, which is not a tiles/ sprite',
    ]);
  });

  it('lists every sprite content needs and the art lacks', () => {
    const art = loadArt({ 'art/couriers/courier.json': courier('#8a8a8a') });
    expect(missingArt(art, { avatars: ['blue'], species: ['glowbun'], weather: ['sun'], items: ['berry'], npcs: ['bavko'], cues: ['storm-glimpse'], tilesets: ['sky-tiles'] })).toEqual([
      'avatar "blue" needs the sprite couriers/blue (content/art/couriers/blue.json)',
      'species "glowbun" needs the sprite creatures/glowbun (content/art/creatures/glowbun.json)',
      'species "glowbun" needs the sprite icons/glowbun (content/art/icons/glowbun.json)',
      'weather "sun" needs the sprite backgrounds/sun (content/art/backgrounds/sun.json)',
      'weather "sun" needs the sprite weather/sun (content/art/weather/sun.json)',
      'item "berry" needs the sprite items/berry (content/art/items/berry.json)',
      'npc "bavko" needs the sprite characters/bavko (content/art/characters/bavko.json)',
      'npc "bavko" needs the sprite portraits/bavko (content/art/portraits/bavko.json)',
      'story cue "storm-glimpse" needs the sprite effects/storm-glimpse (content/art/effects/storm-glimpse.json)',
      'tileset "sky-tiles" needs content/art/tilesets/sky-tiles.json',
    ]);
    expect(missingArt(loadArt({}), { avatars: [], species: [], weather: [], items: [], npcs: [], cues: [], tilesets: [] })).toEqual([
      `the game, for avatars without a courier of their own, needs the sprite ${DEFAULT_COURIER} (content/art/${DEFAULT_COURIER}.json)`,
    ]);
  });

  it('picks the frame an animation shows at any moment, looping', () => {
    const sway = { frames: ['still', 'sway'], ms: [700, 300] };
    expect([0, 699, 700, 999, 1_000, 1_750].map((ms) => animationFrameAt(sway, ms))).toEqual(['still', 'still', 'sway', 'sway', 'still', 'sway']);
  });
});
