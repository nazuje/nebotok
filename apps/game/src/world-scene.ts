import { PLAYER_SPAWN, type Point } from '@nebotok/core';
import { Loader, Scale, Scene, Scenes, Tilemaps, type GameObjects, type Time, type Tweens } from 'phaser';
import { courierTexture, frameName, walkAnimation } from './couriers.ts';
import type { LoadedMap } from './map-loader.ts';
import type { ShownPlayer, WorldView } from './world-view.ts';
import { TILE } from './zoom.ts';

export const WORLD_SCENE = 'world';
const SKY = '#8fd3ff';
/** How much of the gap to its courier the camera closes each frame. */
const FOLLOW_LERP = 0.15;
const PLAYER_DEPTH = 100;
const MARKER_DEPTH = PLAYER_DEPTH - 1;
const MARKER_COLOUR = 0xffffff;
const REFUSED_COLOUR = 0xd64545;
const REFUSED_MS = 450;
/** The ring under your own courier, so you can find yourself among others. */
const SELF_RING_COLOUR = 0xffffff;
const SELF_RING_OUTLINE = 0x1b1b2f;
/** An oval at the courier's feet, one string per pixel row from the tile's row 12: `o` outline, `r` ring. */
const SELF_RING = [
  '...oooooooooo...',
  '.oorrrrrrrrrroo.',
  'orro........orro',
  '.oorrrrrrrrrroo.',
] as const;
const SELF_RING_TOP = 12;
const AWAY_ALPHA = 0.5;
const AWAY_TINT = 0xb8c4d0;

/** A name to show above a courier, at a spot on the page in CSS pixels. */
export type NameLabel = { readonly id: string; readonly name: string; readonly away: boolean; readonly battling: boolean; readonly x: number; readonly y: number };

