import type { GameObjects } from 'phaser';

/** Short-lived bits flung about by hits and trails. Moved and drawn by hand each frame. */
export type SparkShape = 'dot' | 'square' | 'petal' | 'line' | 'ring';
export type Spark = { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; colour: number; shape: SparkShape; gravity: number };

export class Sparks {
  private list: Spark[] = [];
  private readonly g: GameObjects.Graphics;

  constructor(g: GameObjects.Graphics) {
    this.g = g;
  }

  add(spark: Spark): void {
    if (this.list.length < 600) this.list.push(spark);
  }

  /** `count` bits flying out from (x, y) at up to `speed` pixels a second. */
  burst(x: number, y: number, options: { colour: number; count: number; speed: number; size: number; shape: SparkShape; life?: number; gravity?: number }): void {
    for (let at = 0; at < options.count; at += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = options.speed * (0.35 + Math.random() * 0.65);
      const life = (options.life ?? 450) * (0.6 + Math.random() * 0.4);
      this.add({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life, max: life, size: options.size * (0.6 + Math.random() * 0.6), colour: options.colour, shape: options.shape, gravity: options.gravity ?? 300 });
    }
  }

  /** One expanding ring. */
  ring(x: number, y: number, colour: number, size: number, life = 320): void {
    this.add({ x, y, vx: 0, vy: 0, life, max: life, size, colour, shape: 'ring', gravity: 0 });
  }

  update(dt: number): void {
    const seconds = dt / 1000;
    for (const spark of this.list) {
      spark.vy += spark.gravity * seconds;
      spark.x += spark.vx * seconds;
      spark.y += spark.vy * seconds;
      spark.life -= dt;
    }
    this.list = this.list.filter((spark) => spark.life > 0);
  }

  draw(): void {
    const g = this.g;
    g.clear();
    for (const spark of this.list) {
      const left = spark.life / spark.max;
      const s = spark.size;
      if (spark.shape === 'ring') {
        g.lineStyle(Math.max(2, s * 0.08 * left), spark.colour, left);
        g.strokeCircle(spark.x, spark.y, s * (1.2 - left));
        continue;
      }
      g.fillStyle(spark.colour, Math.min(1, left * 1.5));
      if (spark.shape === 'dot') g.fillCircle(spark.x, spark.y, s * (0.5 + left * 0.5));
      else if (spark.shape === 'square') g.fillRect(spark.x - s / 2, spark.y - s / 2, s, s);
      else if (spark.shape === 'petal') g.fillEllipse(spark.x, spark.y, s * 1.6, s * (0.6 + 0.4 * Math.abs(Math.sin(spark.life / 80))));
      else {
        g.lineStyle(Math.max(2, s * 0.25), spark.colour, left);
        g.lineBetween(spark.x, spark.y, spark.x - spark.vx * 0.04, spark.y - spark.vy * 0.04);
      }
    }
  }
}
