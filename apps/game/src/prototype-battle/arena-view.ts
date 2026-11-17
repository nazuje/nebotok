import { Scene, TintModes, type GameObjects } from 'phaser';
import { creatureTexture } from '../creature-art.ts';
import { aimLocked, aimOf } from './arena-abilities.ts';
import { ARENA } from './arena-kits.ts';
import { drawAim, drawCone, drawEdgeDanger, drawGroundTreat, drawHeart, drawIce, drawIsland, drawLightning, drawShield, drawShot, drawStorm, drawTelegraph, drawZone, toScreen, type Fit } from './arena-paint.ts';
import { stormWarning, you, type ArenaEvent, type ArenaState, type Fighter, type Side } from './arena-state.ts';
import { drawAlertMark, drawBadge, drawHealthBar } from './prototype-bars.ts';
import { typeColour } from './prototype-icons.ts';
import { Sky } from './prototype-sky.ts';
import { Sparks } from './prototype-sparks.ts';

/**
 * Draws an arena battle with Phaser: the sky, the island and the storm, zones, shots, creatures with
 * their bars, and the juice (hit-stop, shake, shards, smoke, springs, falls, hearts). It only reads
 * the state; `react` turns each tick's events into effects.
 */

export type Field = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

type Spring = { value: number; velocity: number };
type Look = {
  readonly image: GameObjects.Image;
  readonly badge: GameObjects.Text;
  readonly frameHeight: number;
  squash: Spring;
  phase: number;
  flipped: boolean;
  shownHp: number;
  trailHp: number;
  flashUntil: number;
  fall: { at: number; x: number; y: number; vx: number; vy: number; poofed: boolean } | null;
};
type Popup = { text: GameObjects.Text; born: number; x: number; y: number };
type Flash = { kind: 'cone'; side: Side; born: number; angle: number; length: number; half: number };
type Heart = { x: number; y: number; vx: number; vy: number; born: number; life: number; size: number };

const FONT = 'system-ui, -apple-system, sans-serif';
const DEPTH = { island: 3, under: 4, storm: 4.6, shadows: 4.8, creatures: 5, over: 7, sparks: 7.5, bars: 8, badges: 8.5, popups: 9 } as const;
const SPRING = { stiffness: 900, damping: 17 } as const;
const FALL_MS = 1000;
/** How tall a creature's picture is, in body radii: the sprites leave room around the creature in their frame. */
const CREATURE_SIZE = 3.4;

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function stepSpring(spring: Spring, seconds: number): void {
  let left = Math.min(seconds, 0.1);
  while (left > 0) {
    const step = Math.min(left, 1 / 240);
    spring.velocity += (-SPRING.stiffness * spring.value - SPRING.damping * spring.velocity) * step;
    spring.value += spring.velocity * step;
    left -= step;
  }
}

export class ArenaView extends Scene {
  readonly ready: Promise<void>;
  /** Called every frame before drawing, with the page time and milliseconds since the last frame. */
  onFrame: ((now: number, dt: number) => void) | null = null;
  private readonly field: () => Field;
  private markReady: () => void = () => undefined;
  private sky: Sky | null = null;
  private g: Record<'island' | 'under' | 'storm' | 'shadows' | 'over' | 'bars', GameObjects.Graphics> | null = null;
  private sparks: Sparks | null = null;
  private looks = new Map<Fighter, Look>();
  private popups: Popup[] = [];
  private flashes: Flash[] = [];
  private hearts: Heart[] = [];
  private shake = { at: 0, ms: 0, px: 0 };
  private bolt = { until: 0, angle: 0, seed: 0 };
  private fit: Fit = { cx: 0, cy: 0, s: 1 };
  /** The arena radius the camera frames, easing in as the storm shrinks the island. */
  private framed = ARENA.radius;
  private stateRef: ArenaState | null = null;

  constructor(field: () => Field) {
    super({ key: 'arena-view' });
    this.field = field;
    this.ready = new Promise((resolve) => {
      this.markReady = resolve;
    });
  }

  create(): void {
    this.sky = new Sky(this);
    const layer = (depth: number) => this.add.graphics().setDepth(depth);
    this.g = { island: layer(DEPTH.island), under: layer(DEPTH.under), storm: layer(DEPTH.storm), shadows: layer(DEPTH.shadows), over: layer(DEPTH.over), bars: layer(DEPTH.bars) };
    this.sparks = new Sparks(layer(DEPTH.sparks));
    this.markReady();
  }

