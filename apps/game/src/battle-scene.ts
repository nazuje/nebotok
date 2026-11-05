import { Scene, Scenes, type GameObjects } from 'phaser';
import type { BattleScreenState } from './battle-model.ts';
import type { Effect } from './battle-playback.ts';
import { CREATURE_SIZE, creatureTexture } from './creature-art.ts';

export const BATTLE_SCENE = 'battle';

/** The sky behind a battle, by battlefield weather. Stand-ins until the drawn backgrounds land. */
const SKIES: Readonly<Record<string, number>> = {
  sun: 0xffe39a,
  rain: 0x86aed0,
  frost: 0xd4eef7,
  bloom: 0xcdeeb4,
  gale: 0xdbe7f0,
  storm: 0x6f6a9e,
};
const CLEAR_SKY = 0x8fd3ff;
const GROUND = 0x7cc35f;
const GROUND_EDGE = 0x4f8f3e;
const FAINTED_ALPHA = 0.35;
const MAX_SCALE = 6;

type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
/** How far an effect has moved a creature from its spot, and how visible it is. Tweens change these. */
type Fx = { dx: number; dy: number; alpha: number };

export type BattleSceneOptions = {
  /** The battle to draw now, or null. */
  state(now: number): BattleScreenState | null;
  /** Where the page leaves room for the field, in CSS pixels. */
  field(): DOMRect | null;
};

/** What the scene drew last frame, for the test hook. */
export type BattleDrawn = { readonly battle: string; readonly creatures: readonly [string | null, string | null] };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rest = (): Fx => ({ dx: 0, dy: 0, alpha: 1 });

/**
 * The battle field, drawn over the world while a battle is on: the weather's sky, your creature
 * from the back on the left and the wild one from the front on the right, moved by each step's
 * effect. Everything with words is HTML (src/battle-screen.ts).
 */
export class BattleScene extends Scene {
  private readonly options: BattleSceneOptions;
  private backdrop: GameObjects.Graphics | null = null;
  private sprites: [GameObjects.Image | null, GameObjects.Image | null] = [null, null];
  private fx: [Fx, Fx] = [rest(), rest()];
  private lastStep: string | null = null;
  private lastDrawn: BattleDrawn | null = null;

  constructor(options: BattleSceneOptions) {
    super({ key: BATTLE_SCENE, active: false });
    this.options = options;
  }

  create(): void {
    this.backdrop = this.add.graphics();
    this.sprites = [null, null];
    this.fx = [rest(), rest()];
    this.lastStep = null;
    this.lastDrawn = null;
    this.events.once(Scenes.Events.SHUTDOWN, () => {
      this.tweens.killAll();
      this.backdrop = null;
      this.sprites = [null, null];
      this.lastDrawn = null;
    });
  }

  drawn(): BattleDrawn | null {
    return this.lastDrawn;
  }

  override update(): void {
    const state = this.options.state(performance.now());
    if (!state || !this.backdrop) return;
    const field = this.fieldRect();
    const scale = Math.max(1, Math.min(MAX_SCALE, Math.floor(Math.min(field.width * 0.42, field.height * 0.48) / CREATURE_SIZE)));
    const size = CREATURE_SIZE * scale;
    const spots = [
      { x: Math.round(field.x + field.width * 0.28), y: Math.round(field.y + field.height - size / 2 - 4 * scale) },
      { x: Math.round(field.x + field.width * 0.72), y: Math.round(field.y + size / 2 + 2 * scale) },
    ] as const;
    this.drawBackdrop(state.shown.weather, spots, size);
    if (state.step && state.step.key !== this.lastStep) this.play(state.step.effect, state);
    this.lastStep = state.step?.key ?? null;
    const creatures: [string | null, string | null] = [null, null];
    for (const side of [0, 1] as const) creatures[side] = this.drawCreature(state, side, spots[side], scale);
    this.lastDrawn = { battle: state.view.id, creatures };
  }

  /** The page's field box in game pixels, or the whole game when the page has none. */
  private fieldRect(): Rect {
    const box = this.options.field();
    const canvas = this.game.canvas.getBoundingClientRect();
    const px = canvas.width / this.scale.width;
    if (!box || box.width === 0 || px === 0) return { x: 0, y: 0, width: this.scale.width, height: this.scale.height };
    return { x: (box.left - canvas.left) / px, y: (box.top - canvas.top) / px, width: box.width / px, height: box.height / px };
  }

