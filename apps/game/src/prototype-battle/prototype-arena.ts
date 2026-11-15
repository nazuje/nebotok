import { frameNames, spriteFor } from '@nebotok/core';
import { Scene, TintModes, type GameObjects } from 'phaser';
import { moveType } from '../battle-content.ts';
import { creatureTexture } from '../creature-art.ts';
import { sprite, spriteTexture } from '../sprites.ts';
import { ENERGY_COLOUR, drawAlertMark, drawBadge, drawChargeMark, drawEnergyBar, drawHealthBar } from './prototype-bars.ts';
import { ENERGY_MAX } from './prototype-energy.ts';
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
/** A picture over a creature: charging up, an attack coming, or a powered-up next hit. */
export type Mark = 'charge' | 'alert' | 'star';
export type ArenaOptions = {
  readonly layout: ArenaLayout;
  /** Variants 4 and 5 show an energy bar under each health bar. */
  readonly energy: boolean;
  /** The band of the screen the arena may use, top and bottom in CSS pixels. */
  field(): { top: number; bottom: number };
};
/** What lands when an attack reaches its target, worked out only at that moment. */
export type Landed = { readonly strike: Strike; readonly shielded: boolean };
export type Attack = { readonly side: Side; readonly move: string; readonly quick?: boolean; land(): Landed | null };

/** How an effect has moved, squashed or faded a creature; tweens change these. dx and dy are in art pixels. */
type Fx = { dx: number; dy: number; sx: number; sy: number; alpha: number };
type Fighter = {
  species: string;
  type: string;
  level: number;
  maxHp: number;
  shownHp: number;
  trailHp: number;
  flashUntil: number;
  energy: number;
  aura: number | null;
  mark: Mark | null;
  hopUntil: number;
  gone: boolean;
  image: GameObjects.Image;
  badge: GameObjects.Text;
  bang: GameObjects.Text;
  fx: Fx;
};
type Flight = { type: string; from: Spot; to: Spot; start: number; ms: number; lift: number };
type Ring = { kind: RingKind; start: number; target: number; perfectMs: number };
type Layers = { wheel: GameObjects.Graphics; islands: GameObjects.Graphics; aura: GameObjects.Graphics; bars: GameObjects.Graphics; fx: GameObjects.Graphics; marks: GameObjects.Graphics; ring: GameObjects.Graphics };

const DEPTH = { wheel: 3, islands: 4, aura: 4.5, creatures: 5, bars: 6, badges: 6.5, fx: 7, sparks: 7.5, pop: 8, marks: 8.5, bang: 8.6, ring: 9 } as const;
const HIT_STOP_MS = 70;
const WIND_MS = 110;
const FLIGHT_MS = 230;
/** From the start of an attack to its hit: the lean back plus the flight. Variant 5 times its dodges by it. */
export const ATTACK_LEAD_MS = WIND_MS + FLIGHT_MS;
const FONT = 'system-ui, -apple-system, sans-serif';
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
const otherSide = (side: Side): Side => (side === 0 ? 1 : 0);

/**
 * The prototype's battle field: open sky painted by the weather, the two creatures (on floating
 * islands, or on the weather wheel), their health and energy bars, and every bit of hit juice. The
 * page drives it with the async methods; each resolves when its animation is done.
 */
export class ArenaScene extends Scene {
  readonly ready: Promise<void>;
  private readonly options: ArenaOptions;
  private markReady: () => void = () => undefined;
  private sky: Sky | null = null;
  private layers: Layers | null = null;
  private sparks: Sparks | null = null;
  private fighters: [Fighter, Fighter] | null = null;
  private wheelIcons = new Map<string, GameObjects.Image>();
  private weather: string | null = null;
  private flights = new Set<Flight>();
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
    this.layers = { wheel: layer(DEPTH.wheel), islands: layer(DEPTH.islands), aura: layer(DEPTH.aura), bars: layer(DEPTH.bars), fx: layer(DEPTH.fx), marks: layer(DEPTH.marks), ring: layer(DEPTH.ring) };
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