  /** Makes the pictures for your three creatures and the wild one. */
  bind(state: ArenaState): void {
    this.stateRef = state;
    for (const fighter of [...state.team, state.wild]) {
      const texture = creatureTexture(this, fighter.creature.species, 'front');
      const image = this.add.image(0, 0, texture.key, texture.frame).setOrigin(0.5, 0.92).setDepth(DEPTH.creatures);
      const badge = this.add.text(0, 0, `Lv ${fighter.creature.level}`, { fontFamily: FONT, fontStyle: '900', color: '#ffffff' }).setOrigin(0, 0.5).setDepth(DEPTH.badges);
      this.looks.set(fighter, { image, badge, frameHeight: image.frame.height, squash: { value: 0, velocity: 0 }, phase: 0, flipped: false, shownHp: fighter.hp, trailHp: fighter.hp, flashUntil: 0, fall: null });
    }
  }

  /** Where the island goes: the biggest circle the controls leave room for, closer as the storm shrinks it. */
  private fitTo(radius: number, dt: number): Fit {
    this.framed += (radius - this.framed) * Math.min(1, dt / 600);
    const field = this.field();
    const width = Math.max(100, field.right - field.left);
    const height = Math.max(100, field.bottom - field.top);
    const s = Math.min(width, height) / 2 / (this.framed * 1.1 + ARENA.body * 1.6);
    return { cx: (field.left + field.right) / 2, cy: (field.top + field.bottom) / 2 - this.framed * 0.06 * s, s };
  }

  override update(time: number, delta: number): void {
    this.onFrame?.(time, delta);
  }

  /** Draws the state, `alpha` of the way from the last tick to this one. */
  draw(state: ArenaState, alpha: number, now: number, dt: number): void {
    const g = this.g;
    if (!g || !this.sky) return;
    const shake = this.shakeOffset(now);
    const base = this.fitTo(state.storm.radius, dt);
    this.fit = { cx: base.cx + shake.x, cy: base.cy + shake.y, s: base.s };
    const fit = this.fit;
    this.sky.update(now, dt, this.scale.width, this.scale.height, false);
    for (const layer of Object.values(g)) layer.clear();
    drawIsland(g.island, fit, state.storm.radius);
    const warning = stormWarning(state);
    drawStorm(g.storm, fit, state, warning, now);
    this.lightning(state, warning, now);
    if (state.treat.state === 'ground') drawGroundTreat(g.under, toScreen(fit, state.treat.x, state.treat.y), Math.max(10, ARENA.body * 0.4 * fit.s), Math.max(0, (state.treat.until - state.tick) / 300), now);
    for (const zone of state.zones) drawZone(zone.kind === 'wall' ? g.over : g.under, fit, zone, state.tick, alpha, now);
    for (const shot of state.shots) {
      const at = toScreen(fit, shot.px + (shot.x - shot.px) * alpha, shot.py + (shot.y - shot.py) * alpha);
      const owner = shot.side === 0 ? you(state) : state.wild;
      drawShot(g.over, fit, shot, at, typeColour(owner.creature.type), now);
      if (!shot.treat && Math.random() < 0.6) this.sparks?.add({ x: at.x, y: at.y, vx: -shot.vx * 0.05 * fit.s, vy: -shot.vy * 0.05 * fit.s, life: 220, max: 220, size: shot.radius * fit.s * 0.6, colour: typeColour(owner.creature.type), shape: 'dot', gravity: 0 });
    }
    this.drawFlashes(state, now);
    for (const fighter of [...state.team, state.wild]) this.drawFighter(state, fighter, alpha, now, dt);
    this.drawHearts(now, dt);
    this.sparks?.update(dt);
    this.sparks?.draw();
    this.drawPopups(now);
  }

  private lightning(state: ArenaState, warning: number | null, now: number): void {
    const g = this.g;
    if (!g || reducedMotion()) return;
    if (warning !== null && now > this.bolt.until + 250 && Math.random() < 0.05) this.bolt = { until: now + 90, angle: Math.random() * Math.PI * 2, seed: Math.random() * 100 };
    if (now < this.bolt.until) drawLightning(g.storm, this.fit, state.storm.radius, this.bolt.angle, this.bolt.seed);
  }

  private shakeOffset(now: number): { x: number; y: number } {
    const progress = (now - this.shake.at) / Math.max(1, this.shake.ms);
    if (progress < 0 || progress >= 1) return { x: 0, y: 0 };
    const fade = this.shake.px * (1 - progress) * (1 - progress);
    return { x: fade * Math.sin(progress * 53), y: fade * Math.cos(progress * 41) };
  }

