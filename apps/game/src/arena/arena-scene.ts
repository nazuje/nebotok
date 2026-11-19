import { DIRECTION_VECTORS, type ArenaShape, type FightEvent, type Side } from '@nebotok/core';
import { Scene, Scenes, type GameObjects } from 'phaser';
import type { ArenaBody, ArenaRoomState, STATUS_BITS as SERVER_STATUS_BITS } from '../../../server/src/arena-state.ts';
import { CONTENT, moveType } from '../battle-content.ts';
import { creatureTexture } from '../creature-art.ts';
import { ARENA } from './arena-content.ts';
import { colourOf } from './arena-pen.ts';
import {
  drawAim,
  drawBurst,
  drawCone,
  drawEdgeDanger,
  drawHealthBar,
  drawHeart,
  drawIce,
  drawIsland,
  drawLightning,
  drawRing,
  drawShield,
  drawSky,
  drawStorm,
  drawThing,
  toScreen,
  type Fit,
  type Point,
  type Tint,
} from './arena-paint.ts';

export const ARENA_SCENE = 'arena';

/** `ArenaBody.status` bits, as the server sets them. */
const STATUS_BITS = { slowed: 1, rooted: 2, shielded: 4, tumbling: 8, windingUp: 16 } as const satisfies typeof SERVER_STATUS_BITS;
/** Positions and sizes on the wire are in 1/256 arena units. */
const SUB = 256;
const DIRECTION_SCALE = 4096;
const DEPTH = { sky: 0, island: 1, under: 2, creatures: 3, over: 6, bars: 7 } as const;
/** How tall a creature's picture is, in body radii: the sprites leave room around the creature in their frame. */
const CREATURE_BODIES = 3.4;
/** How long the drawn position takes to catch up with the server's, in ms, and the jump past which it does not try. */
const FOLLOW_MS = 45;
const SNAP_BODIES = 4;
const FALL_MS = 1_000;
const FLASH_MS = 220;
const SPRING = { stiffness: 900, damping: 17 } as const;
const NO_TINT: Tint = { light: 0xe6eef6, main: 0x8fa9c4, dark: 0x334e68 };

/** The fight to draw: the arena room's state and which side is yours. */
export type ShownFight = { readonly state: ArenaRoomState; readonly side: Side };

export type ArenaSceneOptions = {
  fight(): ShownFight | null;
  /** The events since the last frame, each handed over once. */
  events(): readonly FightEvent[];
  /** Where the page leaves room for the island, in CSS pixels. */
  field(): DOMRect | null;
};

/** What the scene drew last frame, for the test hook: the species on each side, the island's radius in arena units and the things on it. */
export type ArenaDrawn = { readonly creatures: readonly [string | null, string | null]; readonly radius: number; readonly things: number };

type Spring = { value: number; velocity: number };
type Fall = { readonly id: string; readonly at: number; readonly x: number; readonly y: number; readonly vx: number; readonly vy: number };
type Look = { image: GameObjects.Image | null; species: string; id: string; x: number; y: number; flipped: boolean; phase: number; squash: Spring; fall: Fall | null };
type Flash = { readonly side: Side; readonly shape: ArenaShape; readonly move: string; readonly born: number };

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const newLook = (): Look => ({ image: null, species: '', id: '', x: 0, y: 0, flipped: false, phase: 0, squash: { value: 0, velocity: 0 }, fall: null });

function stepSpring(spring: Spring, seconds: number): void {
  let left = Math.min(seconds, 0.1);
  while (left > 0) {
    const step = Math.min(left, 1 / 240);
    spring.velocity += (-SPRING.stiffness * spring.value - SPRING.damping * spring.velocity) * step;
    spring.value += spring.velocity * step;
    left -= step;
  }
}

const tints = new Map<string, Tint>();
/** A move's colours, from its type's weather colours. */
function tintOf(move: string): Tint {
  const known = tints.get(move);
  if (known) return known;
  const type = moveType(move);
  const colours = type === null ? undefined : CONTENT.weather.get(type)?.colours;
  const tint = colours ? { light: colourOf(colours.light, NO_TINT.light), main: colourOf(colours.main, NO_TINT.main), dark: colourOf(colours.dark, NO_TINT.dark) } : NO_TINT;
  tints.set(move, tint);
  return tint;
}

