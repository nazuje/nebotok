import type { GameObjects, Scene } from 'phaser';
import { drawCloud, lerpColour, strokeLine } from './prototype-shapes.ts';

/**
 * The open sky behind the prototype's battles, painted by the battlefield weather: a banded
 * gradient, drifting clouds, and each weather's moving layer (sun rays, wind lines, rain streaks,
 * snowflakes, lightning, petals).
 */

type Look = { readonly top: number; readonly bottom: number; readonly cloud: number; readonly cloudAlpha: number };

const LOOKS: Readonly<Record<string, Look>> = {
  clear: { top: 0x5ab8f5, bottom: 0xcdeeff, cloud: 0xffffff, cloudAlpha: 0.95 },
  sun: { top: 0x3fa9f5, bottom: 0xffe39a, cloud: 0xffffff, cloudAlpha: 0.9 },
  rain: { top: 0x4a5f73, bottom: 0x93a8ba, cloud: 0xaebbc7, cloudAlpha: 0.95 },
  storm: { top: 0x15122b, bottom: 0x473f6e, cloud: 0x2a2645, cloudAlpha: 0.95 },
  frost: { top: 0x8fcbe8, bottom: 0xf1fbff, cloud: 0xffffff, cloudAlpha: 0.95 },
  gale: { top: 0x5fb3cc, bottom: 0xd3f2ea, cloud: 0xf3fbfb, cloudAlpha: 0.8 },
  bloom: { top: 0xf7a1cf, bottom: 0xfff0f6, cloud: 0xffffff, cloudAlpha: 0.9 },
};

const BANDS = 18;
const COUNT: Readonly<Record<string, number>> = { rain: 80, storm: 55, frost: 50, gale: 16, bloom: 28 };

type Cloud = { x: number; y: number; width: number; speed: number };
type Bit = { x: number; y: number; vx: number; vy: number; size: number; phase: number };
type Bolt = { points: { x: number; y: number }[]; until: number };

const lookOf = (weather: string | null): Look => LOOKS[weather ?? 'clear'] ?? (LOOKS.clear as Look);

export class Sky {
  private readonly back: GameObjects.Graphics;
  private readonly cloudLayer: GameObjects.Graphics;
  private readonly bitLayer: GameObjects.Graphics;
  private readonly flash: GameObjects.Rectangle;
  private weather: string | null = null;
  private painted = '';
  private clouds: Cloud[] = [];
  private bits: Bit[] = [];
  private bolt: Bolt | null = null;
  private nextBolt = 0;
  private width = 0;
  private height = 0;

  constructor(scene: Scene) {
    this.back = scene.add.graphics().setDepth(0);
    this.cloudLayer = scene.add.graphics().setDepth(1);
    this.bitLayer = scene.add.graphics().setDepth(2);
    this.flash = scene.add.rectangle(0, 0, 10, 10, 0xffffff, 1).setOrigin(0, 0).setDepth(20).setAlpha(0);
  }

  setWeather(weather: string | null): void {
    if (weather === this.weather) return;
    this.weather = weather;
    this.bits = [];
    this.bolt = null;
  }

  /** A bright flash over everything, fading out. */
  flashOnce(colour: number, alpha: number): void {
    this.flash.setFillStyle(colour, 1).setAlpha(alpha);
  }

  update(now: number, dt: number, width: number, height: number, frozen: boolean): void {
    this.width = width;
    this.height = height;
    this.paintBack();
    this.flash.setSize(width, height);
    this.flash.setAlpha(Math.max(0, this.flash.alpha - dt * 0.004));
    if (!frozen) this.move(now, dt);
    this.drawClouds();
    this.drawBits(now);
  }

  private paintBack(): void {
    const key = `${this.weather}:${this.width}x${this.height}`;
    if (key === this.painted) return;
    this.painted = key;
    const look = lookOf(this.weather);
    const band = Math.ceil(this.height / BANDS);
    this.back.clear();
    for (let at = 0; at < BANDS; at += 1) {
      this.back.fillStyle(lerpColour(look.top, look.bottom, at / (BANDS - 1)), 1);
      this.back.fillRect(0, at * band, this.width, band + 1);
    }
    if (this.clouds.length === 0) {
      this.clouds = Array.from({ length: 7 }, (_, at) => ({
        x: Math.random() * this.width,
        y: this.height * (0.08 + 0.12 * at),
        width: 60 + Math.random() * 120,
        speed: 6 + Math.random() * 14,
      }));
    }
  }