  private drawFighter(state: ArenaState, fighter: Fighter, alpha: number, now: number, dt: number): void {
    const look = this.looks.get(fighter);
    const g = this.g;
    if (!look || !g) return;
    const active = fighter.side === 1 || fighter === you(state);
    look.image.setVisible(active);
    look.badge.setVisible(active && !look.fall);
    if (!active) return;
    const fit = this.fit;
    const x = fighter.px + (fighter.x - fighter.px) * alpha;
    const y = fighter.py + (fighter.y - fighter.py) * alpha;
    const at = toScreen(fit, x, y);
    const size = ARENA.body * CREATURE_SIZE * fit.s;
    const scale = size / look.frameHeight;
    const speed = Math.hypot(fighter.vx, fighter.vy);
    const motion = !reducedMotion();
    stepSpring(look.squash, dt / 1000);
    if (speed > 40 && motion) look.phase += (dt / 1000) * (6 + speed / 50);
    const hop = motion && fighter.steering ? Math.abs(Math.sin(look.phase)) * size * 0.12 : 0;
    const squash = look.squash.value + (motion && fighter.steering ? Math.sin(look.phase * 2) * 0.05 : 0);
    const facingX = Math.cos(fighter.face);
    if (facingX < -0.15) look.flipped = true;
    if (facingX > 0.15) look.flipped = false;
    if (fighter.fallAt !== null || look.fall) return this.drawFall(fighter, look, at, scale, now);
    if (fighter.hp <= 0) {
      look.image.setPosition(at.x, at.y).setScale(scale * 1.15, scale * 0.6).setAngle(look.flipped ? -80 : 80).setAlpha(0.6).setDepth(DEPTH.creatures);
      look.badge.setVisible(false);
      return;
    }
    const danger = state.options.ringOut ? Math.max(0, Math.min(1, (Math.hypot(x, y) - (state.storm.radius - ARENA.body * 2.2)) / (ARENA.body * 1.8))) : 0;
    if (danger > 0) drawEdgeDanger(g.under, fit, state.storm.radius, fighter, danger, now);
    g.shadows.fillStyle(0x1b3a1f, 0.28);
    g.shadows.fillEllipse(at.x, at.y + size * 0.02, size * 0.75 * (1 - hop / size), size * 0.26);
    if (fighter.slowUntil > state.tick) {
      g.shadows.fillStyle(0x4dabf7, 0.6);
      g.shadows.fillEllipse(at.x, at.y + size * 0.02, size * 0.95, size * 0.34);
    }
    const knocked = fighter.knockedUntil > state.tick && motion;
    const wobble = knocked ? Math.sin(now / 35) * 14 : danger > 0.6 && motion ? Math.sin(now / 60) * 8 : 0;
    look.image
      .setPosition(at.x, at.y - hop)
      .setScale(scale * (1 + squash) * (look.flipped ? -1 : 1), scale * (1 - squash))
      .setAngle(wobble)
      .setAlpha(1)
      .setDepth(DEPTH.creatures + y / 10_000);
    if (now < look.flashUntil) look.image.setTint(0xffffff).setTintMode(TintModes.FILL);
    else look.image.clearTint().setTintMode(TintModes.MULTIPLY);
    const centre = { x: at.x, y: at.y - size * 0.42 };
    if (fighter.windup) {
      const pulse = 0.35 + 0.25 * Math.sin(now / 70);
      g.under.fillStyle(typeColour(fighter.creature.type), pulse);
      g.under.fillCircle(centre.x, centre.y, size * 0.62);
      drawTelegraph(g.under, fit, fighter, { x: at.x, y: at.y }, now);
      drawAlertMark(g.bars, at.x + size * 0.45, at.y - size * 1.05, size * 0.24, now);
    }
    if (fighter.lungeUntil > state.tick || fighter.dashUntil > state.tick) this.trail(fighter, at, size);
    if (fighter.shieldUntil > state.tick) drawShield(g.over, centre, size * 0.62, now);
    if (fighter.rootUntil > state.tick) drawIce(g.over, centre, size * 0.5);
    if (fighter.side === 0) {
      const aim = aimOf(state, fighter, null);
      const angle = Math.atan2(aim.y, aim.x);
      const reach = size * 0.62;
      drawAim(g.over, { x: centre.x + Math.cos(angle) * reach, y: centre.y + Math.sin(angle) * reach + size * 0.15 }, angle, Math.max(9, size * 0.17), aimLocked(state, fighter));
    }
    this.drawBar(state, fighter, look, at, size, dt, now);
  }

