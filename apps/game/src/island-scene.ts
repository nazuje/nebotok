import { Scale, Scene } from 'phaser';
import { COURIER, ISLAND, ISLAND_TILE_KEYS, TILES, checkArt, type PixelArt } from './art.ts';
import { TILE } from './zoom.ts';

export const ISLAND_SCENE = 'island';

function paint(scene: Scene, key: string, art: PixelArt): void {
  checkArt(key, art, TILE);
  const graphics = scene.make.graphics({}, false);
  art.rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      const colour = art.palette[letter];
      if (colour === undefined) return;
      graphics.fillStyle(colour, 1);
      graphics.fillRect(x, y, 1, 1);
    });
  });
  graphics.generateTexture(key, TILE, TILE);
  graphics.destroy();
}

/** Phase 0's only scene: a small floating island and the courier, no gameplay yet. */
export class IslandScene extends Scene {
  /** True once create() has drawn the island. */
  drawn = false;

  constructor() {
    super(ISLAND_SCENE);
  }

  create(): void {
    for (const [key, art] of Object.entries(TILES)) paint(this, key, art);
    paint(this, 'courier', COURIER);

    const width = (ISLAND[0]?.length ?? 0) * TILE;
    const height = ISLAND.length * TILE;
    const clouds = [
      { x: -3, y: -2, speed: 9 },
      { x: width + 2, y: height * 0.35, speed: -6 },
      { x: width * 0.3, y: height + 10, speed: 5 },
    ];
    for (const { x, y, speed } of clouds) {
      const cloud = this.add.image(x, y, 'cloud').setScale(2).setAlpha(0.9);
      this.tweens.add({ targets: cloud, x: x + speed * 4, duration: 4_000, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    ISLAND.forEach((row, y) => {
      [...row].forEach((letter, x) => {
        const key = ISLAND_TILE_KEYS[letter];
        if (key) this.add.image(x * TILE, y * TILE, key).setOrigin(0);
      });
    });

    const courier = this.add.image(width / 2, TILE * 3.5, 'courier');
    this.tweens.add({ targets: courier, y: courier.y - 1, duration: 600, yoyo: true, repeat: -1, ease: 'Stepped' });

    this.cameras.main.setBackgroundColor('#8fd3ff');
    this.cameras.main.centerOn(width / 2, height / 2);
    this.scale.on(Scale.Events.RESIZE, () => this.cameras.main.centerOn(width / 2, height / 2));
    this.drawn = true;
  }
}