  private drawBackdrop(weather: string | null, spots: readonly { x: number; y: number }[], size: number): void {
    const backdrop = this.backdrop;
    if (!backdrop) return;
    backdrop.clear();
    backdrop.fillStyle((weather ? SKIES[weather] : undefined) ?? CLEAR_SKY, 1);
    backdrop.fillRect(0, 0, this.scale.width, this.scale.height);
    for (const spot of spots) {
      const feet = spot.y + size / 2 - size * 0.08;
      backdrop.fillStyle(GROUND_EDGE, 1);
      backdrop.fillEllipse(spot.x, feet + size * 0.04, size * 1.5, size * 0.38);
      backdrop.fillStyle(GROUND, 1);
      backdrop.fillEllipse(spot.x, feet, size * 1.5, size * 0.32);
    }
  }

  /** Draws the creature a side has out, and returns its species, or null when nobody is out. */
  private drawCreature(state: BattleScreenState, side: 0 | 1, spot: { x: number; y: number }, scale: number): string | null {
    const id = state.shown.active[side];
    const creatures = side === 0 ? state.view.team.creatures : state.view.opponent.creatures;
    const creature = creatures.find((candidate) => candidate.id === id);
    const current = this.sprites[side];
    if (!creature || !id) {
      current?.setVisible(false);
      return null;
    }
    const texture = creatureTexture(this, creature.species, side === 0 ? 'back' : 'front');
    let sprite = current;
    if (!sprite || sprite.texture.key !== texture) {
      sprite?.destroy();
      sprite = this.add.image(0, 0, texture);
      this.sprites[side] = sprite;
    }
    const fx = this.fx[side];
    const fainted = (state.shown.hp[id] ?? creature.hp) === 0;
    sprite
      .setVisible(true)
      .setScale(scale)
      .setPosition(spot.x + Math.round(fx.dx * scale), spot.y + Math.round((fx.dy + (fainted ? 3 : 0)) * scale))
      .setAlpha(fx.alpha * (fainted ? FAINTED_ALPHA : 1));
    return creature.species;
  }

  private sideOf(state: BattleScreenState, creature: string | null): 0 | 1 | null {
    if (creature === null) return null;
    if (state.shown.active[0] === creature) return 0;
    return state.shown.active[1] === creature ? 1 : null;
  }

  private tween(side: 0 | 1, to: Partial<Fx>, options: { duration: number; yoyo?: boolean; repeat?: number; from?: Partial<Fx> }): void {
    const fx = this.fx[side];
    this.tweens.killTweensOf(fx);
    Object.assign(fx, rest(), options.from ?? {});
    this.tweens.add({ targets: fx, ...to, duration: options.duration, yoyo: options.yoyo ?? false, repeat: options.repeat ?? 0, ease: 'Sine.easeInOut', onComplete: () => Object.assign(fx, rest()) });
  }

  /** Each step's effect, once, on the creature it names. With reduced motion nothing moves. */
  private play(effect: Effect | null, state: BattleScreenState): void {
    if (!effect || reducedMotion()) return;
    const side = effect.kind === 'ran' ? 0 : this.sideOf(state, effect.creature);
    if (effect.kind === 'weather') {
      this.cameras.main.flash(180, 255, 255, 255);
      return;
    }
    if (side === null) return;
    const away = side === 0 ? -1 : 1;
    switch (effect.kind) {
      case 'enter':
        return this.tween(side, { dx: 0, alpha: 1 }, { duration: 260, from: { dx: 24 * away, alpha: 0 } });
      case 'attack':
        return this.tween(side, { dx: -8 * away }, { duration: 110, yoyo: true });
      case 'hit':
        return this.tween(side, { alpha: 0.2, dx: 2 * away }, { duration: 70, yoyo: true, repeat: 1 });
      case 'miss':
        return this.tween(side, { dy: -6 }, { duration: 120, yoyo: true });
      case 'treat':
        return this.tween(side, { dy: -4 }, { duration: 110, yoyo: true, repeat: 1 });
      case 'ran':
        return this.tween(side, { dx: -40, alpha: 0 }, { duration: 260 });
      case 'faint':
        return this.tween(side, { dy: 6, alpha: 0.6 }, { duration: 300 });
      default:
        return undefined;
    }
  }
}
