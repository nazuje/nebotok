import { frameNames, spriteFor } from '@nebotok/core';
import { Scene, TintModes, type GameObjects } from 'phaser';
import { creatureTexture } from '../creature-art.ts';
import { sprite, spriteTexture } from '../sprites.ts';
import { typeColour } from './prototype-icons.ts';
import { duelLayout, wheelLayout, type Layout, type Spot } from './prototype-layout.ts';
import { drawBurst, drawCloud, drawCrown, drawIsland, drawPuff, drawShield, drawStar, drawTick, lerpColour, strokeLine } from './prototype-shapes.ts';
import { movePower, weatherCycle, type ProtoBattle, type Side, type Strike } from './prototype-sim.ts';
import { Sky } from './prototype-sky.ts';
import { Sparks, type SparkShape } from './prototype-sparks.ts';

export const ARENA_SCENE = 'prototype-arena';
export type ArenaLayout = 'duel' | 'wheel';
export type Judgement = 'perfect' | 'good' | 'miss';
export type RingKind = 'aim' | 'shield';
export type ArenaOptions = {
  readonly layout: ArenaLayout;
  /** The band of the screen the arena may use, top and bottom in CSS pixels. */
  field(): { top: number; bottom: number };
};

/** How an effect has moved, squashed or faded a creature; tweens change these. dx and dy are in art pixels. */
type Fx = { dx: number; dy: number; sx: number; sy: number; alpha: number };
type Fighter = { species: string; type: string; maxHp: number; shownHp: number; gone: boolean; image: GameObjects.Image; fx: Fx };
type Flight = { type: string; from: Spot; to: Spot; start: number; ms: number; lift: number };
type Ring = { kind: RingKind; start: number; target: number; perfectMs: number };

const DEPTH = { wheel: 3, islands: 4, creatures: 5, clouds: 6, fx: 7, sparks: 7.5, pop: 8, ring: 9 } as const;
const HIT_STOP_MS = 70;
const TRAIL: Readonly<Record<string, { colour: number; shape: SparkShape; gravity: number }>> = {
  sun: { colour: 0xffd43b, shape: 'dot', gravity: -40 },
  rain: { colour: 0x4dabf7, shape: 'dot', gravity: 500 },
  frost: { colour: 0xe3fafc, shape: 'square', gravity: 60 },
  storm: { colour: 0xffe066, shape: 'line', gravity: 0 },
  gale: { colour: 0xffffff, shape: 'line', gravity: 0 },
  bloom: { colour: 0xf783ac, shape: 'petal', gravity: 80 },
};

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rest = (): Fx => ({ dx: 0, dy: 0, sx: 1, sy: 1, alpha: 1 });
const centreOf = (spot: Spot, size: number): Spot => ({ x: spot.x, y: spot.y - size / 2 });

/**
 * The prototype's battle field: open sky painted by the weather, the two creatures (on floating
 * islands, or on the weather wheel), their health clouds, and every bit of hit juice. The page
 * drives it turn by turn with the async methods; each resolves when its animation is done.
 */
export class ArenaScene extends Scene {
  readonly ready: Promise<void>;
  private readonly options: ArenaOptions;
  private markReady: () => void = () => undefined;
  private sky: Sky | null = null;
  private layers: { wheel: GameObjects.Graphics; islands: GameObjects.Graphics; clouds: GameObjects.Graphics; fx: GameObjects.Graphics; ring: GameObjects.Graphics } | null = null;
  private sparks: Sparks | null = null;
  private fighters: [Fighter, Fighter] | null = null;
  private wheelIcons = new Map<string, GameObjects.Image>();
  private weather: string | null = null;
  private flight: Flight | null = null;
  private ring: Ring | null = null;
  private frozenUntil = 0;
  private cycle: string[] = [];

  constructor(options: ArenaOptions) {
    super({ key: ARENA_SCENE });
    this.options = options;
    this.ready = new Promise((resolve) => {
      this.markReady = resolve;
    });
  }

