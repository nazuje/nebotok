import { PLAYER_SPAWN, frameNames, spriteFor, type Direction, type Point, type WorldMap } from '@nebotok/core';
import { Scale, Scene, Scenes, Tilemaps, type GameObjects, type Time, type Tweens } from 'phaser';
import { courierTexture, frameName, walkAnimation } from './couriers.ts';
import type { LoadedMap } from './map-loader.ts';
import { STORY } from './story-content.ts';
import { ART, animationKey, loadArtImages, spriteTexture } from './sprites.ts';
import type { HeadMark } from './talk.ts';
import { tilesetArt, type TilesetArt } from './tileset-art.ts';
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
/** "Where next?": the camera pans to the goal, stays while its ring pulses, then glides back. */
const LOOK_PAN_MS = 700;
const LOOK_HOLD_MS = 1_800;
const GOAL_COLOUR = 0xffd43b;
const GOAL_OUTLINE = 0x1b1b2f;
/** How far the goal ring reaches out of its tile, in pixels. */
const GOAL_REACH = 3;
const HEAD_MARK_INK = 0x1b1b2f;
/** A mark's pixels, one string per row: `o` outline, `f` fill, `i` ink. */
const HEAD_MARKS: Readonly<Record<HeadMark, { readonly fill: number; readonly rows: readonly string[] }>> = {
  // "!": this character has something new for you.
  newQuest: { fill: 0xffd43b, rows: ['.ooooo.', 'offfffo', 'offiffo', 'offiffo', 'offiffo', 'offfffo', 'offiffo', 'offfffo', '.ooooo.', '...o...'] },
  // A speech bubble: this character is waiting to hear from you.
  turnIn: { fill: 0xffffff, rows: ['.ooooooo.', 'offfffffo', 'ofifififo', 'offfffffo', '.ooooooo.', '..oo.....', '..o......'] },
};
const HEAD_MARK_BOB_PX = 2;
/** A spot's rest countdown: a small ring at its top right corner, drawn again only when it moves on a step. */
const REST_RING_RADIUS = 4;
const REST_RING_STEPS = 48;
const REST_RING_COLOUR = 0xffffff;
const REST_RING_BACK = 0x1b1b2f;
/** Where a courier's skill action shows, from the courier's centre, in pixels. */
const ACTION_OFFSET = { x: 12, y: -6 } as const;
const HEAD_MARK_BOB_MS = 600;
/**
 * The storm band: once a player has seen the storm, a dim bank of cloud hangs along the top of their
 * screen, with a puffy lower edge and a haze fading below it. Drawn once per screen size; the puffs
 * are half discs side by side, so no two shapes overlap and darken each other.
 */
const STORM_BAND_COLOUR = 0x2a2c45;
const STORM_BAND_ALPHA = 0.42;
const STORM_BAND_HAZE_ALPHA = 0.22;
const STORM_BAND_SHARE = 0.12;
const STORM_BAND_PX = { min: 20, max: 44 } as const;
const STORM_BAND_PUFF_SHARE = 0.4;
const STORM_BAND_ROW_PX = 2;
/** Over every courier and head mark, under a story cue. */
const STORM_BAND_DEPTH = 9_000;

/** A name to show above a courier, at a spot on the page in CSS pixels. */
export type NameLabel = { readonly id: string; readonly name: string; readonly away: boolean; readonly battling: boolean; readonly talking: boolean; readonly skill: string; readonly x: number; readonly y: number };

/** How a character looks this frame: the way they face, and the mark over their head. */
export type NpcLook = { readonly facing: Direction; readonly mark: HeadMark | null };

/** A character as drawn last frame, for the test hook. */
export type DrawnNpc = { readonly id: string; readonly x: number; readonly y: number; readonly facing: Direction; readonly mark: HeadMark | null };

/** A gathering spot as drawn last frame, for the test hook: whether it shows resting for you. */
export type DrawnSpot = { readonly id: string; readonly x: number; readonly y: number; readonly resting: boolean };

type Spot = { readonly id: string; readonly tile: Point; readonly art: string | null; readonly sprite: GameObjects.Sprite | null; readonly ring: GameObjects.Graphics; step: number };

type Npc = { readonly id: string; readonly tile: Point; readonly sprite: GameObjects.Sprite; readonly mark: GameObjects.Graphics; look: NpcLook | null; bob: Tweens.Tween | null };

