import { z } from 'zod';
import { DIRECTIONS, stepFrom, type Point } from './grid.ts';

/** Every map uses 16 by 16 pixel tiles. */
export const TILE_SIZE = 16;
export const MAX_MAP_SIDE = 256;

/** The only spawn the rules ask for so far: where a new player, or one whose saved tile is gone, appears. */
export const PLAYER_SPAWN = 'player';

/** Tiled flips and rotates a tile by setting the top three bits of its gid. */
const GID_MASK = 0x1fffffff;

const MapId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'map ids are lowercase words joined by dashes');
export { MapId };

const Side = z.number().int().min(1).max(MAX_MAP_SIDE);
const Gid = z.number().int().min(0).max(0xffffffff);

const Property = z.object({ name: z.string().min(1), type: z.string().optional(), value: z.unknown() });

const TileLayer = z.object({
  type: z.literal('tilelayer'),
  name: z.string().min(1),
  width: Side,
  height: Side,
  // CSV or the default array format. Base64 arrives as a string and is refused here on purpose.
  data: z.array(Gid, { error: 'tile layer data must be an array: set Tile Layer Format to CSV in Tiled' }),
  encoding: z.literal('csv').optional(),
  x: z.literal(0).optional(),
  y: z.literal(0).optional(),
});

const MapObject = z.object({
  id: z.number().int(),
  name: z.string(),
  x: z.number().finite().min(0),
  y: z.number().finite().min(0),
});

const ObjectLayer = z.object({
  type: z.literal('objectgroup'),
  name: z.string().min(1),
  objects: z.array(MapObject).max(1_000),
});

const Layer = z.discriminatedUnion('type', [TileLayer, ObjectLayer], {
  error: 'layers must be tile layers or object layers (no group or image layers)',
});

const Tile = z.object({ id: z.number().int().min(0), properties: z.array(Property).optional() });

const Tileset = z.object(
  {
    source: z.never({ error: 'tilesets must be embedded in the map (Map > Embed Tilesets in Tiled)' }).optional(),
    firstgid: z.number().int().min(1),
    name: z.string().min(1),
    image: z.string().regex(/^[a-z0-9-]+\.png$/, 'tileset images sit next to the map as <name>.png'),
    imagewidth: z.number().int().min(TILE_SIZE),
    imageheight: z.number().int().min(TILE_SIZE),
    tilewidth: z.literal(TILE_SIZE),
    tileheight: z.literal(TILE_SIZE),
    tilecount: z.number().int().min(1).max(4_096),
    columns: z.number().int().min(1),
    margin: z.literal(0).optional(),
    spacing: z.literal(0).optional(),
    tiles: z.array(Tile).optional(),
  },
);

/** The part of Tiled's JSON map format the game reads. Tiled's other fields are allowed and ignored. */
export const TiledMap = z.object({
  type: z.literal('map'),
  orientation: z.literal('orthogonal'),
  infinite: z.literal(false, { error: 'maps must be fixed-size, not infinite' }),
  width: Side,
  height: Side,
  tilewidth: z.literal(TILE_SIZE),
  tileheight: z.literal(TILE_SIZE),
  layers: z.array(Layer).min(1).max(32),
  tilesets: z.array(Tileset).min(1).max(8),
});
export type TiledMap = z.infer<typeof TiledMap>;

/** What the rules know about a map: its size, which tiles can be walked on, and its named spawn points. */
export type WorldMap = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Row-major: the tile at (x, y) is `walkable[y * width + x]`. */
  readonly walkable: readonly boolean[];
  readonly spawns: Readonly<Record<string, Point>>;
};

export type MapResult = { readonly ok: true; readonly map: WorldMap } | { readonly ok: false; readonly problems: readonly string[] };

function blockingGids(tilesets: TiledMap['tilesets']): { readonly blocked: ReadonlySet<number>; readonly known: (gid: number) => boolean } {
  const blocked = new Set<number>();
  for (const tileset of tilesets) {
    for (const tile of tileset.tiles ?? []) {
      if (tile.properties?.some((property) => property.name === 'collides' && property.value === true)) blocked.add(tileset.firstgid + tile.id);
    }
  }
  const known = (gid: number) => tilesets.some((tileset) => gid >= tileset.firstgid && gid < tileset.firstgid + tileset.tilecount);
  return { blocked, known };
}

/**
 * Turns a checked Tiled map into the rules' map. A tile is walkable when the `ground` layer has a
 * tile there and no tile on any tile layer there has the `collides` property set to true.
 */
