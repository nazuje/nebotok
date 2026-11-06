import { frameNames } from '@nebotok/core';
import { Scene, Scenes, type GameObjects } from 'phaser';
import { backdropPlacement, backdropSprite } from './battle-backdrop.ts';
import type { BattleScreenState } from './battle-model.ts';
import type { Effect } from './battle-playback.ts';
import { CREATURE_SIZE, creatureTexture } from './creature-art.ts';
import { sprite, spriteTexture } from './sprites.ts';

export const BATTLE_SCENE = 'battle';

/** The creatures' spots take their colours from the background's ground; these stand in when it has none there. */
const GROUND = 0x7cc35f;
const GROUND_EDGE = 0x4f8f3e;
/** How far up from a background's bottom row its ground colour is read, for the spots under the creatures. */
const GROUND_ROW_FROM_BOTTOM = 6;
const DEPTH = { under: 0, sky: 1, spots: 2, creatures: 3 } as const;
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

/** What the scene drew last frame, for the test hook: the battle, the species out on each side and the background sprite. */
export type BattleDrawn = { readonly battle: string; readonly creatures: readonly [string | null, string | null]; readonly sky: string };
type Ground = { readonly top: number; readonly edge: number };

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const rest = (): Fx => ({ dx: 0, dy: 0, alpha: 1 });

/**
 * The battle field, drawn over the world while a battle is on: the weather's background, your creature
 * from the back on the left and the wild one from the front on the right, moved by each step's
 * effect. Everything with words is HTML (src/battle-screen.ts).
 */
export class BattleScene extends Scene {
  private readonly options: BattleSceneOptions;
  /** The ground colour below the background, where the canvas is taller than the background reaches. */
  private under: GameObjects.Graphics | null = null;
  private sky: GameObjects.Image | null = null;
  /** The spots the creatures stand on. */
  private backdrop: GameObjects.Graphics | null = null;
  private readonly grounds = new Map<string, Ground>();
  private sprites: [GameObjects.Image | null, GameObjects.Image | null] = [null, null];
  private fx: [Fx, Fx] = [rest(), rest()];
  private lastStep: string | null = null;
  private lastDrawn: BattleDrawn | null = null;

  constructor(options: BattleSceneOptions) {
    super({ key: BATTLE_SCENE, active: false });
    this.options = options;
  }

  create(): void {
    this.under = this.add.graphics().setDepth(DEPTH.under);
    this.sky = null;
    this.backdrop = this.add.graphics().setDepth(DEPTH.spots);
    this.sprites = [null, null];
    this.fx = [rest(), rest()];
    this.lastStep = null;
    this.lastDrawn = null;
    this.events.once(Scenes.Events.SHUTDOWN, () => {
      this.tweens.killAll();
      this.under = null;
      this.sky = null;
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
    const sky = this.drawBackdrop(state.shown.weather, field, spots, size);
    if (state.step && state.step.key !== this.lastStep) this.play(state.step.effect, state);
    this.lastStep = state.step?.key ?? null;
    const creatures: [string | null, string | null] = [null, null];
    for (const side of [0, 1] as const) creatures[side] = this.drawCreature(state, side, spots[side], scale);
    this.lastDrawn = { battle: state.view.id, creatures, sky };
  }

  /** The page's field box in game pixels, or the whole game when the page has none. */
  private fieldRect(): Rect {
    const box = this.options.field();
    const canvas = this.game.canvas.getBoundingClientRect();
    const px = canvas.width / this.scale.width;
    if (!box || box.width === 0 || px === 0) return { x: 0, y: 0, width: this.scale.width, height: this.scale.height };
    return { x: (box.left - canvas.left) / px, y: (box.top - canvas.top) / px, width: box.width / px, height: box.height / px };
  }

/** The colours of a background's ground, read once from its pixels: the ground itself, and its darkest bottom row. */
  private groundOf(id: string, key: string, frame: string, height: number): Ground {
    const known = this.grounds.get(id);
    if (known) return known;
    const read = (y: number, fallback: number) => this.textures.getPixel(0, y, key, frame)?.color ?? fallback;
    const ground = { top: read(height - GROUND_ROW_FROM_BOTTOM, GROUND), edge: read(height - 1, GROUND_EDGE) };
    this.grounds.set(id, ground);
    return ground;
  }

  /** Draws the weather's background behind the field and the spots the creatures stand on. Returns the background's sprite id. */
  private drawBackdrop(weather: string | null, field: Rect, spots: readonly { x: number; y: number }[], size: number): string {
    const id = backdropSprite(weather);
    const art = sprite(id);
    const key = spriteTexture(this, id);
    const frame = frameNames(art)[0] ?? '';
    if (!this.sky || this.sky.texture.key !== key) {
      this.sky?.destroy();
      this.sky = this.add.image(0, 0, key, frame).setOrigin(0, 0).setDepth(DEPTH.sky);
    }
    const place = backdropPlacement(art, this.scale, field.y + field.height);
    this.sky.setPosition(place.x, place.y).setScale(place.scale);
    const ground = this.groundOf(id, key, frame, art.height);
    this.under?.clear().fillStyle(ground.edge, 1).fillRect(0, 0, this.scale.width, this.scale.height);
    const backdrop = this.backdrop;
    if (!backdrop) return id;
    backdrop.clear();
    for (const spot of spots) {
      const feet = spot.y + size / 2 - size * 0.08;
      backdrop.fillStyle(ground.edge, 1);
      backdrop.fillEllipse(spot.x, feet + size * 0.04, size * 1.5, size * 0.38);
      backdrop.fillStyle(ground.top, 1);
      backdrop.fillEllipse(spot.x, feet, size * 1.5, size * 0.32);
    }
    return id;
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
    let image = current;
    if (!image || image.texture.key !== texture.key || image.frame.name !== texture.frame) {
      image?.destroy();
      image = this.add.image(0, 0, texture.key, texture.frame).setDepth(DEPTH.creatures);
      this.sprites[side] = image;
    }
    const fx = this.fx[side];
    const fainted = (state.shown.hp[id] ?? creature.hp) === 0;
    image
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
