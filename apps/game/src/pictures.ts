import { KIND_PICTURES, SHAPE_PICTURES, frameNames, isPngSprite, spriteFor, tintSprite, type PictureId } from '@nebotok/core';
import { CONTENT, moveType } from './battle-content.ts';
import { element, icon, pictureButton } from './dom.ts';
import { moveArena } from './move-arena.ts';
import { spriteCanvas } from './skill-games/mini-game.ts';
import { paintDrawnFrame, sprite } from './sprites.ts';

/**
 * Pictures for HTML screens, so a player who cannot read yet still sees what each thing means:
 * the picture kit (`content/art/pictures/`), the weather icons and each move's button picture. Each is a canvas painted from
 * the sprite's first frame and scaled up with sharp pixels.
 */

export type PictureOptions = {
  /** Names the picture for screen readers. Without it the picture is hidden from them, since the control or text beside it says the same. */
  readonly label?: string;
  /** Flips it left to right, as the arrow does to point left. */
  readonly mirrored?: boolean;
  /** More classes, for a screen's own styling. */
  readonly className?: string;
  /** The frame to show, such as a courier's `right-step-a`; the sprite's first frame without it. */
  readonly frame?: string;
};

/** A 16×16 sprite as a canvas `sizePx` CSS pixels square. Whole multiples of 16 keep every pixel the same size. */
export function spriteIcon(id: string, sizePx: number, options: PictureOptions = {}): HTMLCanvasElement {
  const canvas = spriteCanvas(id, options.frame ?? null, ['picture', options.mirrored ? 'mirrored' : '', options.className ?? ''].filter(Boolean).join(' '));
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  canvas.dataset.picture = id;
  if (options.label !== undefined) {
    canvas.removeAttribute('aria-hidden');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', options.label);
  }
  return canvas;
}

/** A picture of the kit, such as `pictureIcon('check', 32)` or `pictureIcon('arrow', 48, { mirrored: true })` for back. */
export function pictureIcon(id: PictureId, sizePx: number, options: PictureOptions = {}): HTMLCanvasElement {
  return spriteIcon(spriteFor.picture(id), sizePx, options);
}

/** A weather type's icon, `weather/<type>` in content/art/. */
export function weatherIcon(type: string, sizePx: number, options: PictureOptions = {}): HTMLCanvasElement {
  return spriteIcon(spriteFor.weatherIcon(type), sizePx, options);
}

/** A shape picture painted in the colours of the weather type `type`, or as drawn when the type has none. */
function tintedShape(id: PictureId, type: string | null, sizePx: number): HTMLCanvasElement {
  const drawn = sprite(spriteFor.picture(id));
  const colours = type === null ? undefined : CONTENT.weather.get(type)?.colours;
  if (isPngSprite(drawn) || !colours) return pictureIcon(id, sizePx);
  const canvas = document.createElement('canvas');
  canvas.className = 'picture';
  canvas.setAttribute('aria-hidden', 'true');
  paintDrawnFrame(canvas, tintSprite(drawn, colours), frameNames(drawn)[0] ?? '');
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  canvas.dataset.picture = spriteFor.picture(id);
  return canvas;
}

/**
 * A move's button picture: its arena shape in its type's colours, with its kind's mark in the
 * corner at half the size. A move the arena does not know shows its type's weather icon.
 */
export function abilityIcon(moveId: string, sizePx: number, options: Pick<PictureOptions, 'label' | 'className'> = {}): HTMLSpanElement {
  const arena = moveArena(moveId);
  const type = moveType(moveId);
  const holder = document.createElement('span');
  holder.className = ['ability-icon', options.className ?? ''].filter(Boolean).join(' ');
  holder.style.width = `${sizePx}px`;
  holder.style.height = `${sizePx}px`;
  holder.dataset.move = moveId;
  if (arena) {
    holder.dataset.shape = arena.shape;
    holder.dataset.kind = arena.kind;
    holder.append(tintedShape(SHAPE_PICTURES[arena.shape], type, sizePx), pictureIcon(KIND_PICTURES[arena.kind], sizePx / 2, { className: 'ability-kind' }));
  } else if (type !== null) holder.append(weatherIcon(type, sizePx));
  if (options.label === undefined) holder.setAttribute('aria-hidden', 'true');
  else {
    holder.setAttribute('role', 'img');
    holder.setAttribute('aria-label', options.label);
  }
  return holder;
}

/** The shrine as the map draws it, where a team wakes and creatures wait. */
export function shrineIcon(sizePx: number, options: PictureOptions = {}): HTMLCanvasElement {
  return spriteIcon('tiles/shrine', sizePx, options);
}

/** The face on the world's team button (index.html), so what that button opens shows the same picture. */
export function teamIcon(sizePx: number): SVGSVGElement {
  const face = icon(element<SVGPathElement>('.team-button path').getAttribute('d') ?? '');
  face.classList.add('picture');
  face.style.width = `${sizePx}px`;
  face.style.height = `${sizePx}px`;
  face.dataset.picture = 'team-button';
  return face;
}

/** Close on a screen: a cross before the word. */
export function closeButton(className: string, label: string, onTap: () => void): HTMLButtonElement {
  return pictureButton(className, pictureIcon('cross', 32), label, onTap);
}