export type WorldSceneOptions = {
  readonly view: WorldView;
  /** Called at the start of every frame, before anything is drawn. */
  frame(now: number): void;
  /** Called after every frame is drawn, with where the other players' names go. */
  labels(labels: readonly NameLabel[]): void;
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The world: the map's tiles and every player's courier, drawn from the client's view model. */
export class WorldScene extends Scene {
  /** The map on screen, once its tiles are drawn. */
  mapId: string | null = null;
  readonly booted: Promise<void>;
  private readonly options: WorldSceneOptions;
  private readonly sprites = new Map<string, GameObjects.Sprite>();
  private shownPlayers: readonly ShownPlayer[] = [];
  private followed: GameObjects.Sprite | null = null;
  private currentMap: Tilemaps.Tilemap | null = null;
  private spawnTile: Point = { x: 0, y: 0 };
  private markBooted: () => void = () => {};
  private marker: GameObjects.Graphics | null = null;
  private selfRing: GameObjects.Graphics | null = null;
  private markerPulse: Tweens.Tween | null = null;
  private markerTimer: Time.TimerEvent | null = null;
  /** The tile the marker shows, unless it is only a short "can't go there". */
  markerTile: Point | null = null;

  constructor(options: WorldSceneOptions) {
    super(WORLD_SCENE);
    this.options = options;
    this.booted = new Promise((resolve) => {
      this.markBooted = resolve;
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(SKY);
    this.scale.on(Scale.Events.RESIZE, () => {
      if (!this.followed) this.centreOnSpawn();
    });
    this.events.on(Scenes.Events.RENDER, () => this.options.labels(this.labels()));
    this.markBooted();
  }

  /** Draws a map's tiles, replacing any map shown before. */
  async showMap(map: LoadedMap): Promise<void> {
    if (this.mapId === map.id) return;
    const key = `tiles-${map.id}`;
    if (!this.textures.exists(key)) await this.loadImage(key, map.tilesetUrl);
    if (!this.cache.tilemap.exists(map.id)) this.cache.tilemap.add(map.id, { format: Tilemaps.Formats.TILED_JSON, data: map.raw });
    this.currentMap?.destroy();
    const tilemap = this.make.tilemap({ key: map.id });
    const tileset = tilemap.addTilesetImage(map.tilesetName, key);
    if (!tileset) throw new Error(`map ${map.id} has no tileset named ${map.tilesetName}`);
    map.tileLayers.forEach((name, index) => tilemap.createLayer(name, tileset, 0, 0)?.setDepth(index));
    this.cameras.main.setBounds(0, 0, tilemap.widthInPixels, tilemap.heightInPixels);
    this.currentMap = tilemap;
    this.spawnTile = map.world.spawns[PLAYER_SPAWN] ?? { x: 0, y: 0 };
    this.mapId = map.id;
    if (!this.followed) this.centreOnSpawn();
  }

  override update(): void {
    const now = performance.now();
    this.options.frame(now);
    const view = this.options.view;
    const shown = this.mapId === null ? [] : view.shown(now);
    const seen = new Set<string>();
    for (const player of shown) {
      seen.add(player.id);
      this.draw(player, view.stepMs());
    }
    for (const [id, sprite] of this.sprites) {
      if (seen.has(id)) continue;
      sprite.destroy();
      this.sprites.delete(id);
    }
    this.shownPlayers = shown;
    const self = shown.find((player) => player.self);
    const selfSprite = self ? this.sprites.get(self.id) : undefined;
    this.ring(selfSprite);
    this.follow(selfSprite);
  }

  /** Where the centre of a tile is on the page, in CSS pixels. */
  tileToScreen(x: number, y: number): Point {
    return this.toScreen(x * TILE + TILE / 2, y * TILE + TILE / 2);
  }

  /** The map tile under a spot on the page, or null off the map. */
  screenToTile(x: number, y: number): Point | null {
    if (!this.currentMap) return null;
    const view = this.cameras.main.worldView;
    const canvas = this.game.canvas.getBoundingClientRect();
    const scale = canvas.width / this.scale.width;
    const tile = { x: Math.floor((view.x + (x - canvas.left) / scale) / TILE), y: Math.floor((view.y + (y - canvas.top) / scale) / TILE) };
    if (tile.x < 0 || tile.y < 0 || tile.x >= this.currentMap.width || tile.y >= this.currentMap.height) return null;
    return tile;
  }

  /**
   * Marks the tile your courier is walking to, or, when `refused`, flashes a cross on a tile it
   * cannot reach. Null takes the marker away.
   */
  setMarker(tile: Point | null, refused = false): void {
    this.markerTimer?.remove();
    this.markerTimer = null;
    this.markerPulse?.remove();
    this.markerPulse = null;
    this.markerTile = refused ? this.markerTile : tile;
    const marker = (this.marker ??= this.add.graphics().setDepth(MARKER_DEPTH));
    marker.clear().setAlpha(1);
    if (!tile) return;
    marker.setPosition(tile.x * TILE, tile.y * TILE);
    // Whole-pixel rectangles rather than lines, so the marker stays as crisp as the tiles.
    if (refused) {
      marker.fillStyle(REFUSED_COLOUR, 1);
      for (let at = 4; at < TILE - 4; at += 1) marker.fillRect(at, at, 2, 1).fillRect(TILE - 2 - at, at, 2, 1);
      this.markerTimer = this.time.delayedCall(REFUSED_MS, () => this.setMarker(this.markerTile));
      return;
    }
    // Four corner brackets: clear on grass, paths and floors alike, and they leave the tile visible.
    marker.fillStyle(MARKER_COLOUR, 1);
    for (const [x, y] of [[0, 0], [TILE - 5, 0], [0, TILE - 2], [TILE - 5, TILE - 2]] as const) marker.fillRect(x, y, 5, 2);
    for (const [x, y] of [[0, 0], [TILE - 2, 0], [0, TILE - 5], [TILE - 2, TILE - 5]] as const) marker.fillRect(x, y, 2, 5);
    if (!reducedMotion()) this.markerPulse = this.tweens.add({ targets: marker, alpha: 0.45, duration: 450, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private toScreen(worldX: number, worldY: number): Point {
    const view = this.cameras.main.worldView;
    const canvas = this.game.canvas.getBoundingClientRect();
    const scale = canvas.width / this.scale.width;
    return { x: canvas.left + (worldX - view.x) * scale, y: canvas.top + (worldY - view.y) * scale };
  }

  private loadImage(key: string, url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.load.once(Loader.Events.COMPLETE, () => (this.textures.exists(key) ? resolve() : reject(new Error(`could not load ${url}`))));
      this.load.image(key, url);
      this.load.start();
    });
  }

  private centreOnSpawn(): void {
    this.cameras.main.centerOn(this.spawnTile.x * TILE + TILE / 2, this.spawnTile.y * TILE + TILE / 2);
  }

  private draw(player: ShownPlayer, stepMs: number): void {
    const texture = courierTexture(this, player.avatar, stepMs);
    let sprite = this.sprites.get(player.id);
    if (!sprite || sprite.texture.key !== texture) {
      sprite?.destroy();
      sprite = this.add.sprite(0, 0, texture, frameName('down', 'stand'));
      this.sprites.set(player.id, sprite);
    }
    const x = player.at.x * TILE + TILE / 2;
    const y = player.at.y * TILE + TILE / 2;
    // Lower on the screen is nearer, and drawn on top; your own courier wins a tie.
    sprite.setPosition(x, y).setDepth(PLAYER_DEPTH + y + (player.self ? 0.5 : 0));
    const facing = player.facing === 'left' ? 'right' : player.facing;
    sprite.setFlipX(player.facing === 'left');
    if (player.walking) {
      sprite.play(walkAnimation(texture, facing), true);
    } else {
      sprite.stop();
      sprite.setFrame(frameName(facing, 'stand'));
    }
    if (player.connected) sprite.setAlpha(1).clearTint();
    else sprite.setAlpha(AWAY_ALPHA).setTint(AWAY_TINT);
  }

  /** Keeps the ring at your courier's feet, drawn under it but over anyone sharing its tile. */
  private ring(sprite: GameObjects.Sprite | undefined): void {
    if (!sprite) {
      this.selfRing?.setVisible(false);
      return;
    }
    if (!this.selfRing) {
      const ring = this.add.graphics();
      SELF_RING.forEach((row, y) => {
        [...row].forEach((pixel, x) => {
          if (pixel === '.') return;
          ring.fillStyle(pixel === 'o' ? SELF_RING_OUTLINE : SELF_RING_COLOUR, pixel === 'o' ? 0.55 : 1);
          ring.fillRect(x, SELF_RING_TOP + y, 1, 1);
        });
      });
      this.selfRing = ring;
    }
    this.selfRing.setVisible(true).setPosition(sprite.x - TILE / 2, sprite.y - TILE / 2).setDepth(sprite.depth - 0.25);
  }

  private follow(sprite: GameObjects.Sprite | undefined): void {
    const camera = this.cameras.main;
    if (sprite === this.followed) return;
    if (!sprite) {
      camera.stopFollow();
      this.followed = null;
      this.centreOnSpawn();
      return;
    }
    const lerp = reducedMotion() ? 1 : FOLLOW_LERP;
    camera.startFollow(sprite, true, lerp, lerp);
    camera.centerOn(sprite.x, sprite.y);
    this.followed = sprite;
  }

  private labels(): NameLabel[] {
    return this.shownPlayers.flatMap((player) => {
      const sprite = this.sprites.get(player.id);
      if (player.self || !sprite) return [];
      const at = this.toScreen(Math.round(sprite.x), Math.round(sprite.y) - TILE / 2);
      return [{ id: player.id, name: player.name, away: !player.connected, battling: player.inBattle, x: at.x, y: at.y }];
    });
  }
}