  create(): void {
    this.sky = new Sky(this);
    const layer = (depth: number) => this.add.graphics().setDepth(depth);
    this.layers = { wheel: layer(DEPTH.wheel), islands: layer(DEPTH.islands), clouds: layer(DEPTH.clouds), fx: layer(DEPTH.fx), ring: layer(DEPTH.ring) };
    this.sparks = new Sparks(layer(DEPTH.sparks));
    this.cycle = weatherCycle();
    if (this.options.layout === 'wheel') {
      for (const type of this.cycle) {
        const id = spriteFor.weatherIcon(type);
        this.wheelIcons.set(type, this.add.image(0, 0, spriteTexture(this, id), frameNames(sprite(id))[0] ?? '').setDepth(DEPTH.wheel + 0.5));
      }
    }
    this.markReady();
  }

  show(battle: ProtoBattle): void {
    const make = (side: Side): Fighter => {
      const creature = battle.fighters[side];
      const texture = creatureTexture(this, creature.species, 'front');
      const image = this.add.image(0, 0, texture.key, texture.frame).setOrigin(0.5, 1).setDepth(DEPTH.creatures);
      return { species: creature.species, type: creature.type, maxHp: creature.maxHp, shownHp: creature.hp, gone: false, image, fx: rest() };
    };
    this.fighters = [make(0), make(1)];
    this.setWeather(battle.weather?.type ?? null);
  }

  setWeather(weather: string | null): void {
    this.weather = weather;
    this.sky?.setWeather(weather);
  }

  layout(): Layout {
    const { top, bottom } = this.options.field();
    const width = this.scale.width;
    const fighters = this.fighters;
    if (this.options.layout === 'wheel' && fighters) return wheelLayout(width, top, bottom, [fighters[0].type, fighters[1].type], this.cycle);
    return duelLayout(width, top, bottom);
  }

  override update(_time: number, delta: number): void {
    const now = performance.now();
    const frozen = now < this.frozenUntil;
    this.sky?.update(now, delta, this.scale.width, this.scale.height, frozen);
    if (!this.layers || !this.fighters) return;
    const layout = this.layout();
    this.drawWheel(layout, now);
    this.drawFighters(layout, now);
    this.drawFlight(layout, now, frozen);
    if (!frozen) this.sparks?.update(delta);
    this.sparks?.draw();
    this.drawRing(layout, now);
  }

  private bob(side: Side, now: number, layout: Layout): number {
    return reducedMotion() ? 0 : Math.sin(now / 700 + side * 1.7) * layout.scale * 1.5;
  }

  private drawFighters(layout: Layout, now: number): void {
    if (!this.layers || !this.fighters) return;
    const { islands, clouds } = this.layers;
    islands.clear();
    clouds.clear();
    for (const side of [0, 1] as const) {
      const fighter = this.fighters[side];
      const spot = layout.spots[side];
      const other = layout.spots[side === 0 ? 1 : 0];
      const bob = this.bob(side, now, layout);
      if (!layout.wheel) drawIsland(islands, spot.x, spot.y + bob + layout.size * 0.03, layout.size * 1.6, lerpColour(0x69c34d, typeColour(fighter.type), 0.3));
      const { fx } = fighter;
      fighter.image
        .setPosition(spot.x + fx.dx * layout.scale, spot.y + bob + fx.dy * layout.scale)
        .setScale(layout.scale * fx.sx, layout.scale * fx.sy)
        .setAlpha(fx.alpha)
        .setFlipX(spot.x < other.x);
      if (fighter.gone) continue;
      const cloud = layout.clouds[side];
      const width = Math.max(56, layout.size * 0.95);
      const share = Math.max(0, fighter.shownHp / fighter.maxHp);
      const y = cloud.y + bob;
      drawCloud(clouds, cloud.x, y, width + 8, 0x102a43, 0.28);
      drawCloud(clouds, cloud.x, y, width, 0xffffff, 0.22);
      if (share > 0) {
        const shown = width * (0.28 + 0.72 * share);
        drawCloud(clouds, cloud.x, y, shown + 7, 0x102a43, 1);
        drawCloud(clouds, cloud.x, y, shown, lerpColour(0xffffff, 0x6c7a89, 1 - share), 1);
        clouds.fillStyle(0xffffff, 0.9);
        clouds.fillEllipse(cloud.x - shown * 0.12, y - shown * 0.16, shown * 0.22, shown * 0.1);
      }
    }
  }