  private spawn(fresh: boolean): Bit {
    const w = this.width;
    const h = this.height;
    const x = Math.random() * w;
    const y = fresh ? Math.random() * h : -20;
    switch (this.weather) {
      case 'rain':
      case 'storm':
        return { x: x + w * 0.2, y, vx: -140, vy: 760 + Math.random() * 240, size: 1, phase: 0 };
      case 'frost':
        return { x, y, vx: -10, vy: 30 + Math.random() * 40, size: 2 + Math.random() * 3, phase: Math.random() * 6 };
      case 'gale':
        return { x: fresh ? x : -120, y: Math.random() * h, vx: 520 + Math.random() * 380, vy: 0, size: 40 + Math.random() * 70, phase: Math.random() * 6 };
      default:
        return { x: fresh ? x : -20, y: fresh ? y : Math.random() * h * 0.7, vx: 50 + Math.random() * 50, vy: 30 + Math.random() * 40, size: 3 + Math.random() * 3, phase: Math.random() * 6 };
    }
  }

  private move(now: number, dt: number): void {
    const seconds = dt / 1000;
    for (const cloud of this.clouds) {
      cloud.x += cloud.speed * seconds * (this.weather === 'gale' ? 6 : 1);
      if (cloud.x - cloud.width > this.width) cloud.x = -cloud.width;
    }
    const wanted = COUNT[this.weather ?? ''] ?? 0;
    const filling = this.bits.length === 0;
    while (this.bits.length < wanted) this.bits.push(this.spawn(filling));
    this.bits = this.bits.map((bit) => {
      const moved = { ...bit, x: bit.x + bit.vx * seconds, y: bit.y + bit.vy * seconds };
      return moved.y > this.height + 20 || moved.x > this.width + 160 || moved.x < -200 ? this.spawn(false) : moved;
    });
    if (this.weather === 'storm' && now > this.nextBolt) {
      this.nextBolt = now + 1600 + Math.random() * 2600;
      const points = [{ x: this.width * (0.1 + Math.random() * 0.8), y: 0 }];
      for (let at = 1; at <= 6; at += 1) points.push({ x: (points[at - 1]?.x ?? 0) + (Math.random() - 0.5) * 50, y: (this.height * 0.45 * at) / 6 });
      this.bolt = { points, until: now + 150 };
      this.flashOnce(0xffffff, 0.45);
    }
  }

  private drawClouds(): void {
    const look = lookOf(this.weather);
    this.cloudLayer.clear();
    for (const cloud of this.clouds) drawCloud(this.cloudLayer, cloud.x, cloud.y, cloud.width, look.cloud, look.cloudAlpha * 0.5);
  }

  private drawBits(now: number): void {
    const g = this.bitLayer;
    g.clear();
    if (this.weather === 'sun') this.drawSun(now);
    for (const bit of this.bits) {
      const sway = Math.sin(bit.phase + now / 500);
      switch (this.weather) {
        case 'rain':
        case 'storm':
          g.lineStyle(2, 0xd0e4ff, 0.55);
          g.lineBetween(bit.x, bit.y, bit.x + bit.vx * 0.025, bit.y + bit.vy * 0.025);
          break;
        case 'frost':
          g.fillStyle(0xffffff, 0.9);
          g.fillRect(bit.x + sway * 8, bit.y, bit.size, bit.size);
          break;
        case 'gale':
          g.lineStyle(3, 0xffffff, 0.55);
          g.lineBetween(bit.x, bit.y + sway * 4, bit.x + bit.size * 0.5, bit.y);
          g.lineBetween(bit.x + bit.size * 0.5, bit.y, bit.x + bit.size, bit.y - sway * 4);
          break;
        default:
          g.fillStyle(0xff8cc6, 0.95);
          g.fillEllipse(bit.x + sway * 10, bit.y, bit.size * 2, bit.size * (0.6 + 0.6 * Math.abs(sway)));
      }
    }
    if (this.bolt && now < this.bolt.until) {
      g.lineStyle(4, 0xfff9db, 1);
      strokeLine(g, this.bolt.points);
    }
  }

  private drawSun(now: number): void {
    const g = this.bitLayer;
    const x = this.width * 0.84;
    const y = this.height * 0.1;
    const reach = Math.max(this.width, this.height) * 0.9;
    g.fillStyle(0xfff3bf, 0.18);
    for (let at = 0; at < 9; at += 1) {
      const angle = now / 5000 + (at * Math.PI * 2) / 9;
      g.fillTriangle(x, y, x + Math.cos(angle - 0.07) * reach, y + Math.sin(angle - 0.07) * reach, x + Math.cos(angle + 0.07) * reach, y + Math.sin(angle + 0.07) * reach);
    }
    const r = Math.min(this.width, this.height) * 0.07;
    g.fillStyle(0xffe066, 0.5);
    g.fillCircle(x, y, r * 1.5);
    g.fillStyle(0xffd43b, 1);
    g.fillCircle(x, y, r);
    g.fillStyle(0xfff3bf, 1);
    g.fillCircle(x - r * 0.25, y - r * 0.25, r * 0.45);
  }
}