  show(battle: ProtoBattle, energy: readonly [number, number] = [0, 0]): void {
    const make = (side: Side): Fighter => {
      const creature = battle.fighters[side];
      const texture = creatureTexture(this, creature.species, 'front');
      const image = this.add.image(0, 0, texture.key, texture.frame).setOrigin(0.5, 1).setDepth(DEPTH.creatures);
      const badge = this.add.text(0, 0, `Lv ${creature.level}`, { fontFamily: FONT, fontStyle: '900', color: '#ffffff' }).setOrigin(0, 0.5).setDepth(DEPTH.badges);
      const bang = this.add.text(0, 0, '!', { fontFamily: FONT, fontStyle: '900', color: '#e03131' }).setOrigin(0.5).setDepth(DEPTH.bang).setVisible(false);
      return { species: creature.species, type: creature.type, level: creature.level, maxHp: creature.maxHp, shownHp: creature.hp, trailHp: creature.hp, flashUntil: 0, energy: energy[side], aura: null, mark: null, hopUntil: 0, gone: false, image, badge, bang, fx: rest() };
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
    return duelLayout(width, top, bottom, this.options.energy);
  }

  override update(_time: number, delta: number): void {
    const now = performance.now();
    const frozen = now < this.frozenUntil;
    this.sky?.update(now, delta, this.scale.width, this.scale.height, frozen);
    if (!this.layers || !this.fighters) return;
    const layout = this.layout();
    this.drawWheel(layout, now);
    this.drawFighters(layout, now);
    this.drawBars(layout, now);
    this.drawFlights(layout, now, frozen);
    if (!frozen) this.sparks?.update(delta);
    this.sparks?.draw();
    this.drawRing(layout, now);
  }

  private bob(side: Side, now: number, layout: Layout): number {
    return reducedMotion() ? 0 : Math.sin(now / 700 + side * 1.7) * layout.scale * 1.5;
  }

  private drawFighters(layout: Layout, now: number): void {
    if (!this.layers || !this.fighters) return;
    const { islands, aura } = this.layers;
    islands.clear();
    aura.clear();
    for (const side of [0, 1] as const) {
      const fighter = this.fighters[side];
      const spot = layout.spots[side];
      const other = layout.spots[otherSide(side)];
      const bob = this.bob(side, now, layout);
      if (!layout.wheel) drawIsland(islands, spot.x, spot.y + bob + layout.size * 0.03, layout.size * 1.6, lerpColour(0x69c34d, typeColour(fighter.type), 0.3));
      const { fx } = fighter;
      if (fighter.aura !== null && !fighter.gone) {
        const pulse = reducedMotion() ? 0.5 : 0.5 + 0.5 * Math.sin(now / 110);
        const centre = centreOf(spot, layout.size);
        aura.fillStyle(fighter.aura, 0.18 + 0.14 * pulse);
        aura.fillCircle(centre.x + fx.dx * layout.scale, centre.y + bob, layout.size * (0.78 + 0.06 * pulse));
        aura.fillStyle(fighter.aura, 0.3 + 0.15 * pulse);
        aura.fillCircle(centre.x + fx.dx * layout.scale, centre.y + bob, layout.size * 0.58);
      }
      fighter.image
        .setPosition(spot.x + fx.dx * layout.scale, spot.y + bob + fx.dy * layout.scale)
        .setScale(layout.scale * fx.sx, layout.scale * fx.sy)
        .setAlpha(fx.alpha)
        .setFlipX(spot.x < other.x);
    }
  }

  private badgeColour(side: Side): number {
    const fighters = this.fighters;
    if (!fighters || side === 0) return 0x102a43;
    const gap = fighters[1].level - fighters[0].level;
    return gap > 0 ? 0xc92a2a : gap < 0 ? 0x2b8a3e : 0x102a43;
  }

  private drawBars(layout: Layout, now: number): void {
    if (!this.layers || !this.fighters) return;
    const { bars, marks } = this.layers;
    bars.clear();
    marks.clear();
    const { barWidth: width, barHeight: height } = layout;
    for (const side of [0, 1] as const) {
      const fighter = this.fighters[side];
      const bar = layout.bars[side];
      drawHealthBar(bars, { x: bar.x, y: bar.y, width, height, shown: fighter.shownHp, trail: fighter.trailHp, max: fighter.maxHp, flash: now < fighter.flashUntil });
      const energyHeight = Math.max(9, Math.round(height * 0.55));
      if (this.options.energy && !fighter.gone) drawEnergyBar(bars, bar.x, bar.y + height / 2 + 7 + energyHeight / 2, width, energyHeight, fighter.energy, ENERGY_MAX, now);
      const font = Math.max(13, Math.round(height * 0.8));
      fighter.badge.setFontSize(font);
      const badgeHeight = font + 6;
      const badgeY = bar.y - height / 2 - 6 - badgeHeight / 2;
      drawBadge(bars, bar.x - width / 2 - 3, badgeY - badgeHeight / 2, fighter.badge.width + 14, badgeHeight, this.badgeColour(side));
      fighter.badge.setPosition(bar.x - width / 2 + 4, badgeY);
      const r = Math.max(15, height * 0.95);
      const mx = bar.x + width / 2 - r * 0.6;
      const my = badgeY - r * 0.35;
      const mark = fighter.gone ? null : fighter.mark;
      if (mark === 'charge') drawChargeMark(marks, mx, my, r, now);
      if (mark === 'alert') drawAlertMark(marks, mx, my, r, now);
      if (mark === 'star') drawStar(marks, mx, my, r * 0.9, 0xffd43b);
      fighter.bang.setVisible(mark === 'alert').setPosition(mx, my).setFontSize(Math.round(r * 1.3));
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

  private drawFlights(layout: Layout, now: number, frozen: boolean): void {
    const g = this.layers?.fx;
    if (!g) return;
    g.clear();
    for (const flight of this.flights) this.drawFlight(g, flight, layout, now, frozen);
  }

  private drawFlight(g: GameObjects.Graphics, flight: Flight, layout: Layout, now: number, frozen: boolean): void {
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
    const outer = layout.size * 1.35;
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

  /**
   * Moves a creature's effect values to `to` over `ms`. With reduced motion only the time passes.
   * The wait is a timer, not the tween's end: a later effect on the same creature kills this tween,
   * and in the live duel that happens mid-attack.
   */
  private tweenFx(fighter: Fighter, to: Partial<Fx>, ms: number, ease = 'Sine.easeInOut'): Promise<void> {
    if (reducedMotion()) {
      if (to.alpha !== undefined) fighter.fx.alpha = to.alpha;
      return this.wait(ms);
    }
    this.tweens.killTweensOf(fighter.fx);
    this.tweens.add({ targets: fighter.fx, ...to, duration: ms, ease });
    return this.wait(ms);
  }

  private fighter(side: Side): Fighter {
    const fighter = this.fighters?.[side];
    if (!fighter) throw new Error('no battle shown');
    return fighter;
  }

  setEnergy(side: Side, energy: number, animate = true): void {
    const fighter = this.fighter(side);
    if (!animate || reducedMotion()) {
      fighter.energy = energy;
      return;
    }
    this.tweens.add({ targets: fighter, energy, duration: 260, ease: 'Quad.easeOut' });
  }

  setAura(side: Side, colour: number | null): void {
    this.fighter(side).aura = colour;
  }

  setMark(side: Side, mark: Mark | null): void {
    this.fighter(side).mark = mark;
  }

  /** A turn-based strike whose outcome is already known. */
  async playStrike(strike: Strike, options: { shielded?: boolean } = {}): Promise<void> {
    await this.playAttack({ side: strike.side, move: strike.move, land: () => ({ strike, shielded: options.shielded ?? false }) });
  }

  /** One creature's attack, start to finish: lean back, lunge, the move flying across, and the hit. */
  async playAttack(attack: Attack): Promise<Strike | null> {
    const layout = this.layout();
    const attacker = this.fighter(attack.side);
    const targetSide = otherSide(attack.side);
    const target = this.fighter(targetSide);
    const from = centreOf(layout.spots[attack.side], layout.size);
    const to = centreOf(layout.spots[targetSide], layout.size);
    const dir = Math.sign(to.x - from.x) || 1;
    if (movePower(attack.move) === 0) {
      const landed = attack.land();
      if (landed) await this.callWeather(landed.strike, attacker, from);
      return landed?.strike ?? null;
    }
    if (!attack.quick) await this.tweenFx(attacker, { sx: 1.25, sy: 0.78, dx: -5 * dir }, WIND_MS, 'Quad.easeOut');
    void this.tweenFx(attacker, { sx: 0.82, sy: 1.18, dx: 12 * dir }, 90, 'Quad.easeIn').then(() => this.tweenFx(attacker, { sx: 1, sy: 1, dx: 0, dy: 0 }, 260, 'Back.easeOut'));
    const flightMs = attack.quick ? 150 : FLIGHT_MS;
    const flight: Flight = { type: moveType(attack.move) ?? 'sun', from, to, start: performance.now(), ms: flightMs, lift: layout.size * (attack.quick ? 0.1 : 0.35) };
    this.flights.add(flight);
    await this.wait(flightMs);
    this.flights.delete(flight);
    const landed = attack.land();
    if (!landed) return null;
    const { strike, shielded } = landed;
    if (strike.dodged) await this.dodged(targetSide, to, layout);
    else if (strike.missed) {
      void this.tweenFx(target, { dx: 10 * dir, dy: -6 }, 120, 'Quad.easeOut').then(() => this.tweenFx(target, { dx: 0, dy: 0 }, 160));
      this.popIcon('puff', to.x + dir * layout.size * 0.5, to.y - layout.size * 0.3, layout.size * 0.2);
      await this.wait(260);
    } else await this.impact(strike, target, to, dir, layout, shielded);
    return strike;
  }

  /** A quick hop out of the way; does nothing while already hopping. */
  dodgeHop(side: Side): void {
    const fighter = this.fighter(side);
    const now = performance.now();
    if (now < fighter.hopUntil) return;
    fighter.hopUntil = now + 360;
    const layout = this.layout();
    const centre = centreOf(layout.spots[side], layout.size);
    const away = side === 0 ? -1 : 1;
    this.sparks?.burst(centre.x - away * layout.size * 0.3, centre.y, { colour: 0xffffff, count: 6, speed: 220, size: layout.size * 0.12, shape: 'line', gravity: 0, life: 260 });
    if (reducedMotion()) {
      this.sparks?.ring(centre.x, centre.y, 0x4dabf7, layout.size * 0.9, 300);
      return;
    }
    void this.tweenFx(fighter, { dy: -14, dx: 6 * away, sx: 0.9, sy: 1.12 }, 130, 'Quad.easeOut').then(() => this.tweenFx(fighter, { dy: 0, dx: 0, sx: 1, sy: 1 }, 220, 'Quad.easeIn'));
  }

  /** The whole hit dodged: a hop if the dodge was not already shown, then a gold flash back at the attacker. */
  private async dodged(side: Side, at: Spot, layout: Layout): Promise<void> {
    this.dodgeHop(side);
    this.sky?.flashOnce(0xffffff, 0.35);
    this.sparks?.ring(at.x, at.y, 0xffd43b, layout.size * 1.2, 380);
    this.sparks?.burst(at.x, at.y, { colour: 0xffd43b, count: 14, speed: 300, size: 6, shape: 'square', gravity: 0 });
    this.popIcon('star', at.x, at.y - layout.size * 0.75, Math.max(18, layout.size * 0.24), 360);
    await this.wait(260);
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
    target.flashUntil = performance.now() + HIT_STOP_MS + 110;
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
    void this.tweenFx(target, { sx: 1, sy: 1, dx: 0, dy: 0 }, 260, 'Back.easeOut');
    this.tweens.killTweensOf(target);
    this.tweens.add({ targets: target, shownHp: strike.hpAfter, duration: 180, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: target, trailHp: strike.hpAfter, delay: 450, duration: 420, ease: 'Quad.easeIn' });
    this.popNumber(strike, to.x - dir * size * (0.7 + Math.random() * 0.15), to.y + size * (Math.random() * 0.2 - 0.05), layout);
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

  /** Charging up: a cyan glow, sparks rising from the feet and a little stretch. */
  async playCharge(side: Side): Promise<void> {
    const layout = this.layout();
    const fighter = this.fighter(side);
    const spot = layout.spots[side];
    fighter.aura = ENERGY_COLOUR;
    this.sparks?.burst(spot.x, spot.y - layout.size * 0.1, { colour: ENERGY_COLOUR, count: 18, speed: 120, size: 7, shape: 'square', gravity: -600, life: 600 });
    this.sparks?.ring(spot.x, spot.y - layout.size / 2, ENERGY_COLOUR, layout.size * 1.1, 420);
    await this.tweenFx(fighter, { sx: 0.9, sy: 1.15, dy: -4 }, 160, 'Quad.easeOut');
    await this.tweenFx(fighter, { sx: 1, sy: 1, dy: 0 }, 200, 'Back.easeOut');
  }

  /** Leaning back before a big attack, with a glow and a "!" over it. Clear with `endWindUp`. */
  windUp(side: Side, ms: number): void {
    const fighter = this.fighter(side);
    const away = side === 0 ? -1 : 1;
    fighter.aura = 0xff922b;
    fighter.mark = 'alert';
    void this.tweenFx(fighter, { dx: 7 * away, sx: 1.12, sy: 0.9 }, ms * 0.8, 'Quad.easeOut');
  }

  endWindUp(side: Side): void {
    const fighter = this.fighter(side);
    fighter.aura = null;
    if (fighter.mark === 'alert') fighter.mark = null;
  }

  private popNumber(strike: Strike, x: number, y: number, layout: Layout): void {
    const strong = strike.effectiveness === 'strong';
    const weak = strike.effectiveness === 'weak';
    const base = Math.max(22, layout.size * 0.3);
    const px = Math.round(base * (strong || strike.critical ? 1.45 : weak ? 0.75 : 1));
    const colour = strike.critical ? '#ff922b' : strong ? '#ffd43b' : weak ? '#ced4da' : '#ffffff';
    const label = this.add
      .text(x, y, String(strike.damage), { fontFamily: FONT, fontSize: `${px}px`, fontStyle: '900', color: colour, stroke: '#102a43', strokeThickness: Math.max(5, Math.round(px * 0.2)) })
      .setOrigin(0.5)
      .setDepth(DEPTH.pop)
      .setScale(0.3);
    this.tweens.add({ targets: label, scale: 1, duration: 160, ease: 'Back.easeOut' });
    this.tweens.add({ targets: label, y: y - layout.size * 0.3, duration: 750, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: label, alpha: 0, delay: 560, duration: 220, onComplete: () => label.destroy() });
  }

  /** A picture that pops up, holds and fades: a "!!" burst, a puff, a star, a tick or a shield. */
  private popIcon(kind: 'strong' | 'puff' | 'star' | 'tick' | 'shield', x: number, y: number, r: number, hold = 520): void {
    const g = this.add.graphics();
    const parts: GameObjects.GameObject[] = [g];
    if (kind === 'strong') {
      drawBurst(g, 0, 0, r * 1.3, 0xffd43b);
      parts.push(this.add.text(0, 0, '!!', { fontFamily: FONT, fontSize: `${Math.round(r * 1.2)}px`, fontStyle: '900', color: '#e03131' }).setOrigin(0.5));
    } else if (kind === 'puff') drawPuff(g, 0, 0, r);
    else if (kind === 'star') drawStar(g, 0, 0, r, 0xffd43b);
    else if (kind === 'tick') drawTick(g, 0, 0, r);
    else drawShield(g, 0, 0, r, 0x4dabf7);
    const icon = this.add.container(x, y, parts).setDepth(DEPTH.pop).setScale(0);
    this.tweens.add({ targets: icon, scale: 1, duration: 170, ease: 'Back.easeOut' });
    this.tweens.add({ targets: icon, alpha: 0, scale: 0.8, delay: 170 + hold, duration: 180, onComplete: () => icon.destroy() });
  }

  /** The fainted creature turns into a little cloud that floats away. Its empty bar stays. */
  async playFaint(side: Side): Promise<void> {
    const layout = this.layout();
    const fighter = this.fighter(side);
    const centre = centreOf(layout.spots[side], layout.size);
    fighter.gone = true;
    fighter.aura = null;
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

  /** A bouncing crown over the winner's bar. */
  crown(side: Side): void {
    const layout = this.layout();
    const bar = layout.bars[side];
    const fighter = this.fighter(side);
    fighter.mark = null;
    fighter.aura = null;
    const r = Math.max(18, layout.size * 0.2);
    const g = this.add.graphics();
    drawCrown(g, 0, 0, r);
    const crown = this.add.container(bar.x, bar.y - layout.barHeight * 2.4 - r, [g]).setDepth(DEPTH.pop).setScale(0);
    this.tweens.add({ targets: crown, scale: 1, duration: 260, ease: 'Back.easeOut' });
    if (!reducedMotion()) this.tweens.add({ targets: crown, y: crown.y - 8, duration: 500, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
  }
}