  private drawWheel(layout: Layout, now: number): void {
    const wheel = layout.wheel;
    const g = this.layers?.wheel;
    if (!wheel || !g) return;
    const { cx, cy, r, plate } = wheel;
    g.clear();
    g.fillStyle(0xffffff, 0.2);
    g.fillCircle(cx, cy, r + plate * 0.5);
    g.fillStyle(0xffffff, 0.12);
    g.fillCircle(cx, cy, r - plate * 0.5);
    const point = (radius: number, angle: number) => ({ x: cx + Math.cos(angle) * radius, y: cy + Math.sin(angle) * radius });
    const gap = (plate * 1.25) / r;
    this.cycle.forEach((type, at) => {
      const start = (wheel.angles.get(type) ?? 0) + gap;
      const end = (wheel.angles.get(this.cycle[(at + 1) % this.cycle.length] ?? type) ?? 0) + (at === this.cycle.length - 1 ? Math.PI * 2 : 0) - gap;
      g.lineStyle(Math.max(4, plate * 0.18), 0x102a43, 0.6);
      g.beginPath();
      g.arc(cx, cy, r, start, end - 0.06, false);
      g.strokePath();
      const tip = point(r, end + 0.04);
      const base = point(r, end - 0.1);
      const out = { x: Math.cos(end) * plate * 0.32, y: Math.sin(end) * plate * 0.32 };
      g.fillStyle(0x102a43, 0.75);
      g.fillTriangle(tip.x, tip.y, base.x + out.x, base.y + out.y, base.x - out.x, base.y - out.y);
    });
    const iconScale = Math.max(2, Math.floor((plate * 1.5) / 16));
    for (const type of this.cycle) {
      const at = point(r, wheel.angles.get(type) ?? 0);
      if (type === this.weather) {
        g.fillStyle(typeColour(type), 0.35 + 0.2 * Math.sin(now / 220));
        g.fillCircle(at.x, at.y, plate * (1.45 + 0.08 * Math.sin(now / 220)));
      }
      g.fillStyle(0xffffff, 0.95);
      g.fillCircle(at.x, at.y, plate);
      g.lineStyle(Math.max(3, plate * 0.16), typeColour(type), 1);
      g.strokeCircle(at.x, at.y, plate);
      this.wheelIcons.get(type)?.setPosition(at.x, at.y).setScale(iconScale);
    }
  }

