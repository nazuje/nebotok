import { z } from 'zod';
import { DIRECTIONS, stepFrom, type Point } from './grid.ts';

/** Every map uses 16 by 16 pixel tiles. */
export const TILE_SIZE = 16;
export const MAX_MAP_SIDE = 256;

/** The only spawn the rules ask for so far: where a new player, or one whose saved tile is gone, appears. */
export const PLAYER_SPAWN = 'player';

/**
 * Optional object layers: rectangles of tall grass named by encounter zone, points named by shrine,
 * points named by npc id (the character stands there, and the tile is blocked) and points named
 * by map mark (places quests send the player to).
 */
export const ENCOUNTER_LAYER = 'encounters';
export const SHRINE_LAYER = 'shrines';
export const NPC_LAYER = 'npcs';
export const MARK_LAYER = 'marks';
export const SPOT_LAYER = 'spots';
export const STATION_LAYER = 'stations';

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
  width: z.number().finite().min(0).optional(),
  height: z.number().finite().min(0).optional(),
});
type MapObject = z.infer<typeof MapObject>;

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

/** A rectangle of tiles where an encounter zone's wild creatures live, in tiles. */
export type EncounterArea = {
  readonly zone: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * What the rules know about a map: its size, which tiles can be walked on, its named spawn points,
 * its shrines (by shrine id), its tall grass (in map order), where its characters stand (by npc
 * id), its marks (by mark id), its gathering spots (by spot id) and its stations (by station id).
 */
export type WorldMap = {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  /** Row-major: the tile at (x, y) is `walkable[y * width + x]`. */
  readonly walkable: readonly boolean[];
  readonly spawns: Readonly<Record<string, Point>>;
  readonly shrines: Readonly<Record<string, Point>>;
  readonly encounterAreas: readonly EncounterArea[];
  readonly npcs: Readonly<Record<string, Point>>;
  readonly marks: Readonly<Record<string, Point>>;
  readonly spots: Readonly<Record<string, Point>>;
  readonly stations: Readonly<Record<string, Point>>;
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
 * tile there, no tile on any tile layer there has the `collides` property set to true, and no
 * character of the `npcs` layer, spot of the `spots` layer or station of the `stations` layer
 * stands there. A character or station must stand on a tile that would otherwise be walkable, so
 * that players can reach it; a spot may stand on water or the island's edge. No two of them share a tile.
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

  const objectsOf = (name: string): readonly MapObject[] => {
    const layer = tiled.layers.find((candidate) => candidate.type === 'objectgroup' && candidate.name === name);
    return layer?.type === 'objectgroup' ? layer.objects : [];
  };
  const spawns = namedPoints(objectsOf('spawns'), 'spawn', tiled, problems);
  if (!(PLAYER_SPAWN in spawns)) problems.push(`the "spawns" layer needs a point named "${PLAYER_SPAWN}"`);
  const shrines = namedPoints(objectsOf(SHRINE_LAYER), 'shrine', tiled, problems);
  const encounterAreas = objectsOf(ENCOUNTER_LAYER).flatMap((object) => encounterArea(object, tiled, problems));
  const npcs = namedPoints(objectsOf(NPC_LAYER), 'npc', tiled, problems);
  const marks = namedPoints(objectsOf(MARK_LAYER), 'mark', tiled, problems);
  const spots = namedPoints(objectsOf(SPOT_LAYER), 'spot', tiled, problems);
  const stations = namedPoints(objectsOf(STATION_LAYER), 'station', tiled, problems);
  if (problems.length > 0 || !ground) return { ok: false, problems };

  const walkable = Array.from({ length: area }, (_, at) => {
    if (((ground.data[at] ?? 0) & GID_MASK) === 0) return false;
    return tileLayers.every((layer) => !blocked.has((layer.data[at] ?? 0) & GID_MASK));
  });
  const standing = new Map<number, string>();
  const stand = (label: string, points: Record<string, Point>, mustBeWalkable: boolean) => {
    for (const [name, at] of Object.entries(points)) {
      const index = at.y * tiled.width + at.x;
      const other = standing.get(index);
      if (other !== undefined) problems.push(`${label} "${name}" at ${at.x},${at.y} shares its tile with ${other}`);
      standing.set(index, `${label} "${name}"`);
      if (mustBeWalkable && !walkable[index]) problems.push(`${label} "${name}" at ${at.x},${at.y} stands on a tile nobody can walk to`);
    }
  };
  stand('npc', npcs, true);
  stand('station', stations, true);
  stand('spot', spots, false);
  for (const index of standing.keys()) walkable[index] = false;
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, map: { id, width: tiled.width, height: tiled.height, walkable, spawns, shrines, encounterAreas, npcs, marks, spots, stations } };
}

