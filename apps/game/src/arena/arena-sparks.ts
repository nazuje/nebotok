import { drawHeart } from './arena-paint.ts';
import type { Pen } from './arena-pen.ts';

/**
 * Short-lived bits a hit, a dash or a fall flings about, in screen pixels, moved and drawn by hand
 * each frame through a `Pen`. Ported from the battle-feel prototype's sparks. Nothing makes any
 * under reduced motion: the scene does not call them then.
 */

export type SparkShape = 'dot' | 'square' | 'line' | 'ring' | 'heart';
type Spark = { x: number; y: number; vx: number; vy: number; life: number; readonly max: number; readonly size: number; readonly colour: number; readonly shape: SparkShape; readonly gravity: number; wait: number };

export type BurstOptions = { readonly colour: number; readonly count: number; readonly speed: number; readonly size: number; readonly shape: SparkShape; readonly life?: number; readonly gravity?: number };

/** At most this many at once, so a busy fight cannot pile them up. */
const MOST = 600;

export class Sparks {
  private list: Spark[] = [];
  /** How many were ever made, for the test hook. */
  made = 0;

  /** `count` bits flying out from (x, y) at up to `speed` pixels a second. */
  burst(x: number, y: number, options: BurstOptions): void {
    for (let at = 0; at < options.count; at += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = options.speed * (0.35 + Math.random() * 0.65);
      this.add({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: (options.life ?? 450) * (0.6 + Math.random() * 0.4), size: options.size * (0.6 + Math.random() * 0.6), colour: options.colour, shape: options.shape, gravity: options.gravity ?? 300 });
    }
  }

  /** One ring growing out of (x, y) to `size`. */
  ring(x: number, y: number, colour: number, size: number, life = 320): void {
    this.add({ x, y, vx: 0, vy: 0, life, size, colour, shape: 'ring', gravity: 0 });
  }

  /** Hearts rising from (x, y) one after another, for a befriending. */
  hearts(x: number, y: number, size: number, count = 18): void {
    for (let at = 0; at < count; at += 1) {
      this.add({ x, y, vx: (Math.random() - 0.5) * 260, vy: -120 - Math.random() * 220, life: 1_400, size: size * (0.6 + Math.random() * 0.5), colour: 0xff6b9a, shape: 'heart', gravity: 60, wait: at * 40 });
    }
  }

  /** A puff of smoke behind a dashing or lunging creature, drifting against its motion. */
  smoke(x: number, y: number, size: number, vx: number, vy: number): void {
    const life = 380 + Math.random() * 200;
    this.add({ x: x + (Math.random() - 0.5) * size * 0.4, y: y - Math.random() * size * 0.3, vx: -vx * 0.06 + (Math.random() - 0.5) * 40, vy: -vy * 0.06 - 20, life, size: size * (0.12 + Math.random() * 0.1), colour: Math.random() < 0.7 ? 0xf1f3f5 : 0xced4da, shape: 'dot', gravity: -30 });
  }

  private add(spark: Omit<Spark, 'max' | 'wait'> & { wait?: number }): void {
    if (this.list.length >= MOST) return;
    this.list.push({ ...spark, max: spark.life, wait: spark.wait ?? 0 });
    this.made += 1;
  }

  /** How many are flying now. */
  count(): number {
    return this.list.length;
  }

  clear(): void {
    this.list = [];
  }

  /** Moves every bit on by `ms`; a hit-stop passes 0, which holds them still. */
  update(ms: number): void {
    const seconds = ms / 1000;
    for (const spark of this.list) {
      if (spark.wait > 0) {
        spark.wait -= ms;
        continue;
      }
      spark.vy += spark.gravity * seconds;
      spark.x += spark.vx * seconds;
      spark.y += spark.vy * seconds;
      spark.life -= ms;
    }
    this.list = this.list.filter((spark) => spark.life > 0);
  }

  draw(pen: Pen): void {
    for (const spark of this.list) {
      if (spark.wait > 0) continue;
      const left = spark.life / spark.max;
      const s = spark.size;
      if (spark.shape === 'ring') {
        pen.lineStyle(Math.max(2, s * 0.08 * left), spark.colour, left);
        pen.strokeCircle(spark.x, spark.y, s * (1.2 - left));
      } else if (spark.shape === 'heart') drawHeart(pen, spark.x, spark.y, s * (0.5 + left * 0.5), spark.colour);
      else if (spark.shape === 'line') {
        pen.lineStyle(Math.max(2, s * 0.25), spark.colour, left);
        pen.lineBetween(spark.x, spark.y, spark.x - spark.vx * 0.04, spark.y - spark.vy * 0.04);
      } else {
        pen.fillStyle(spark.colour, Math.min(1, left * 1.5));
        if (spark.shape === 'dot') pen.fillCircle(spark.x, spark.y, s * (0.5 + left * 0.5));
        else pen.fillRect(spark.x - s / 2, spark.y - s / 2, s, s);
      }
    }
  }
}