  private drawFlight(layout: Layout, now: number, frozen: boolean): void {
    const g = this.layers?.fx;
    if (!g) return;
    g.clear();
    const flight = this.flight;
    if (!flight) return;
    const p = Math.min(1, (now - flight.start) / flight.ms);
    const x = flight.from.x + (flight.to.x - flight.from.x) * p;
    const y = flight.from.y + (flight.to.y - flight.from.y) * p - Math.sin(p * Math.PI) * flight.lift;
    const r = layout.size * 0.22;
    const colour = typeColour(flight.type);
    const spin = now / 90;
    switch (flight.type) {
      case 'sun':
        g.fillStyle(0xff922b, 0.6);
        g.fillCircle(x, y, r * 1.5);
        g.fillStyle(0xffd43b, 1);
        g.fillCircle(x, y, r);
        g.fillStyle(0xfff9db, 1);
        g.fillCircle(x - r * 0.3, y - r * 0.3, r * 0.4);
        break;
      case 'rain':
        g.fillStyle(0x1c7ed6, 1);
        g.fillCircle(x, y, r);
        g.fillTriangle(x - r * 0.85, y - r * 0.4, x + r * 0.85, y - r * 0.4, x, y - r * 2);
        g.fillStyle(0xd0ebff, 1);
        g.fillCircle(x - r * 0.35, y - r * 0.2, r * 0.3);
        break;
      case 'frost':
        g.lineStyle(Math.max(3, r * 0.3), 0xffffff, 1);
        for (let arm = 0; arm < 3; arm += 1) {
          const angle = spin + (arm * Math.PI) / 3;
          g.lineBetween(x - Math.cos(angle) * r * 1.3, y - Math.sin(angle) * r * 1.3, x + Math.cos(angle) * r * 1.3, y + Math.sin(angle) * r * 1.3);
        }
        g.fillStyle(colour, 1);
        g.fillCircle(x, y, r * 0.45);
        break;
      case 'storm': {
        const points = [flight.from];
        for (let step = 1; step < 6; step += 1) {
          const t = (p * step) / 6;
          points.push({ x: flight.from.x + (x - flight.from.x) * (step / 6) + (Math.random() - 0.5) * r * 1.5 * t, y: flight.from.y + (y - flight.from.y) * (step / 6) + (Math.random() - 0.5) * r * 2 });
        }
        points.push({ x, y });
        g.lineStyle(r * 0.7, 0x845ef7, 0.6);
        strokeLine(g, points);
        g.lineStyle(r * 0.3, 0xfff3bf, 1);
        strokeLine(g, points);
        g.fillStyle(0xffe066, 1);
        g.fillCircle(x, y, r * 0.8);
        break;
      }
      case 'gale':
        g.lineStyle(Math.max(3, r * 0.35), 0xe3fafc, 1);
        g.beginPath();
        g.arc(x, y, r * 1.2, spin, spin + Math.PI * 1.3, false);
        g.strokePath();
        g.lineStyle(Math.max(3, r * 0.3), colour, 1);
        g.beginPath();
        g.arc(x, y, r * 0.65, spin + Math.PI, spin + Math.PI * 2.2, false);
        g.strokePath();
        break;
      default:
        g.fillStyle(0xf783ac, 1);
        for (let petal = 0; petal < 5; petal += 1) {
          const angle = spin * 0.6 + (petal * Math.PI * 2) / 5;
          g.fillCircle(x + Math.cos(angle) * r * 0.75, y + Math.sin(angle) * r * 0.75, r * 0.55);
        }
        g.fillStyle(0xffd43b, 1);
        g.fillCircle(x, y, r * 0.45);
    }
    const trail = TRAIL[flight.type];
    if (trail && !frozen) {
      for (let at = 0; at < 2; at += 1) {
        const life = 260 + Math.random() * 200;
        this.sparks?.add({ x: x + (Math.random() - 0.5) * r, y: y + (Math.random() - 0.5) * r, vx: (Math.random() - 0.5) * 80, vy: (Math.random() - 0.5) * 80, life, max: life, size: r * 0.45, colour: trail.colour, shape: trail.shape, gravity: trail.gravity });
      }
    }
  }