/** Named points of an object layer, as the tiles they sit on. Unnamed objects are ignored. */
function namedPoints(objects: readonly MapObject[], label: string, tiled: TiledMap, problems: string[]): Record<string, Point> {
  const points: Record<string, Point> = {};
  for (const object of objects) {
    if (!object.name) continue;
    const at = { x: Math.floor(object.x / TILE_SIZE), y: Math.floor(object.y / TILE_SIZE) };
    if (at.x >= tiled.width || at.y >= tiled.height) problems.push(`${label} "${object.name}" is outside the map`);
    if (object.name in points) problems.push(`${label} "${object.name}" appears twice`);
    points[object.name] = at;
  }
  return points;
}

/** A rectangle of the encounters layer, as every tile it touches. */
function encounterArea(object: MapObject, tiled: TiledMap, problems: string[]): EncounterArea[] {
  const width = object.width ?? 0;
  const height = object.height ?? 0;
  if (!object.name || width <= 0 || height <= 0) {
    problems.push(`encounter area ${object.id} needs a name (the zone id) and a size: draw a rectangle`);
    return [];
  }
  const x = Math.floor(object.x / TILE_SIZE);
  const y = Math.floor(object.y / TILE_SIZE);
  const right = Math.ceil((object.x + width) / TILE_SIZE);
  const bottom = Math.ceil((object.y + height) / TILE_SIZE);
  if (right > tiled.width || bottom > tiled.height) problems.push(`encounter area "${object.name}" reaches outside the map`);
  return [{ zone: object.name, x, y, width: right - x, height: bottom - y }];
}

export function inBounds(map: WorldMap, at: Point): boolean {
  return Number.isInteger(at.x) && Number.isInteger(at.y) && at.x >= 0 && at.y >= 0 && at.x < map.width && at.y < map.height;
}

export function isWalkable(map: WorldMap, at: Point): boolean {
  return inBounds(map, at) && map.walkable[at.y * map.width + at.x] === true;
}

/** A map from rows of text, for tests and goldens: `#` is blocked, anything else walkable. It has no shrines, tall grass, characters, marks, spots or stations. */
export function mapFromRows(id: string, rows: readonly string[], spawn: Point = { x: 0, y: 0 }): WorldMap {
  const width = rows[0]?.length ?? 0;
  if (width === 0 || rows.some((row) => row.length !== width)) throw new RangeError('mapFromRows() needs equal, non-empty rows');
  return {
    id,
    width,
    height: rows.length,
    walkable: rows.flatMap((row) => [...row].map((cell) => cell !== '#')),
    spawns: { [PLAYER_SPAWN]: spawn },
    shrines: {},
    encounterAreas: [],
    npcs: {},
    marks: {},
    spots: {},
    stations: {},
  };
}

/** The encounter zone whose tall grass covers a tile, or null. Where areas overlap, the first in the map wins. */
export function encounterZoneAt(map: WorldMap, at: Point): string | null {
  const found = map.encounterAreas.find((area) => at.x >= area.x && at.y >= area.y && at.x < area.x + area.width && at.y < area.y + area.height);
  return found?.zone ?? null;
}

/**
 * The shrine a player standing on `at` touches: one on that tile or a tile next to it (not
 * diagonally), or null. When two are in reach, the first by id wins.
 */
export function shrineAt(map: WorldMap, at: Point): string | null {
  for (const id of Object.keys(map.shrines).toSorted()) {
    const shrine = map.shrines[id] as Point;
    if (Math.abs(shrine.x - at.x) + Math.abs(shrine.y - at.y) <= 1) return id;
  }
  return null;
}

/** The ids of the points within one step of `at` (on it or next to it, not diagonally), by id. */
function pointsInReach(points: Readonly<Record<string, Point>>, at: Point): string[] {
  return Object.keys(points)
    .toSorted()
    .filter((id) => {
      const point = points[id] as Point;
      return Math.abs(point.x - at.x) + Math.abs(point.y - at.y) <= 1;
    });
}

/**
 * The characters a player standing on `at` can talk to: those on a tile next to it, not
 * diagonally, by id. A character's own tile is blocked, so nobody stands on it.
 */
export function npcsInReach(map: WorldMap, at: Point): string[] {
  return pointsInReach(map.npcs, at);
}