const facingAngle = (facing: number): number => {
  const [x, y] = DIRECTION_VECTORS[facing] ?? [DIRECTION_SCALE, 0];
  return Math.atan2(y, x);
};

/**
 * The arena fight, drawn from the arena room's state (docs/arena.md, "Screens and controls"): the
 * sky, the floating island and its storm, the things moves leave on it, and both creatures with
 * a bob, a squash and a flip as they walk, falling off the edge on a ring-out. Positions follow
 * the server's with a short ease; prediction (#152) and the hits' juice (#153) build on this.
 * Everything with words is HTML (src/arena/arena-screen.ts).
 */
export class ArenaScene extends Scene {
  private readonly options: ArenaSceneOptions;
  private layers: Record<'sky' | 'island' | 'under' | 'over' | 'bars', GameObjects.Graphics> | null = null;
  private looks: [Look, Look] = [newLook(), newLook()];
  private flashes: Flash[] = [];
  private things = new Map<number, Point>();
  private bolt = { until: 0, angle: 0, seed: 0 };
  private framed = ARENA.arena.island.radius;
  private fit: Fit = { cx: 0, cy: 0, s: 1 };
  private lastDrawn: ArenaDrawn | null = null;

  constructor(options: ArenaSceneOptions) {
    super({ key: ARENA_SCENE, active: false });
    this.options = options;
  }

  create(): void {
    const layer = (depth: number) => this.add.graphics().setDepth(depth);
    this.layers = { sky: layer(DEPTH.sky), island: layer(DEPTH.island), under: layer(DEPTH.under), over: layer(DEPTH.over), bars: layer(DEPTH.bars) };
    this.looks = [newLook(), newLook()];
    this.flashes = [];
    this.things.clear();
    this.framed = ARENA.arena.island.radius;
    this.lastDrawn = null;
    this.events.once(Scenes.Events.SHUTDOWN, () => {
      this.layers = null;
      this.looks = [newLook(), newLook()];
      this.lastDrawn = null;
    });
  }

  drawn(): ArenaDrawn | null {
    return this.lastDrawn;
  }

  override update(_time: number, delta: number): void {
    const fight = this.options.fight();
    const layers = this.layers;
    if (!fight || !layers) return;
    const now = performance.now();
    const still = reducedMotion();
    const { state } = fight;
    const { body, radius: start } = ARENA.arena.island;
    const radius = state.radius / SUB;
    for (const layer of Object.values(layers)) layer.clear();
    this.fit = this.fitTo(radius, delta);
    drawSky(layers.sky, this.scale.width, this.scale.height);
    drawIsland(layers.island, this.fit, radius, start, body);
    const warning = state.storm.phase === 'warning';
    drawStorm(layers.island, this.fit, { radius, start, body, warning, next: null }, now, still);
    this.lightning(radius, warning, now, still);
    this.react(state, this.options.events(), now);
    this.drawTreat(state, now, still);
    const things = this.drawThings(state, now, still);
    this.drawFlashes(state, now);
    const creatures: [string | null, string | null] = [null, null];
    for (const side of [0, 1] as const) creatures[side] = this.drawBody(state, side, fight.side, radius, delta, now, still);
    this.lastDrawn = { creatures, radius: Math.round(radius), things };
  }

  /** Where the island goes: the biggest circle the field leaves room for, closer as the storm shrinks it. */
  private fitTo(radius: number, delta: number): Fit {
    this.framed += (radius - this.framed) * Math.min(1, delta / 600);
    const box = this.options.field();
    const canvas = this.game.canvas.getBoundingClientRect();
    const px = canvas.width / this.scale.width;
    const field = !box || box.width === 0 || px === 0 ? { x: 0, y: 0, width: this.scale.width, height: this.scale.height } : { x: (box.left - canvas.left) / px, y: (box.top - canvas.top) / px, width: box.width / px, height: box.height / px };
    const { body } = ARENA.arena.island;
    const s = Math.max(10, Math.min(field.width, field.height)) / 2 / (this.framed * 1.1 + body * 1.6);
    return { cx: field.x + field.width / 2, cy: field.y + field.height / 2 - this.framed * 0.06 * s, s };
  }