  private drawBar(state: ArenaState, fighter: Fighter, look: Look, at: { x: number; y: number }, size: number, dt: number, now: number): void {
    const g = this.g;
    if (!g) return;
    look.shownHp += (fighter.hp - look.shownHp) * Math.min(1, dt / 70);
    if (look.trailHp < look.shownHp) look.trailHp = look.shownHp;
    else look.trailHp = Math.max(look.shownHp, look.trailHp - (fighter.maxHp * dt) / 900);
    const width = Math.max(56, size * 1.05);
    const height = Math.max(8, size * 0.13);
    const top = at.y - size * 1.08;
    drawHealthBar(g.bars, { x: at.x + 10, y: top, width, height, shown: look.shownHp, trail: look.trailHp, max: fighter.maxHp, flash: now < look.flashUntil });
    const gap = fighter.creature.level - (fighter.side === 1 ? you(state).creature.level : state.wild.creature.level);
    const fontPx = Math.max(11, Math.round(height * 1.25));
    look.badge.setFontSize(fontPx);
    const badgeW = look.badge.width + 8;
    const left = at.x + 10 - width / 2 - badgeW - 4;
    drawBadge(g.bars, left, top - fontPx * 0.65, badgeW, fontPx * 1.3, gap > 0 ? 0xe03131 : gap < 0 ? 0x2f9e44 : 0x102a43);
    look.badge.setPosition(left + 4, top);
  }

  private trail(fighter: Fighter, at: { x: number; y: number }, size: number): void {
    if (!this.sparks || reducedMotion()) return;
    for (let at2 = 0; at2 < 2; at2 += 1) {
      const life = 380 + Math.random() * 200;
      this.sparks.add({ x: at.x + (Math.random() - 0.5) * size * 0.4, y: at.y - Math.random() * size * 0.3, vx: -fighter.vx * 0.06 * this.fit.s + (Math.random() - 0.5) * 40, vy: -fighter.vy * 0.06 * this.fit.s - 20, life, max: life, size: size * (0.12 + Math.random() * 0.1), colour: Math.random() < 0.7 ? 0xf1f3f5 : 0xced4da, shape: 'dot', gravity: -30 });
    }
  }

  private drawFall(fighter: Fighter, look: Look, at: { x: number; y: number }, scale: number, now: number): void {
    look.fall ??= { at: now, x: at.x, y: at.y, vx: fighter.vx * this.fit.s, vy: fighter.vy * this.fit.s, poofed: false };
    const fall = look.fall;
    const t = Math.min(1, (now - fall.at) / FALL_MS);
    // Seen from above, falling is drifting away from the island while shrinking into the clouds below.
    const outX = fall.x - this.fit.cx;
    const outY = fall.y - this.fit.cy;
    const out = Math.hypot(outX, outY) || 1;
    const drift = (1 - (1 - t) * (1 - t)) * ARENA.body * 2.2 * this.fit.s;
    const x = fall.x + (outX / out) * drift + fall.vx * 0.12 * t;
    const y = fall.y + (outY / out) * drift + fall.vy * 0.12 * t + t * t * ARENA.body * 1.5 * this.fit.s;
    const shrink = 1 - 0.8 * t * t;
    look.image
      .setPosition(x, y)
      .setScale(scale * shrink * (look.flipped ? -1 : 1), scale * shrink)
      .setAngle(t * 420 * (look.flipped ? -1 : 1))
      .setAlpha(t < 0.8 ? 1 : (1 - t) / 0.2)
      .setDepth(DEPTH.creatures + 1);
    look.badge.setVisible(false);
    if (t >= 1 && !fall.poofed) {
      fall.poofed = true;
      this.sparks?.burst(x, y, { colour: 0xffffff, count: 18, speed: 160, size: 14, shape: 'dot', life: 700, gravity: -40 });
      this.sparks?.ring(x, y, 0xffffff, 60, 400);
    }
  }

  private drawFlashes(state: ArenaState, now: number): void {
    const g = this.g;
    if (!g) return;
    this.flashes = this.flashes.filter((flash) => now - flash.born < 200);
    for (const flash of this.flashes) {
      const caster = flash.side === 0 ? you(state) : state.wild;
      const at = toScreen(this.fit, caster.x, caster.y - ARENA.body * 0.9);
      drawCone(g.over, at, flash.angle, flash.length * this.fit.s, flash.half, 1 - (now - flash.born) / 200);
    }
  }