export type WorldSceneOptions = {
  readonly view: WorldView;
  /** Called at the start of every frame, before anything is drawn. */
  frame(now: number): void;
  /** Called after every frame is drawn, with where the other players' names go. */
  labels(labels: readonly NameLabel[]): void;
  /** How the character `npc`, standing on `at`, looks this frame. */
  npcLook(npc: string, at: Point): NpcLook;
  /** How much of its rest a spot still has for you at `now`, 1 just picked to 0 ready. */
  spotRest(spot: string, now: number): number;
};

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');
const reducedMotion = () => REDUCED_MOTION.matches;

const firstFrame = (art: string): string => (ART.sprites.has(art) ? (frameNames(ART.sprites.get(art)!)[0] ?? '') : '');

/** A spot's frame: `resting` while it rests for you, else `ready`, or its first frame when it lacks one. */
function spotFrame(art: string, resting: boolean): string {
  const sprite = ART.sprites.get(art);
  const wanted = resting ? 'resting' : 'ready';
  return sprite && !frameNames(sprite).includes(wanted) ? firstFrame(art) : wanted;
}

/** The world: the map's tiles and every player's courier, drawn from the client's view model. */
export class WorldScene extends Scene {
  /** The map on screen, once its tiles are drawn. */
  mapId: string | null = null;
  readonly booted: Promise<void>;
  private readonly options: WorldSceneOptions;
  private readonly sprites = new Map<string, GameObjects.Sprite>();
  private readonly npcs = new Map<string, Npc>();
  private readonly spots = new Map<string, Spot>();
  private readonly stations: GameObjects.Sprite[] = [];
  private readonly actions = new Map<string, GameObjects.Sprite>();
  private shownPlayers: readonly ShownPlayer[] = [];
  private followed: GameObjects.Sprite | null = null;
  private currentMap: Tilemaps.Tilemap | null = null;
  private readonly tilesets = new Map<string, TilesetArt>();
  private tiles: TilesetArt | null = null;
  private spawnTile: Point = { x: 0, y: 0 };
  private markBooted: () => void = () => {};
  private marker: GameObjects.Graphics | null = null;
  private selfRing: GameObjects.Graphics | null = null;
  private markerPulse: Tweens.Tween | null = null;
  private markerTimer: Time.TimerEvent | null = null;
  /** The tile the marker shows, unless it is only a short "can't go there". */
  markerTile: Point | null = null;
  /** The tile the camera was sent to show, while it is on its way there or showing it. */
  lookingAt: Point | null = null;
  private goalRing: GameObjects.Graphics | null = null;
  private goalPulse: Tweens.Tween | null = null;
  private lookTimer: Time.TimerEvent | null = null;
  /** A story cue has the camera, so it does not follow your courier. */
  cameraHeld = false;
  /** Whether the storm band is on this player's horizon. */
  stormBandShown = false;
  private stormBand: GameObjects.Graphics | null = null;
  private created = false;

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
      this.drawStormBand();
    });
    this.events.on(Scenes.Events.RENDER, () => this.options.labels(this.labels()));
    this.created = true;
    this.drawStormBand();
    this.markBooted();
  }

  /** Draws a map's tiles, replacing any map shown before. */
  async showMap(map: LoadedMap): Promise<void> {
    if (this.mapId === map.id) return;
    await loadArtImages();
    let tiles = this.tilesets.get(map.tilesetArt);
    if (!tiles) {
      tiles = tilesetArt(this, map.tilesetArt);
      this.tilesets.set(map.tilesetArt, tiles);
    }
    if (!this.cache.tilemap.exists(map.id)) this.cache.tilemap.add(map.id, { format: Tilemaps.Formats.TILED_JSON, data: map.raw });
    this.currentMap?.destroy();
    const tilemap = this.make.tilemap({ key: map.id });
    const tileset = tilemap.addTilesetImage(map.tilesetName, tiles.key);
    if (!tileset) throw new Error(`map ${map.id} has no tileset named ${map.tilesetName}`);
    map.tileLayers.forEach((name, index) => tilemap.createLayer(name, tileset, 0, 0)?.setDepth(index));
    this.cameras.main.setBounds(0, 0, tilemap.widthInPixels, tilemap.heightInPixels);
    this.currentMap = tilemap;
    this.tiles = tiles;
    this.spawnTile = map.world.spawns[PLAYER_SPAWN] ?? { x: 0, y: 0 };
    this.placeNpcs(map.world);
    this.placeThings(map.world);
    this.mapId = map.id;
    if (!this.followed) this.centreOnSpawn();
  }

  override update(): void {
    const now = performance.now();
    this.options.frame(now);
    if (!reducedMotion()) this.tiles?.animate(now);
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
    for (const [id, action] of this.actions) {
      if (seen.has(id)) continue;
      action.destroy();
      this.actions.delete(id);
    }
    for (const spot of this.spots.values()) this.drawSpot(spot, now);
    this.shownPlayers = shown;
    for (const npc of this.npcs.values()) this.drawNpc(npc);
    const self = shown.find((player) => player.self);
    const selfSprite = self ? this.sprites.get(self.id) : undefined;
    this.ring(selfSprite);
    // Walking off while the camera looks elsewhere brings it straight back.
    if (this.lookingAt && self?.walking) this.endLook();
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

  /** Pans the camera to a tile and pulses a ring on it, then glides back to your courier. */
  lookAt(tile: Point): void {
    this.endLook();
    if (this.cameraHeld) return;
    const camera = this.cameras.main;
    camera.stopFollow();
    this.lookingAt = tile;
    this.drawGoal(tile);
    const hold = () => {
      this.lookTimer = this.time.delayedCall(LOOK_HOLD_MS, () => this.endLook());
    };
    const x = tile.x * TILE + TILE / 2;
    const y = tile.y * TILE + TILE / 2;
    if (reducedMotion()) {
      camera.centerOn(x, y);
      hold();
      return;
    }
    camera.pan(x, y, LOOK_PAN_MS, 'Sine.easeInOut', true, (_camera: unknown, progress: number) => {
      if (progress === 1) hold();
    });
  }

  private endLook(): void {
    this.lookTimer?.remove();
    this.lookTimer = null;
    this.goalPulse?.remove();
    this.goalPulse = null;
    this.goalRing?.clear();
    if (!this.lookingAt) return;
    this.lookingAt = null;
    const camera = this.cameras.main;
    camera.panEffect.reset();
    if (!this.followed) {
      this.centreOnSpawn();
      return;
    }
    // Following again from where the camera stands glides it home; reduced motion jumps.
    const lerp = reducedMotion() ? 1 : FOLLOW_LERP;
    camera.startFollow(this.followed, true, lerp, lerp);
  }

  /** A ring of whole pixels just outside the goal's tile, pulsing unless motion is reduced. */
  private drawGoal(tile: Point): void {
    const ring = (this.goalRing ??= this.add.graphics().setDepth(MARKER_DEPTH));
    const size = TILE + GOAL_REACH * 2;
    ring.clear().setAlpha(1).setPosition(tile.x * TILE - GOAL_REACH, tile.y * TILE - GOAL_REACH);
    ring.fillStyle(GOAL_OUTLINE, 0.6).fillRect(-1, -1, size + 2, 4).fillRect(-1, size - 3, size + 2, 4).fillRect(-1, -1, 4, size + 2).fillRect(size - 3, -1, 4, size + 2);
    ring.fillStyle(GOAL_COLOUR, 1).fillRect(0, 0, size, 2).fillRect(0, size - 2, size, 2).fillRect(0, 0, 2, size).fillRect(size - 2, 0, 2, size);
    if (!reducedMotion()) this.goalPulse = this.tweens.add({ targets: ring, alpha: 0.35, duration: 380, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  /** Where a character stands on the page, in CSS pixels: the centre of their tile, or null when it is off the canvas. */
  npcOnScreen(npc: string): Point | null {
    const tile = this.npcs.get(npc)?.tile;
    if (!tile) return null;
    const at = this.tileToScreen(tile.x, tile.y);
    const canvas = this.game.canvas.getBoundingClientRect();
    return at.x >= canvas.left && at.x <= canvas.right && at.y >= canvas.top && at.y <= canvas.bottom ? at : null;
  }

  /** Every character on the map, as drawn last frame. */
  drawnNpcs(): DrawnNpc[] {
    return [...this.npcs.values()].map(({ id, tile, look }) => ({ id, x: tile.x, y: tile.y, facing: look?.facing ?? 'down', mark: look?.mark ?? null }));
  }

  /** Every gathering spot on the map, as drawn last frame. */
  drawnSpots(): DrawnSpot[] {
    return [...this.spots.values()].map(({ id, tile, step }) => ({ id, x: tile.x, y: tile.y, resting: step > 0 }));
  }

  /** The map's gathering spots (`spots/<look>`) and stations (`stations/<look>`), standing still like characters. */
  private placeThings(map: WorldMap): void {
    for (const spot of this.spots.values()) {
      spot.sprite?.destroy();
      spot.ring.destroy();
    }
    this.spots.clear();
    for (const station of this.stations) station.destroy();
    this.stations.length = 0;
    const skills = STORY.skills;
    for (const [id, tile] of Object.entries(map.spots)) {
      const look = skills?.spots.get(id)?.look;
      const art = look ? spriteFor.spot(look) : null;
      const at = { x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE / 2 };
      const sprite = art && ART.sprites.has(art) ? this.add.sprite(at.x, at.y, spriteTexture(this, art), spotFrame(art, false)).setDepth(PLAYER_DEPTH + at.y) : null;
      const ring = this.add.graphics().setDepth(PLAYER_DEPTH + map.height * TILE).setPosition(tile.x * TILE + TILE - REST_RING_RADIUS - 1, tile.y * TILE + REST_RING_RADIUS + 1);
      this.spots.set(id, { id, tile, art: sprite ? art : null, sprite, ring, step: -1 });
    }
    for (const [id, tile] of Object.entries(map.stations)) {
      const look = skills?.stations.get(id)?.look;
      const art = look ? spriteFor.station(look) : null;
      if (!art || !ART.sprites.has(art)) continue;
      const y = tile.y * TILE + TILE / 2;
      this.stations.push(this.add.sprite(tile.x * TILE + TILE / 2, y, spriteTexture(this, art), firstFrame(art)).setDepth(PLAYER_DEPTH + y));
    }
  }

  /** A spot shows `resting` while it rests for you, with a ring counting down what is left. */
  private drawSpot(spot: Spot, now: number): void {
    const left = this.options.spotRest(spot.id, now);
    const step = left > 0 ? Math.max(1, Math.ceil(left * REST_RING_STEPS)) : 0;
    if (step === spot.step) return;
    if (spot.art && step > 0 !== spot.step > 0) spot.sprite?.setFrame(spotFrame(spot.art, step > 0));
    spot.step = step;
    spot.ring.clear();
    if (step === 0) return;
    const end = -Math.PI / 2 + (2 * Math.PI * step) / REST_RING_STEPS;
    spot.ring.fillStyle(REST_RING_BACK, 0.55).fillCircle(0, 0, REST_RING_RADIUS + 1);
    spot.ring.lineStyle(2, REST_RING_COLOUR, 1).beginPath().arc(0, 0, REST_RING_RADIUS - 1, -Math.PI / 2, end).strokePath();
  }

  private placeNpcs(map: WorldMap): void {
    for (const npc of this.npcs.values()) {
      npc.bob?.remove();
      npc.sprite.destroy();
      npc.mark.destroy();
    }
    this.npcs.clear();
    for (const [id, tile] of Object.entries(map.npcs)) {
      const x = tile.x * TILE + TILE / 2;
      const y = tile.y * TILE + TILE / 2;
      // Characters stand still, so they are placed once, at the depth couriers on their row get.
      const sprite = this.add.sprite(x, y, spriteTexture(this, spriteFor.npc(id)), 'down').setDepth(PLAYER_DEPTH + y);
      // A courier's depth grows with its row, so marks over heads go above the lowest row of the map.
      const mark = this.add.graphics().setDepth(PLAYER_DEPTH + map.height * TILE + 1).setVisible(false);
      this.npcs.set(id, { id, tile, sprite, mark, look: null, bob: null });
    }
  }

  private drawNpc(npc: Npc): void {
    const look = this.options.npcLook(npc.id, npc.tile);
    if (look.facing !== npc.look?.facing) npc.sprite.setFrame(look.facing === 'left' ? 'right' : look.facing).setFlipX(look.facing === 'left');
    if (look.mark !== (npc.look?.mark ?? null)) this.drawHeadMark(npc, look.mark);
    npc.look = look;
  }

  /** The mark over a character's head, bobbing gently unless motion is reduced. */
  private drawHeadMark(npc: Npc, mark: HeadMark | null): void {
    npc.bob?.remove();
    npc.bob = null;
    npc.mark.clear().setVisible(mark !== null);
    if (mark === null) return;
    const { fill, rows } = HEAD_MARKS[mark];
    const width = Math.max(...rows.map((row) => row.length));
    rows.forEach((row, y) => {
      [...row].forEach((pixel, x) => {
        if (pixel === '.') return;
        npc.mark.fillStyle(pixel === 'f' ? fill : HEAD_MARK_INK, 1).fillRect(x, y, 1, 1);
      });
    });
    const top = npc.tile.y * TILE - rows.length - 1;
    npc.mark.setPosition(npc.tile.x * TILE + Math.floor((TILE - width) / 2), top);
    if (!reducedMotion()) npc.bob = this.tweens.add({ targets: npc.mark, y: top - HEAD_MARK_BOB_PX, duration: HEAD_MARK_BOB_MS, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }

  private toScreen(worldX: number, worldY: number): Point {
    const view = this.cameras.main.worldView;
    const canvas = this.game.canvas.getBoundingClientRect();
    const scale = canvas.width / this.scale.width;
    return { x: canvas.left + (worldX - view.x) * scale, y: canvas.top + (worldY - view.y) * scale };
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
    this.drawAction(player, sprite);
  }

  /** A courier doing a skill shows its action beside them, `actions/<skill>` playing `play`. */
  private drawAction(player: ShownPlayer, courier: GameObjects.Sprite): void {
    const art = player.skill === '' ? null : spriteFor.action(player.skill);
    let action = this.actions.get(player.id);
    if (!art || !ART.sprites.has(art)) {
      action?.destroy();
      this.actions.delete(player.id);
      return;
    }
    const texture = spriteTexture(this, art);
    if (!action || action.texture.key !== texture) {
      action?.destroy();
      action = this.add.sprite(0, 0, texture, firstFrame(art));
      this.actions.set(player.id, action);
    }
    action.setPosition(courier.x + ACTION_OFFSET.x, courier.y + ACTION_OFFSET.y).setDepth(courier.depth + 0.1);
    const play = animationKey(art, 'play');
    if (!reducedMotion() && this.anims.exists(play)) action.play(play, true);
    else action.stop();
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
    if (this.cameraHeld) {
      this.followed = sprite ?? null;
      return;
    }
    if (sprite === this.followed || this.lookingAt) return;
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

  /** While held, the camera stops following your courier so a story cue can move it; letting go glides it back. */
  holdCamera(held: boolean): void {
    // A look at a goal ends first, so it neither fights the cue for the camera nor resumes after it.
    this.endLook();
    this.cameraHeld = held;
    const camera = this.cameras.main;
    if (held) {
      camera.stopFollow();
      return;
    }
    if (!this.followed) {
      this.centreOnSpawn();
      return;
    }
    const lerp = reducedMotion() ? 1 : FOLLOW_LERP;
    camera.startFollow(this.followed, true, lerp, lerp);
  }

  /** Shows or hides the storm band along the top of the screen. */
  showStormBand(shown: boolean): void {
    if (shown === this.stormBandShown) return;
    this.stormBandShown = shown;
    this.drawStormBand();
  }

  private drawStormBand(): void {
    if (!this.created) return;
    const band = (this.stormBand ??= this.add.graphics().setScrollFactor(0).setDepth(STORM_BAND_DEPTH));
    band.clear().setVisible(this.stormBandShown);
    if (!this.stormBandShown) return;
    const { width, height } = this.cameras.main;
    const bank = Math.round(Math.min(STORM_BAND_PX.max, Math.max(STORM_BAND_PX.min, height * STORM_BAND_SHARE)));
    const puff = Math.round(bank * STORM_BAND_PUFF_SHARE);
    band.fillStyle(STORM_BAND_COLOUR, STORM_BAND_ALPHA).fillRect(0, 0, width, bank);
    for (let x = puff; x - puff < width; x += puff * 2) {
      band.beginPath().arc(x, bank, puff, 0, Math.PI).closePath().fillPath();
    }
    const haze = bank + puff;
    for (let y = 0; y < bank; y += STORM_BAND_ROW_PX) {
      band.fillStyle(STORM_BAND_COLOUR, STORM_BAND_HAZE_ALPHA * (1 - y / bank)).fillRect(0, haze + y, width, STORM_BAND_ROW_PX);
    }
  }

  private labels(): NameLabel[] {
    return this.shownPlayers.flatMap((player) => {
      const sprite = this.sprites.get(player.id);
      if (player.self || !sprite) return [];
      const at = this.toScreen(Math.round(sprite.x), Math.round(sprite.y) - TILE / 2);
      return [{ id: player.id, name: player.name, away: !player.connected, battling: player.inBattle, talking: player.talking, skill: player.skill, x: at.x, y: at.y }];
    });
  }
}
