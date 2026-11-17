import { spriteFor, type PictureId } from '@nebotok/core';
import { element, icon, pictureButton } from './dom.ts';
import { spriteCanvas } from './skill-games/mini-game.ts';

/**
 * Pictures for HTML screens, so a player who cannot read yet still sees what each thing means:
 * the picture kit (`content/art/pictures/`) and the weather icons. Each is a canvas painted from
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