  private drawHearts(now: number, dt: number): void {
    const g = this.g;
    if (!g) return;
    this.hearts = this.hearts.filter((heart) => now - heart.born < heart.life);
    for (const heart of this.hearts) {
      heart.x += (heart.vx * dt) / 1000;
      heart.y += (heart.vy * dt) / 1000;
      heart.vy += (60 * dt) / 1000;
      drawHeart(g.bars, heart.x, heart.y, heart.size * (1 - (now - heart.born) / heart.life / 2), 0xff6b9a);
    }
  }

  private drawPopups(now: number): void {
    this.popups = this.popups.filter((popup) => {
      const age = (now - popup.born) / 850;
      if (age >= 1) {
        popup.text.destroy();
        return false;
      }
      popup.text.setPosition(popup.x, popup.y - age * 46).setAlpha(age < 0.7 ? 1 : (1 - age) / 0.3);
      return true;
    });
  }

  private popup(words: string, at: { x: number; y: number }, colour: string, px: number, now: number): void {
    const text = this.add
      .text(at.x, at.y, words, { fontFamily: FONT, fontSize: `${px}px`, fontStyle: '900', color: colour, stroke: '#102a43', strokeThickness: Math.max(4, Math.round(px * 0.2)) })
      .setOrigin(0.5)
      .setDepth(DEPTH.popups);
    this.popups.push({ text, born: now, x: at.x, y: at.y });
  }

  /** Hit-stop length in milliseconds for this tick's events, after starting their effects. */
  react(state: ArenaState, events: readonly ArenaEvent[], now: number): number {
    let stop = 0;
    const motion = !reducedMotion();
    for (const event of events) stop = Math.max(stop, this.reactTo(state, event, now, motion));
    return stop;
  }

  private screenOf(state: ArenaState, side: Side): { x: number; y: number; size: number; fighter: Fighter } {
    const fighter = side === 0 ? you(state) : state.wild;
    const at = toScreen(this.fit, fighter.x, fighter.y);
    const size = ARENA.body * CREATURE_SIZE * this.fit.s;
    return { x: at.x, y: at.y - size * 0.45, size, fighter };
  }

  private kick(fighter: Fighter, amount: number): void {
    const look = this.looks.get(fighter);
    if (look) look.squash.velocity += amount;
  }

