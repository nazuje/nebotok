/*
 * THROWAWAY PROTOTYPE, never merged to main. It answers one question: what should Nebotok's battles
 * look and feel like so they are faster, prettier, readable without reading, and clearly not a copy
 * of another creature game? `?variant=0|1|2|3` picks a look; the same `seed` keeps the same pair of
 * creatures across variants.
 */

import { LANGUAGES, type Language } from '@nebotok/core';
import { el, icon } from '../dom.ts';
import { loadArtImages } from '../sprites.ts';
import { mountPlay } from './prototype-play.ts';
import { mountToday } from './prototype-today.ts';

const LABELS = ['0 Today', '1 Sky Duel', '2 Timed taps', '3 Wheel + cards'] as const;
const LEFT_PATH = 'M15.5 4l1.8 1.8l-6.2 6.2l6.2 6.2l-1.8 1.8l-8 -8z';
const RIGHT_PATH = 'M8.5 4l8 8l-8 8l-1.8 -1.8l6.2 -6.2l-6.2 -6.2z';

const params = new URLSearchParams(window.location.search);
const variant = Math.max(0, Math.min(LABELS.length - 1, Number.parseInt(params.get('variant') ?? '1', 10) || 0));
const seed = Number.parseInt(params.get('seed') ?? '', 10);
const asked = params.get('lang');
const language: Language = LANGUAGES.find((known) => known === asked) ?? 'en';

function go(changes: Readonly<Record<string, string>>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(changes)) url.searchParams.set(key, value);
  window.location.replace(url);
}

if (!Number.isSafeInteger(seed)) go({ seed: String(Math.floor(Math.random() * 1_000_000)) });
else {
  const switchTo = (next: number) => go({ variant: String((next + LABELS.length) % LABELS.length) });
  const newBattle = () => go({ seed: String(Math.floor(Math.random() * 1_000_000)) });
  const back = el('button', { className: 'proto-round', attrs: { type: 'button', 'aria-label': 'Previous look' } }, [icon(LEFT_PATH)]);
  const next = el('button', { className: 'proto-round', attrs: { type: 'button', 'aria-label': 'Next look' } }, [icon(RIGHT_PATH)]);
  back.addEventListener('click', () => switchTo(variant - 1));
  next.addEventListener('click', () => switchTo(variant + 1));
  const pill = el('nav', { className: 'proto-pill', attrs: { 'aria-label': 'Battle looks' } }, [back, el('span', { className: 'proto-pill-label', text: LABELS[variant] ?? '' }), next]);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') switchTo(variant - 1);
    if (event.key === 'ArrowRight') switchTo(variant + 1);
  });
  const root = el('main', { className: 'proto-root' });
  document.body.dataset.variant = String(variant);
  document.body.append(root, pill);
  const mount = async () => {
    await loadArtImages();
    if (variant === 0) return mountToday(root, { seed, language, newBattle });
    const wheel = variant === 3;
    return mountPlay(root, { seed, language, newBattle, layout: wheel ? 'wheel' : 'duel', controls: wheel ? 'cards' : 'buttons', timed: variant === 2 });
  };
  void mount();
}