  private drawRing(layout: Layout, now: number): void {
    const g = this.layers?.ring;
    if (!g) return;
    g.clear();
    const ring = this.ring;
    if (!ring) return;
    const centre = centreOf(layout.spots[0], layout.size);
    const inner = layout.size * 0.62;
    const outer = layout.size * 1.7;
    const p = Math.min(1.3, (now - ring.start) / (ring.target - ring.start));
    const radius = Math.max(inner * 0.5, inner + (outer - inner) * (1 - p));
    const close = Math.abs(now - ring.target) <= ring.perfectMs;
    const colour = ring.kind === 'aim' ? 0xffd43b : 0x4dabf7;
    g.fillStyle(0xffffff, close ? 0.3 : 0.12);
    g.fillCircle(centre.x, centre.y, inner);
    g.lineStyle(close ? 7 : 4, close ? colour : 0xffffff, 1);
    g.strokeCircle(centre.x, centre.y, inner);
    g.lineStyle(8, 0x102a43, 0.5);
    g.strokeCircle(centre.x, centre.y, radius);
    g.lineStyle(6, colour, 1);
    g.strokeCircle(centre.x, centre.y, radius);
    if (ring.kind === 'shield') drawShield(g, centre.x - inner - 14, centre.y - inner + 4, 14, 0x4dabf7);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.time.delayedCall(ms, () => resolve());
    });
  }

  /** Moves a creature's effect values to `to` over `ms`. With reduced motion only the time passes. */
  private tweenFx(fighter: Fighter, to: Partial<Fx>, ms: number, ease = 'Sine.easeInOut'): Promise<void> {
    if (reducedMotion()) {
      if (to.alpha !== undefined) fighter.fx.alpha = to.alpha;
      return this.wait(ms);
    }
    this.tweens.killTweensOf(fighter.fx);
    return new Promise((resolve) => {
      this.tweens.add({ targets: fighter.fx, ...to, duration: ms, ease, onComplete: () => resolve() });
    });
  }

  private fighter(side: Side): Fighter {
    const fighter = this.fighters?.[side];
    if (!fighter) throw new Error('no battle shown');
    return fighter;
  }

  /** One creature's action, start to finish: wind up, lunge, the move flying across, and the hit. */
  async playStrike(strike: Strike, options: { shielded?: boolean } = {}): Promise<void> {
    const layout = this.layout();
    const attacker = this.fighter(strike.side);
    const target = this.fighter(strike.side === 0 ? 1 : 0);
    const from = centreOf(layout.spots[strike.side], layout.size);
    const to = centreOf(layout.spots[strike.side === 0 ? 1 : 0], layout.size);
    const dir = Math.sign(to.x - from.x) || 1;
    if (movePower(strike.move) === 0) return this.callWeather(strike, attacker, from);
    await this.tweenFx(attacker, { sx: 1.25, sy: 0.78, dx: -5 * dir }, 110, 'Quad.easeOut');
    void this.tweenFx(attacker, { sx: 0.82, sy: 1.18, dx: 12 * dir }, 90, 'Quad.easeIn').then(() => this.tweenFx(attacker, { sx: 1, sy: 1, dx: 0 }, 260, 'Back.easeOut'));
    this.flight = { type: strike.moveType, from, to, start: performance.now(), ms: 230, lift: layout.size * 0.35 };
    await this.wait(230);
    this.flight = null;
    if (strike.missed) {
      void this.tweenFx(target, { dx: 10 * dir, dy: -6 }, 120, 'Quad.easeOut').then(() => this.tweenFx(target, { dx: 0, dy: 0 }, 160));
      this.popIcon('puff', to.x + dir * layout.size * 0.5, to.y - layout.size * 0.3, layout.size * 0.2);
      await this.wait(260);
      return;
    }
    await this.impact(strike, target, to, dir, layout, options.shielded ?? false);
  }

  private async impact(strike: Strike, target: Fighter, to: Spot, dir: number, layout: Layout, shielded: boolean): Promise<void> {
    const size = layout.size;
    const strong = strike.effectiveness === 'strong';
    const weak = strike.effectiveness === 'weak';
    const k = Math.min(1, (strike.damage / strike.maxHp) * 2.5);
    const colour = typeColour(strike.moveType);
    const motion = !reducedMotion();
    this.tweens.killTweensOf(target.fx);
    if (motion) Object.assign(target.fx, { sx: 1.3, sy: 0.72, dx: 4 * dir });
    target.image.setTint(0xffffff).setTintMode(TintModes.FILL);
    if (shielded) this.sparks?.ring(to.x, to.y, 0x4dabf7, size * 0.9, 420);
    if (weak) this.sparks?.burst(to.x, to.y, { colour: 0xadb5bd, count: 7, speed: 90, size: size * 0.09, shape: 'dot', gravity: -60 });
    else {
      this.sparks?.burst(to.x, to.y, { colour, count: strong ? 30 : 14, speed: strong ? 420 : 250, size: size * (strong ? 0.11 : 0.08), shape: TRAIL[strike.moveType]?.shape ?? 'dot', life: strong ? 650 : 450 });
      this.sparks?.ring(to.x, to.y, 0xffffff, size * (strong ? 1.3 : 0.8));
      if (strong) this.sparks?.ring(to.x, to.y, colour, size * 1.8, 480);
    }
    this.frozenUntil = performance.now() + HIT_STOP_MS;
    this.tweens.pauseAll();
    await this.wait(HIT_STOP_MS);
    this.tweens.resumeAll();
    target.image.clearTint().setTintMode(TintModes.MULTIPLY);
    const camera = this.cameras.main;
    if (motion && !weak) camera.shake(110 + 150 * k, (0.003 + 0.012 * k) * (strong ? 1.4 : 1), true);
    if (motion && strike.critical) {
      camera.zoomTo(1.12, 70, 'Quad.easeOut', true, (_camera, progress) => {
        if (progress === 1) camera.zoomTo(1, 220, 'Quad.easeIn', true);
      });
    }
    void this.tweenFx(target, { sx: 1, sy: 1, dx: 0 }, 260, 'Back.easeOut');
    this.tweens.add({ targets: target, shownHp: strike.hpAfter, duration: 340, ease: 'Quad.easeOut' });
    this.popNumber(strike, to.x - dir * size * 0.15, to.y - size * 0.55, layout);
    if (strong) this.popIcon('strong', to.x + dir * size * 0.55, to.y - size * 0.45, size * 0.24);
    if (weak) this.popIcon('puff', to.x + dir * size * 0.5, to.y - size * 0.35, size * 0.16);
    await this.wait(240);
  }

  private async callWeather(strike: Strike, attacker: Fighter, from: Spot): Promise<void> {
    const colour = typeColour(strike.moveType);
    await this.tweenFx(attacker, { dy: -10, sx: 0.88, sy: 1.15 }, 150, 'Quad.easeOut');
    this.sparks?.burst(from.x, from.y, { colour, count: 22, speed: 260, size: 6, shape: TRAIL[strike.moveType]?.shape ?? 'dot', gravity: -320, life: 700 });
    await this.tweenFx(attacker, { dy: 0, sx: 1, sy: 1 }, 170, 'Back.easeOut');
    this.sky?.flashOnce(colour, 0.55);
    this.setWeather(strike.weather);
    await this.wait(380);
  }

  private popNumber(strike: Strike, x: number, y: number, layout: Layout): void {
    const strong = strike.effectiveness === 'strong';
    const weak = strike.effectiveness === 'weak';
    const base = Math.max(22, layout.size * 0.3);
    const px = Math.round(base * (strong || strike.critical ? 1.45 : weak ? 0.75 : 1));
    const colour = strike.critical ? '#ff922b' : strong ? '#ffd43b' : weak ? '#ced4da' : '#ffffff';
    const label = this.add
      .text(x, y, String(strike.damage), { fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: `${px}px`, fontStyle: '900', color: colour, stroke: '#102a43', strokeThickness: Math.max(5, Math.round(px * 0.2)) })
      .setOrigin(0.5)
      .setDepth(DEPTH.pop)
      .setScale(0.3);
    this.tweens.add({ targets: label, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: label, y: y - layout.size * 0.45, duration: 750, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: label, alpha: 0, delay: 560, duration: 220, onComplete: () => label.destroy() });
  }

  /** A picture that pops up, holds and fades: a "!!" burst, a puff, a star, a tick or a shield. */
  private popIcon(kind: 'strong' | 'puff' | 'star' | 'tick' | 'shield', x: number, y: number, r: number, hold = 520): void {
    const g = this.add.graphics();
    const parts: GameObjects.GameObject[] = [g];
    if (kind === 'strong') {
      drawBurst(g, 0, 0, r * 1.3, 0xffd43b);
      parts.push(this.add.text(0, 0, '!!', { fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: `${Math.round(r * 1.2)}px`, fontStyle: '900', color: '#e03131' }).setOrigin(0.5));
    } else if (kind === 'puff') drawPuff(g, 0, 0, r);
    else if (kind === 'star') drawStar(g, 0, 0, r, 0xffd43b);
    else if (kind === 'tick') drawTick(g, 0, 0, r);
    else drawShield(g, 0, 0, r, 0x4dabf7);
    const icon = this.add.container(x, y, parts).setDepth(DEPTH.pop).setScale(0);
    this.tweens.add({ targets: icon, scale: 1, duration: 170, ease: 'Back.easeOut' });
    this.tweens.add({ targets: icon, alpha: 0, scale: 0.8, delay: 170 + hold, duration: 180, onComplete: () => icon.destroy() });
  }

  /** The fainted creature turns into a little cloud that floats away. */
  async playFaint(side: Side): Promise<void> {
    const layout = this.layout();
    const fighter = this.fighter(side);
    const centre = centreOf(layout.spots[side], layout.size);
    fighter.gone = true;
    const puff = this.add.graphics();
    drawCloud(puff, 0, 0, layout.size * 0.7, 0xffffff, 0.95);
    puff.fillStyle(0x102a43, 1);
    puff.fillRect(-layout.size * 0.12, -layout.size * 0.04, Math.max(3, layout.size * 0.05), Math.max(2, layout.size * 0.02));
    puff.fillRect(layout.size * 0.07, -layout.size * 0.04, Math.max(3, layout.size * 0.05), Math.max(2, layout.size * 0.02));
    const spirit = this.add.container(centre.x, centre.y, [puff]).setDepth(DEPTH.pop).setAlpha(0).setScale(0.4);
    this.tweens.add({ targets: spirit, alpha: 1, scale: 1, duration: 260, ease: 'Back.easeOut' });
    this.tweens.add({ targets: spirit, y: centre.y - this.scale.height * 0.55, x: centre.x + (side === 0 ? -1 : 1) * layout.size * 0.6, delay: 260, duration: 1700, ease: 'Sine.easeIn' });
    this.tweens.add({ targets: spirit, alpha: 0, delay: 1500, duration: 450, onComplete: () => spirit.destroy() });
    this.sparks?.burst(centre.x, centre.y, { colour: 0xffffff, count: 12, speed: 160, size: 7, shape: 'dot', gravity: -100 });
    if (reducedMotion()) fighter.fx.alpha = 0;
    await this.tweenFx(fighter, { alpha: 0, sx: 1.4, sy: 0.3 }, 280, 'Quad.easeIn');
    await this.wait(420);
  }

  /** A ring around your creature that shrinks onto the inner circle at the returned page time. */
  startRing(kind: RingKind, ms: number, perfectMs: number): number {
    const start = performance.now();
    this.ring = { kind, start, target: start + ms, perfectMs };
    return start + ms;
  }

  stopRing(): void {
    this.ring = null;
  }

  /** When the ring now shown meets the inner circle, for the screenshot script; null with no ring. */
  ringTarget(): number | null {
    return this.ring?.target ?? null;
  }

  /** How the tap went, as a picture over your creature. */
  showJudgement(judgement: Judgement, kind: RingKind): void {
    const layout = this.layout();
    const centre = centreOf(layout.spots[0], layout.size);
    const x = centre.x;
    const y = centre.y - layout.size * 0.85;
    const r = Math.max(18, layout.size * 0.22);
    if (judgement === 'miss') return this.popIcon('puff', x, y, r, 380);
    if (kind === 'shield') {
      this.sparks?.ring(centre.x, centre.y, 0x4dabf7, layout.size, 400);
      return this.popIcon('shield', x, y, r, 380);
    }
    if (judgement === 'good') return this.popIcon('tick', x, y, r, 380);
    this.sky?.flashOnce(0xffd43b, 0.45);
    this.sparks?.burst(centre.x, centre.y, { colour: 0xffd43b, count: 18, speed: 300, size: 7, shape: 'square', gravity: 0 });
    return this.popIcon('star', x, y, r * 1.2, 380);
  }

  /** A bouncing crown over the winner. */
  crown(side: Side): void {
    const layout = this.layout();
    const cloud = layout.clouds[side];
    const g = this.add.graphics();
    drawCrown(g, 0, 0, Math.max(18, layout.size * 0.2));
    const crown = this.add.container(cloud.x, cloud.y - Math.max(56, layout.size * 0.95) * 0.45, [g]).setDepth(DEPTH.pop).setScale(0);
    this.tweens.add({ targets: crown, scale: 1, duration: 260, ease: 'Back.easeOut' });
    if (!reducedMotion()) this.tweens.add({ targets: crown, y: crown.y - 8, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
}