  private reactTo(state: ArenaState, event: ArenaEvent, now: number, motion: boolean): number {
    const sparks = this.sparks;
    if (!sparks) return 0;
    switch (event.kind) {
      case 'hit': {
        const target = this.screenOf(state, event.side);
        const attacker = event.side === 0 ? state.wild : you(state);
        const colour = typeColour(attacker.creature.type);
        const strong = event.effectiveness === 'strong';
        const big = event.knock > 700 || event.source === 'lunge' || event.source === 'wall' || event.source === 'freeze';
        sparks.burst(target.x, target.y, { colour, count: big ? 22 : 12, speed: big ? 420 : 280, size: big ? 9 : 7, shape: 'square', life: 520, gravity: 500 });
        sparks.burst(target.x, target.y, { colour: 0xffffff, count: 6, speed: 300, size: 6, shape: 'line', life: 260, gravity: 0 });
        const jitter = (Math.random() - 0.5) * target.size * 0.6;
        const px = Math.round(Math.max(18, target.size * (strong ? 0.42 : event.effectiveness === 'weak' ? 0.26 : 0.34)));
        this.popup(`${event.damage}${strong ? '!' : ''}`, { x: target.x + target.size * 0.55 + jitter, y: target.y - target.size * 0.2 }, strong ? '#ffd43b' : event.effectiveness === 'weak' ? '#ced4da' : '#ffffff', px, now);
        const look = this.looks.get(target.fighter);
        if (look) look.flashUntil = now + 90;
        this.kick(target.fighter, big ? 9 : 5);
        if (motion) this.shake = { at: now, ms: big ? 260 : 150, px: Math.min(14, 3 + event.knock / 120) };
        return event.source === 'zone' ? 0 : big ? 110 : 55;
      }
      case 'heal': {
        const target = this.screenOf(state, event.side);
        this.popup(`+${event.amount}`, { x: target.x - target.size * 0.5, y: target.y - target.size * 0.2 }, '#8ce99a', Math.round(Math.max(16, target.size * 0.3)), now);
        sparks.burst(target.x, target.y, { colour: 0x8ce99a, count: 5, speed: 90, size: 6, shape: 'dot', life: 500, gravity: -120 });
        return 0;
      }
      case 'block': {
        const target = this.screenOf(state, event.side);
        sparks.ring(target.x, target.y, 0xfcc419, target.size * 1.4, 380);
        sparks.burst(target.x, target.y, { colour: 0xfff3bf, count: 14, speed: 320, size: 7, shape: 'square', life: 420, gravity: 0 });
        return 60;
      }
      case 'cast': {
        const caster = this.screenOf(state, event.side);
        this.kick(caster.fighter, -4);
        const ability = caster.fighter.kit[event.slot];
        if (event.ability === 'cone' && ability) {
          const aim = aimOf(state, caster.fighter, ability);
          this.flashes.push({ kind: 'cone', side: event.side, born: now, angle: Math.atan2(aim.y, aim.x), length: ability.radius + ARENA.body, half: ability.reach });
        }
        if (event.ability === 'freeze' || event.ability === 'zone' || event.ability === 'wall') sparks.ring(caster.x, caster.y, typeColour(caster.fighter.creature.type), caster.size * 1.6, 420);
        return 0;
      }
      case 'dash': {
        const caster = this.screenOf(state, event.side);
        this.kick(caster.fighter, -7);
        sparks.burst(caster.x, caster.y + caster.size * 0.4, { colour: 0xe9ecef, count: 10, speed: 160, size: 10, shape: 'dot', life: 420, gravity: -40 });
        return 0;
      }
      case 'bump': {
        const at = toScreen(this.fit, event.x, event.y);
        sparks.burst(at.x, at.y, { colour: 0xffd43b, count: 14, speed: 340, size: 7, shape: 'square', life: 420, gravity: 300 });
        if (motion) this.shake = { at: now, ms: 200, px: 8 };
        return 70;
      }
      case 'fall':
        if (motion) this.shake = { at: now, ms: 300, px: 6 };
        return 0;
      case 'faint': {
        const target = this.screenOf(state, event.side);
        sparks.burst(target.x, target.y, { colour: 0xffd43b, count: 10, speed: 140, size: 9, shape: 'square', life: 900, gravity: -20 });
        return 160;
      }
      case 'befriend': {
        const target = this.screenOf(state, 1);
        for (let at = 0; at < 18; at += 1) this.hearts.push({ x: target.x, y: target.y, vx: (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 220, born: now + at * 40, life: 1400, size: target.size * (0.12 + Math.random() * 0.1) });
        sparks.ring(target.x, target.y, 0xff8fab, target.size * 2, 600);
        return 120;
      }
      case 'treat': {
        const at = toScreen(this.fit, state.treat.x, state.treat.y);
        if (event.what !== 'throw') sparks.burst(at.x, at.y, { colour: event.what === 'pick' ? 0xff8fab : 0xffffff, count: 8, speed: 120, size: 7, shape: 'dot', life: 420, gravity: -60 });
        return 0;
      }
      case 'storm': {
        if (event.what === 'shrink') {
          for (let at = 0; at < 28; at += 1) {
            const a = (at / 28) * Math.PI * 2;
            const point = toScreen(this.fit, Math.cos(a) * state.storm.radius, Math.sin(a) * state.storm.radius);
            sparks.burst(point.x, point.y, { colour: at % 2 ? 0x8a6a55 : 0x5d4537, count: 2, speed: 120, size: 8, shape: 'square', life: 700, gravity: 500 });
          }
          if (motion) this.shake = { at: now, ms: 350, px: 5 };
        }
        return 0;
      }
      case 'swap': {
        const caster = this.screenOf(state, 0);
        sparks.burst(caster.x, caster.y, { colour: 0xffffff, count: 16, speed: 200, size: 12, shape: 'dot', life: 500, gravity: -40 });
        this.kick(caster.fighter, 10);
        return 0;
      }
      case 'root': {
        const target = this.screenOf(state, event.side);
        sparks.burst(target.x, target.y, { colour: 0xe3fafc, count: 16, speed: 260, size: 8, shape: 'square', life: 520, gravity: 200 });
        return 90;
      }
      case 'windup':
        this.kick(this.screenOf(state, event.side).fighter, 6);
        return 0;
    }
    return 0;
  }

  /** The current fit and state, for tests and tools. */
  snapshot(): { fit: Fit; state: ArenaState | null } {
    return { fit: this.fit, state: this.stateRef };
  }
}