  private lightning(radius: number, warning: boolean, now: number, still: boolean): void {
    if (!this.layers || still) return;
    if (warning && now > this.bolt.until + 250 && Math.random() < 0.05) this.bolt = { until: now + 90, angle: Math.random() * Math.PI * 2, seed: Math.random() * 100 };
    if (now < this.bolt.until) drawLightning(this.layers.island, this.fit, radius, this.bolt.angle, this.bolt.seed);
  }

  /** Starts what the events show: a fall off the edge, a cone's or a burst's flash, a squash. */
  private react(state: ArenaRoomState, events: readonly FightEvent[], now: number): void {
    for (const event of events) {
      if (event.kind === 'ringOut') {
        const look = this.looks[event.side];
        const shown = state.bodies.at(event.side);
        if (shown) look.fall = { id: shown.id, at: now, x: look.x, y: look.y, vx: shown.vx / SUB, vy: shown.vy / SUB };
      } else if (event.kind === 'cast') {
        this.flashes.push({ side: event.side, shape: event.shape, move: event.move, born: now });
        this.looks[event.side].squash.velocity -= 4;
      } else if (event.kind === 'hit') this.looks[event.side].squash.velocity += event.effectiveness === 'strong' ? 9 : 5;
      else if (event.kind === 'dashed') this.looks[event.side].squash.velocity -= 7;
      else if (event.kind === 'windup') this.looks[event.side].squash.velocity += 6;
    }
  }

  private drawTreat(state: ArenaRoomState, now: number, still: boolean): void {
    if (!this.layers || state.treat.item === '') return;
    const at = toScreen(this.fit, state.treat.x / SUB, state.treat.y / SUB);
    const size = Math.max(9, ARENA.arena.island.body * 0.4 * this.fit.s);
    const hop = state.treat.landed && !still ? Math.abs(Math.sin(now / 200)) * size * 0.4 : 0;
    drawHeart(state.treat.landed ? this.layers.under : this.layers.over, at.x, at.y - hop, size);
  }

  private drawThings(state: ArenaRoomState, now: number, still: boolean): number {
    const layers = this.layers;
    if (!layers) return 0;
    const seen = new Map<number, Point>();
    const { body } = ARENA.arena.island;
    for (const thing of state.things) {
      const at = { x: thing.x / SUB, y: thing.y / SUB };
      const before = this.things.get(thing.id);
      const moved = before ? { x: at.x - before.x, y: at.y - before.y } : { x: 0, y: 0 };
      const length = Math.hypot(moved.x, moved.y);
      const along = length > 0 ? { x: moved.x / length, y: moved.y / length } : { x: 1, y: 0 };
      seen.set(thing.id, at);
      const shape = thing.shape as ArenaShape;
      const layer = shape === 'puddle' || shape === 'freeze' || shape === 'zone' || shape === 'weather' || thing.armTicks > 0 ? layers.under : layers.over;
      drawThing(layer, this.fit, { shape, at, radius: thing.radius / SUB, armTicks: thing.armTicks, along, tint: tintOf(thing.move) }, body, now, still);
    }
    this.things = seen;
    return seen.size;
  }

  /** A cone's fan and a burst's ring, for a moment after they are cast. */
  private drawFlashes(state: ArenaRoomState, now: number): void {
    const layers = this.layers;
    if (!layers) return;
    this.flashes = this.flashes.filter((flash) => now - flash.born < FLASH_MS);
    const { body } = ARENA.arena.island;
    for (const flash of this.flashes) {
      const caster = state.bodies.at(flash.side);
      if (!caster) continue;
      const look = this.looks[flash.side];
      const at = toScreen(this.fit, look.x, look.y - body * 0.9);
      const fade = 1 - (now - flash.born) / FLASH_MS;
      const tint = tintOf(flash.move);
      if (flash.shape === 'cone') drawCone(layers.over, at, facingAngle(caster.facing), body * 5 * this.fit.s, 0.55, tint, fade);
      else if (flash.shape === 'burst') drawRing(layers.over, at, body * (1.5 + 2 * (1 - fade)) * this.fit.s, tint.main, fade);
    }
  }

