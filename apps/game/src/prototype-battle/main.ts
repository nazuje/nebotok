/*
 * THROWAWAY PROTOTYPE, never merged to main. It answers one question: what should Nebotok's battles
 * look and feel like so they are faster, prettier, readable without reading, and clearly not a copy
 * of another creature game? Round two added skill and round three a free-moving arena: `?variant=0..6`
 * picks a look (6 when none is given); the same `seed` keeps the same pair of creatures across
 * variants. `easy=1` turns on the easier setting and `gap` sets how many levels the wild creature is
 * above yours; the arena also reads `ringout=0`, `abilities=1..3` and `kit=0..2`.
 */

import { LANGUAGES, type Language } from '@nebotok/core';
import { el, icon } from '../dom.ts';
import { loadArtImages } from '../sprites.ts';
import { mountArena } from './arena-play.ts';
import { mountActive } from './prototype-active.ts';
import { mountLive } from './prototype-live-play.ts';
import { mountPlay } from './prototype-play.ts';
import { mountToday } from './prototype-today.ts';
import { GAPS, type Settings } from './prototype-toggles.ts';

const LABELS = ['0 Today', '1 Sky Duel', '2 Timed taps', '3 Wheel + cards', '4 Active turns', '5 Live duel', '6 Arena'] as const;
const ARENA_LOOK = 6;
/** The looks with timing to make easier. */
const EASIER_LOOKS: readonly number[] = [2, 4, 5, 6];
const LEFT_PATH = 'M15.5 4l1.8 1.8l-6.2 6.2l6.2 6.2l-1.8 1.8l-8 -8z';
const RIGHT_PATH = 'M8.5 4l8 8l-8 8l-1.8 -1.8l6.2 -6.2l-6.2 -6.2z';

const params = new URLSearchParams(window.location.search);
const variant = Math.max(0, Math.min(LABELS.length - 1, Number.parseInt(params.get('variant') ?? String(ARENA_LOOK), 10) || 0));
const seed = Number.parseInt(params.get('seed') ?? '', 10);
const asked = params.get('lang');
const language: Language = LANGUAGES.find((known) => known === asked) ?? 'en';
const askedGap = Number.parseInt(params.get('gap') ?? '0', 10);
const gap = GAPS.find((known) => known === askedGap) ?? 0;
const easier = params.get('easy') === '1';

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
    if (variant === ARENA_LOOK) return;
    if (event.key === 'ArrowLeft') switchTo(variant - 1);
    if (event.key === 'ArrowRight') switchTo(variant + 1);
  });
  const root = el('main', { className: 'proto-root' });
  document.body.dataset.variant = String(variant);
  document.body.append(root, pill);
  const settings: Settings = {
    easier: EASIER_LOOKS.includes(variant) ? easier : null,
    gap,
    setEasier: (on) => go({ easy: on ? '1' : '0' }),
    setGap: (chosen) => go({ gap: String(chosen) }),
  };
  const mount = async () => {
    await loadArtImages();
    if (variant === 0) return mountToday(root, { seed, language, newBattle });
    if (variant === ARENA_LOOK) {
      const abilities = Number.parseInt(params.get('abilities') ?? '3', 10);
      const kit = Number.parseInt(params.get('kit') ?? '0', 10);
      return mountArena(root, { seed, language, settings, ringOut: params.get('ringout') !== '0', abilities: abilities >= 1 && abilities <= 3 ? abilities : 3, kit: kit >= 0 && kit <= 2 ? kit : 0, go });
    }
    if (variant === 4) return mountActive(root, { seed, language, newBattle, settings });
    if (variant === 5) return mountLive(root, { seed, language, newBattle, settings });
    const wheel = variant === 3;
    return mountPlay(root, { seed, language, newBattle, settings, layout: wheel ? 'wheel' : 'duel', controls: wheel ? 'cards' : 'buttons', timed: variant === 2 });
  };
  void mount();
}
