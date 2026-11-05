import { TiledMap, readTiledMap, type WorldMap } from '@nebotok/core';
import { SERVER_BASE } from './session.ts';

/** A map as both the rules and Phaser need it. */
export type LoadedMap = {
  readonly id: string;
  readonly world: WorldMap;
  /** Tiled's JSON as served, which Phaser reads itself. */
  readonly raw: unknown;
  readonly tileLayers: readonly string[];
  readonly tilesetName: string;
  /** The tileset's art, `content/art/tilesets/<name>.json`, named after its image. */
  readonly tilesetArt: string;
};

const loading = new Map<string, Promise<LoadedMap>>();

async function fetchMap(id: string): Promise<LoadedMap> {
  const response = await fetch(`${SERVER_BASE}/maps/${encodeURIComponent(id)}.tmj`);
  if (!response.ok) throw new Error(`map ${id} answered ${response.status}`);
  const raw: unknown = await response.json();
  const read = readTiledMap(id, raw);
  if (!read.ok) throw new Error(`map ${id} does not read: ${read.problems.join('; ')}`);
  const tiled = TiledMap.parse(raw);
  const tileset = tiled.tilesets[0];
  if (!tileset || tiled.tilesets.length > 1) throw new Error(`map ${id} needs exactly one tileset`);
  return {
    id,
    world: read.map,
    raw,
    tileLayers: tiled.layers.flatMap((layer) => (layer.type === 'tilelayer' ? [layer.name] : [])),
    tilesetName: tileset.name,
    tilesetArt: tileset.image.replace(/\.png$/, ''),
  };
}

/** Fetches and checks a map once; a failed fetch is tried again on the next call. */
export function loadMap(id: string): Promise<LoadedMap> {
  const known = loading.get(id);
  if (known) return known;
  const pending = fetchMap(id);
  loading.set(id, pending);
  pending.catch(() => loading.delete(id));
  return pending;
}