  /** The creature picture for a side, made again when the species changes. */
  private imageFor(look: Look, species: string): GameObjects.Image {
    if (look.image && look.species === species) return look.image;
    look.image?.destroy();
    const texture = creatureTexture(this, species, 'front');
    look.image = this.add.image(0, 0, texture.key, texture.frame).setOrigin(0.5, 0.92).setDepth(DEPTH.creatures);
    look.species = species;
    return look.image;
  }

  /** Draws a side's creature and its marks; returns its species, or null when none shows. */
  private drawBody(state: ArenaRoomState, side: Side, yours: Side, radius: number, delta: number, now: number, still: boolean): string | null {
    const shown = state.bodies.at(side);
    const look = this.looks[side];
    const layers = this.layers;
    if (!shown || !layers) {
      look.image?.setVisible(false);
      return null;
    }
    const image = this.imageFor(look, shown.species);
    const { body } = ARENA.arena.island;
    const target = { x: shown.x / SUB, y: shown.y / SUB };
    const fresh = look.id !== shown.id || Math.hypot(target.x - look.x, target.y - look.y) > body * SNAP_BODIES;
    const follow = fresh ? 1 : 1 - Math.exp(-delta / FOLLOW_MS);
    look.x += (target.x - look.x) * follow;
    look.y += (target.y - look.y) * follow;
    if (look.id !== shown.id && look.fall?.id !== shown.id) look.fall = null;
    look.id = shown.id;
    const size = body * CREATURE_BODIES * this.fit.s;
    const scale = size / Math.max(1, image.frame.height);
    if (look.fall) return this.drawFall(image, look, scale, now) ? shown.species : null;
    const at = toScreen(this.fit, look.x, look.y);
    if (shown.health <= 0) {
      image.setVisible(true).setPosition(at.x, at.y).setScale(scale * 1.15, scale * 0.6).setAngle(look.flipped ? -80 : 80).setAlpha(0.6).setDepth(DEPTH.creatures);
      return shown.species;
    }
    const speed = Math.hypot(shown.vx, shown.vy) / SUB;
    const walking = speed > 40 && !still;
    stepSpring(look.squash, delta / 1000);
    if (walking) look.phase += (delta / 1000) * (6 + speed / 50);
    const hop = walking ? Math.abs(Math.sin(look.phase)) * size * 0.12 : 0;
    const squash = still ? 0 : look.squash.value + (walking ? Math.sin(look.phase * 2) * 0.05 : 0);
    const facingX = DIRECTION_VECTORS[shown.facing]?.[0] ?? DIRECTION_SCALE;
    if (facingX < -DIRECTION_SCALE * 0.15) look.flipped = true;
    if (facingX > DIRECTION_SCALE * 0.15) look.flipped = false;
    this.drawGround(shown, side === yours, at, radius, size, now, still);
    const tumbling = (shown.status & STATUS_BITS.tumbling) !== 0 && !still;
    image
      .setVisible(true)
      .setPosition(at.x, at.y - hop)
      .setScale(scale * (1 + squash) * (look.flipped ? -1 : 1), scale * (1 - squash))
      .setAngle(tumbling ? Math.sin(now / 35) * 14 : 0)
      .setAlpha(1)
      .setDepth(DEPTH.creatures + look.y / 10_000);
    this.drawMarks(shown, side === yours, at, size, now, still);
    return shown.species;
  }