export function readTiledMap(id: string, raw: unknown): MapResult {
  const parsed = TiledMap.safeParse(raw);
  if (!parsed.success) return { ok: false, problems: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(map)'}: ${issue.message}`) };
  const tiled = parsed.data;
  const problems: string[] = [];
  if (!MapId.safeParse(id).success) problems.push(`"${id}" is not a valid map id`);

  const tileLayers = tiled.layers.filter((layer) => layer.type === 'tilelayer');
  const names = tiled.layers.map((layer) => layer.name);
  for (const name of new Set(names)) if (names.filter((other) => other === name).length > 1) problems.push(`layer "${name}" appears twice`);
  const ground = tileLayers.find((layer) => layer.name === 'ground');
  if (!ground) problems.push('needs a tile layer named "ground"');
  if (!tileLayers.some((layer) => layer.name === 'decor')) problems.push('needs a tile layer named "decor"');
  const spawnLayer = tiled.layers.find((layer) => layer.type === 'objectgroup' && layer.name === 'spawns');
  if (!spawnLayer || spawnLayer.type !== 'objectgroup') problems.push('needs an object layer named "spawns"');

  const area = tiled.width * tiled.height;
  const { blocked, known } = blockingGids(tiled.tilesets);
  for (const layer of tileLayers) {
    if (layer.width !== tiled.width || layer.height !== tiled.height || layer.data.length !== area) {
      problems.push(`layer "${layer.name}" is not ${tiled.width} by ${tiled.height}`);
    }
    const unknown = layer.data.map((gid) => gid & GID_MASK).find((gid) => gid !== 0 && !known(gid));
    if (unknown !== undefined) problems.push(`layer "${layer.name}" uses tile ${unknown}, which no tileset has`);
  }

  const spawns: Record<string, Point> = {};
  for (const object of spawnLayer?.type === 'objectgroup' ? spawnLayer.objects : []) {
    if (!object.name) continue;
    const at = { x: Math.floor(object.x / TILE_SIZE), y: Math.floor(object.y / TILE_SIZE) };
    if (at.x >= tiled.width || at.y >= tiled.height) problems.push(`spawn "${object.name}" is outside the map`);
    if (object.name in spawns) problems.push(`spawn "${object.name}" appears twice`);
    spawns[object.name] = at;
  }
  if (!(PLAYER_SPAWN in spawns)) problems.push(`the "spawns" layer needs a point named "${PLAYER_SPAWN}"`);
  if (problems.length > 0 || !ground) return { ok: false, problems };

  const walkable = Array.from({ length: area }, (_, at) => {
    if (((ground.data[at] ?? 0) & GID_MASK) === 0) return false;
    return tileLayers.every((layer) => !blocked.has((layer.data[at] ?? 0) & GID_MASK));
  });
  return { ok: true, map: { id, width: tiled.width, height: tiled.height, walkable, spawns } };
}

export function inBounds(map: WorldMap, at: Point): boolean {
  return Number.isInteger(at.x) && Number.isInteger(at.y) && at.x >= 0 && at.y >= 0 && at.x < map.width && at.y < map.height;
}

export function isWalkable(map: WorldMap, at: Point): boolean {
  return inBounds(map, at) && map.walkable[at.y * map.width + at.x] === true;
}

/** A map from rows of text, for tests and goldens: `#` is blocked, anything else walkable. */
export function mapFromRows(id: string, rows: readonly string[], spawn: Point = { x: 0, y: 0 }): WorldMap {
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((row) => row.length !== width)) throw new RangeError('mapFromRows() needs equal, non-empty rows');
  return { id, width, height: rows.length, walkable: rows.flatMap((row) => [...row].map((cell) => cell !== '#')), spawns: { [PLAYER_SPAWN]: spawn } };
}

/** Every walkable tile reachable from `from` by 4-directional steps, as a row-major mask. */
export function reachableFrom(map: WorldMap, from: Point): readonly boolean[] {
  const seen = Array.from({ length: map.width * map.height }, () => false);
  if (!isWalkable(map, from)) return seen;
  const queue: Point[] = [from];
  seen[from.y * map.width + from.x] = true;
  for (let at = 0; at < queue.length; at += 1) {
    const current = queue[at] as Point;
    for (const direction of DIRECTIONS) {
      const next = stepFrom(current, direction);
      const index = next.y * map.width + next.x;
      if (isWalkable(map, next) && !seen[index]) {
        seen[index] = true;
        queue.push(next);
      }
    }
  }
  return seen;
}

/** Problems a playable map must not have: a blocked player spawn, or walkable tiles nobody can reach. */
export function playabilityProblems(map: WorldMap): readonly string[] {
  const spawn = map.spawns[PLAYER_SPAWN];
  if (!spawn) return [`no "${PLAYER_SPAWN}" spawn`];
  if (!isWalkable(map, spawn)) return [`the "${PLAYER_SPAWN}" spawn at ${spawn.x},${spawn.y} is not walkable`];
  const reached = reachableFrom(map, spawn);
  const stranded = map.walkable.flatMap((walkable, at) => (walkable && !reached[at] ? [`${at % map.width},${Math.floor(at / map.width)}`] : []));
  if (stranded.length === 0) return [];
  return [`${stranded.length} walkable tile(s) cannot be reached from the spawn, first at ${stranded.slice(0, 5).join(' ')}`];
}