/** Whether a player standing on `at` can talk to the character `npc`. */
export function npcInReach(map: WorldMap, at: Point, npc: string): boolean {
  return npcsInReach(map, at).includes(npc);
}

/** Whether a player standing on `at` can gather at `spot`: it is on a tile next to theirs, not diagonally. */
export function spotInReach(map: WorldMap, at: Point, spot: string): boolean {
  return pointsInReach(map.spots, at).includes(spot);
}

/** Whether a player standing on `at` can use `station`: it is on a tile next to theirs, not diagonally. */
export function stationInReach(map: WorldMap, at: Point, station: string): boolean {
  return pointsInReach(map.stations, at).includes(station);
}

/** The marks a player standing on `at` has reached: on that tile or next to it, not diagonally, by id. */
export function marksAt(map: WorldMap, at: Point): string[] {
  return pointsInReach(map.marks, at);
}

/**
 * Where a player wakes after their whole team fainted: their last shrine's tile when it is on this
 * map, else the map's player spawn. Spread arrivals out from here with `freeTileNear`.
 */
export function wakePoint(map: WorldMap, lastShrine: { readonly map: string; readonly shrine: string } | null): Point {
  const shrine = lastShrine && lastShrine.map === map.id ? map.shrines[lastShrine.shrine] : undefined;
  const spawn = map.spawns[PLAYER_SPAWN];
  if (shrine) return shrine;
  if (!spawn) throw new RangeError(`map ${map.id} has no ${PLAYER_SPAWN} spawn`);
  return spawn;
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

/**
 * Where a new arrival stands: the walkable tile nearest `from` (counted in steps along the grid,
 * ignoring walls) that is reachable from it and not in `taken`. Each ring of tiles the same
 * distance away is searched top row first, left before right, so every machine picks the same
 * tile. `from` itself when it is free, and `from` again when every reachable tile is taken.
 */
export function freeTileNear(map: WorldMap, from: Point, taken: readonly Point[]): Point {
  const held = new Set(taken.map((at) => at.y * map.width + at.x));
  const reached = reachableFrom(map, from);
  const free = (at: Point) => inBounds(map, at) && reached[at.y * map.width + at.x] === true && !held.has(at.y * map.width + at.x);
  if (free(from)) return from;
  for (let distance = 1; distance < map.width + map.height; distance += 1) {
    for (let dy = -distance; dy <= distance; dy += 1) {
      const dx = distance - Math.abs(dy);
      const left = { x: from.x - dx, y: from.y + dy };
      if (free(left)) return left;
      const right = { x: from.x + dx, y: from.y + dy };
      if (dx !== 0 && free(right)) return right;
    }
  }
  return from;
}

/**
 * Problems a playable map must not have: a blocked player spawn, walkable tiles nobody can reach,
 * a shrine on a blocked tile (players wake on it), a mark on a blocked tile, or a character, spot
 * or station with no reachable tile next to it to use it from.
 */
export function playabilityProblems(map: WorldMap): readonly string[] {
  const spawn = map.spawns[PLAYER_SPAWN];
  if (!spawn) return [`no "${PLAYER_SPAWN}" spawn`];
  if (!isWalkable(map, spawn)) return [`the "${PLAYER_SPAWN}" spawn at ${spawn.x},${spawn.y} is not walkable`];
  const problems = Object.entries(map.shrines).flatMap(([id, at]) => (isWalkable(map, at) ? [] : [`shrine "${id}" at ${at.x},${at.y} is not walkable`]));
  for (const [id, at] of Object.entries(map.marks)) if (!isWalkable(map, at)) problems.push(`mark "${id}" at ${at.x},${at.y} is not walkable`);
  const reached = reachableFrom(map, spawn);
  for (const [label, points] of [['npc', map.npcs], ['spot', map.spots], ['station', map.stations]] as const) {
    for (const [id, at] of Object.entries(points)) {
      const sides = DIRECTIONS.map((direction) => stepFrom(at, direction)).filter((side) => isWalkable(map, side) && reached[side.y * map.width + side.x]);
      if (sides.length === 0) problems.push(`${label} "${id}" at ${at.x},${at.y} has no tile next to it that players can reach`);
    }
  }
  const stranded = map.walkable.flatMap((walkable, at) => (walkable && !reached[at] ? [`${at % map.width},${Math.floor(at / map.width)}`] : []));
  if (stranded.length > 0) problems.push(`${stranded.length} walkable tile(s) cannot be reached from the spawn, first at ${stranded.slice(0, 5).join(' ')}`);
  return problems;
}