  /** Under a creature: its shadow, the slow puddle's blue, the wind-up's glow and the edge's warning. */
  private drawGround(shown: ArenaBody, yours: boolean, at: Point, radius: number, size: number, now: number, still: boolean): void {
    const layers = this.layers;
    if (!layers) return;
    const { body } = ARENA.arena.island;
    const out = Math.hypot(shown.x, shown.y) / SUB;
    const danger = Math.max(0, Math.min(1, (out - (radius - body * 2.2)) / (body * 1.8)));
    if (danger > 0) drawEdgeDanger(layers.under, this.fit, radius, body, { x: shown.x / SUB, y: shown.y / SUB }, danger, still ? 1 : 0.55 + 0.45 * Math.sin(now / 90));
    layers.under.fillStyle(0x1b3a1f, 0.28);
    layers.under.fillEllipse(at.x, at.y + size * 0.02, size * 0.75, size * 0.26);
    if ((shown.status & STATUS_BITS.slowed) !== 0) {
      layers.under.fillStyle(0x4dabf7, 0.6);
      layers.under.fillEllipse(at.x, at.y + size * 0.02, size * 0.95, size * 0.34);
    }
    if ((shown.status & STATUS_BITS.windingUp) !== 0) {
      layers.under.fillStyle(yours ? 0xffd43b : 0xff6b6b, still ? 0.45 : 0.35 + 0.25 * Math.sin(now / 70));
      layers.under.fillCircle(at.x, at.y - size * 0.42, size * 0.62);
    }
  }

  /** Over a creature: its shield, its ice, your aim, the wind-up's warning and its health bar. */
  private drawMarks(shown: ArenaBody, yours: boolean, at: Point, size: number, now: number, still: boolean): void {
    const layers = this.layers;
    if (!layers) return;
    const centre = { x: at.x, y: at.y - size * 0.42 };
    if ((shown.status & STATUS_BITS.shielded) !== 0) drawShield(layers.over, centre, size * 0.62, still ? 1 : 1 + 0.04 * Math.sin(now / 120));
    if ((shown.status & STATUS_BITS.rooted) !== 0) drawIce(layers.over, centre, size * 0.5);
    if ((shown.status & STATUS_BITS.windingUp) !== 0 && !yours) drawBurst(layers.bars, at.x + size * 0.45, at.y - size * 1.05, size * 0.2, 0xffd43b);
    if (yours) {
      const angle = facingAngle(shown.facing);
      const reach = size * 0.62;
      drawAim(layers.over, { x: centre.x + Math.cos(angle) * reach, y: centre.y + Math.sin(angle) * reach + size * 0.15 }, angle, Math.max(8, size * 0.17));
    }
    drawHealthBar(layers.bars, at.x, at.y - size * 1.08, Math.max(48, size * 1.05), Math.max(8, size * 0.13), shown.max > 0 ? shown.health / shown.max : 0);
  }

  /** Seen from above, falling is drifting off the island while shrinking into the clouds below. Returns whether it still shows. */
  private drawFall(image: GameObjects.Image, look: Look, scale: number, now: number): boolean {
    const fall = look.fall;
    if (!fall) return false;
    const t = Math.min(1, (now - fall.at) / FALL_MS);
    if (t >= 1) {
      image.setVisible(false);
      return false;
    }
    const { body } = ARENA.arena.island;
    const out = Math.hypot(fall.x, fall.y) || 1;
    const drift = (1 - (1 - t) * (1 - t)) * body * 2.2;
    const x = fall.x + (fall.x / out) * drift + fall.vx * 0.12 * t;
    const y = fall.y + (fall.y / out) * drift + fall.vy * 0.12 * t + t * t * body * 1.5;
    const at = toScreen(this.fit, x, y);
    const shrink = 1 - 0.8 * t * t;
    image
      .setVisible(true)
      .setPosition(at.x, at.y)
      .setScale(scale * shrink * (look.flipped ? -1 : 1), scale * shrink)
      .setAngle(reducedMotion() ? 0 : t * 420 * (look.flipped ? -1 : 1))
      .setAlpha(t < 0.8 ? 1 : (1 - t) / 0.2)
      .setDepth(DEPTH.creatures + 1);
    return true;
  }
}
