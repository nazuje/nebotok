import { CLOCK_SLACK_MS, MIN_ATTEMPT_MS, type DipParams, type Language, type MarkerParams, type SkillAttemptMessage, type SkillOutcome, type SkillResultMessage, type SparkleParams, type StringId, type Tap } from '@nebotok/core';
import { itemIcon } from './bag-screen.ts';
import { itemName } from './battle-content.ts';
import { el, icon } from './dom.ts';
import { ANSWER_MS } from './request-pacer.ts';
import { createDip } from './skill-games/dip.ts';
import { createMarker } from './skill-games/marker.ts';
import type { MiniGame, MiniGameOptions } from './skill-games/mini-game.ts';
import { createSparkle } from './skill-games/sparkle.ts';
import { STORY } from './story-content.ts';
import { format, text } from './strings.ts';

/**
 * A game over sooner than this after it was drawn waits before it reports, so the server, whose
 * clock started earlier, never judges it too quick.
 */
export const EARLIEST_FINISH_MS = MIN_ATTEMPT_MS + CLOCK_SLACK_MS;
/** How long a won game's result stays before the card closes by itself. */
export const RESULT_SHOW_MS = 2_000;

const HINTS: Readonly<Record<SkillAttemptMessage['game'], StringId>> = { dip: 'skill.dip.hint', sparkle: 'skill.sparkle.hint', marker: 'skill.marker.hint' };
const CLOSE_ICON = 'M6.4 4.6 12 10.2l5.6-5.6 1.8 1.8-5.6 5.6 5.6 5.6-1.8 1.8-5.6-5.6-5.6 5.6-1.8-1.8 5.6-5.6-5.6-5.6z';

/** Where the card has got to: playing, over and waiting to report, reported, showing the result, or asking for another go. */
export type CardPhase = 'playing' | 'over' | 'sent' | 'result' | 'starting';

/** The game on screen, for the test hook. */
export type TestAttempt = {
  readonly attempt: number;
  readonly skill: string;
  readonly spot: string | null;
  readonly recipe: string | null;
  readonly game: SkillAttemptMessage['game'];
  readonly params: SkillAttemptMessage['params'];
  readonly open: boolean;
  readonly phase: CardPhase;
  /** How long ago the game was drawn, in ms: a tap now would be reported at this time. */
  readonly elapsedMs: number;
  readonly taps: readonly Tap[];
  readonly outcome: SkillOutcome | null;
  readonly line: string | null;
};

const WON: ReadonlySet<SkillOutcome> = new Set(['perfect', 'success']);

/** The card's result line: "Perfect! +2 Pebblefish", "Got it! +1 Cloudberry", or "So close! Try again." */
export function resultLine(result: Pick<SkillResultMessage, 'outcome' | 'items' | 'extra'>, language: Language): string {
  if (WON.has(result.outcome)) {
    const got = result.items[0];
    if (got) return format(result.outcome === 'perfect' ? 'skill.perfect' : 'skill.success', language, { count: got.count, item: itemName(got.item, language) });
    const lost = result.extra[0];
    if (lost) return format('skill.bagFull', language, { item: itemName(lost.item, language) });
  }
  return text('skill.miss', language);
}

/** What an attempt is for: the spot's item or the recipe's dish. */
export function attemptItem(attempt: Pick<SkillAttemptMessage, 'spot' | 'recipe'>): string | null {
  if (attempt.spot !== null) return STORY.skills?.spots.get(attempt.spot)?.item ?? null;
  return attempt.recipe === null ? null : (STORY.skills?.recipes.get(attempt.recipe)?.makes ?? null);
}

/** The card's title: the spot's name, or the dish being cooked. */
function attemptTitle(attempt: SkillAttemptMessage, language: Language): string {
  const spot = attempt.spot === null ? undefined : STORY.skills?.spots.get(attempt.spot);
  if (spot) return spot.name[language];
  const item = attemptItem(attempt);
  return item ? itemName(item, language) : '';
}

/** The look of the spot a game is played at, if it is played at a spot. */
const attemptLook = (attempt: SkillAttemptMessage): string | null => (attempt.spot === null ? null : (STORY.skills?.spots.get(attempt.spot)?.look ?? null));

function miniGame(attempt: SkillAttemptMessage, options: MiniGameOptions): MiniGame {
  if (attempt.game === 'dip') return createDip(attempt.params as DipParams, options);
  if (attempt.game === 'sparkle') return createSparkle(attempt.params as SparkleParams, options);
  return createMarker(attempt.params as MarkerParams, options);
}

export type SkillCardOptions = {
  language(): Language;
  reducedMotion(): boolean;
  /** The game is over: report these taps. */
  finish(attempt: number, taps: readonly Tap[]): void;
  /** The card was closed before the game was over. */
  cancel(attempt: number): void;
  /** "Try again": ask for another go at the same spot or recipe. */
  again(attempt: SkillAttemptMessage): void;
  /** The card closed. */
  closed(): void;
};

export type SkillCard = {
  /** Draws a new game, `now` being when it is drawn. */
  open(attempt: SkillAttemptMessage, now: number): void;
  /** Shows how the attempt went, if it is the one on the card. */
  result(result: SkillResultMessage, now: number): void;
  /** The server turned down another go: the card closes. */
  refused(): void;
  /** Called every frame. */
  frame(now: number): void;
  isOpen(): boolean;
  /** Closes the card, cancelling a game still being played. */
  close(): void;
  state(now: number): TestAttempt | null;
};

type Shown = {
  readonly attempt: SkillAttemptMessage;
  readonly game: MiniGame;
  readonly drawnAt: number;
  readonly taps: Tap[];
  phase: CardPhase;
  outcome: SkillOutcome | null;
  resultAt: number;
  /** When "Try again" asked for another go; with no game after ANSWER_MS the ask is taken as lost. */
  askedAt: number;
  language: Language;
};

/**
 * The tiny game's card, centred over the world: the spot's or dish's name, a hint, the big play
 * area and, once the server has judged, the result. Taps are timed with `performance.now()` from
 * the moment the game was drawn. The close button and Escape cancel a game still being played; a
 * miss offers another go, and a win closes the card by itself.
 */
export function createSkillCard(root: HTMLElement, options: SkillCardOptions): SkillCard {
  let shown: Shown | null = null;
  let lastItems: SkillResultMessage['items'] = [];
  let lastExtra: SkillResultMessage['extra'] = [];
  const title = el('h2', { className: 'skill-title', attrs: { id: 'skill-title' } });
  const picture = el('div', { className: 'skill-picture' });
  const close = el('button', { className: 'skill-close', attrs: { type: 'button' } }, [icon(CLOSE_ICON)]);
  const hint = el('p', { className: 'skill-hint' });
  const play = el('div', { className: 'skill-play' });
  const line = el('p', { className: 'skill-result', attrs: { role: 'status', 'aria-live': 'polite' } });
  const again = el('button', { className: 'primary skill-again', attrs: { type: 'button' } });
  const done = el('button', { className: 'secondary skill-done', attrs: { type: 'button' } });
  const actions = el('div', { className: 'skill-actions' }, [again, done]);
  const card = el('div', { className: 'skill-card', attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'skill-title' } }, [
    el('div', { className: 'skill-head' }, [picture, title, close]),
    hint,
    play,
    line,
    actions,
  ]);
  root.replaceChildren(card);
  root.hidden = true;

  function shut() {
    if (!shown) return;
    const { attempt, phase } = shown;
    shown = null;
    // Space or Enter on a button still focused in the hidden card would press it, not use the spot.
    if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.blur();
    root.hidden = true;
    play.replaceChildren();
    if (phase === 'playing' || phase === 'over') options.cancel(attempt.attempt);
    options.closed();
  }

  /** Reports the game once it is over and old enough that the server will judge it. */
  function step(now: number) {
    if (!shown) return;
    const ms = now - shown.drawnAt;
    if (shown.phase === 'playing' && shown.game.over(shown.taps, ms)) shown.phase = 'over';
    if (shown.phase === 'over' && ms >= EARLIEST_FINISH_MS) {
      shown.phase = 'sent';
      options.finish(shown.attempt.attempt, [...shown.taps]);
    }
  }

  function press(place: number) {
    if (shown?.phase !== 'playing') return;
    const now = performance.now();
    const ms = Math.max(0, Math.round(now - shown.drawnAt));
    if (shown.game.press(place, ms)) shown.taps.push({ at: ms, place });
    step(now);
    shown.game.frame(now - shown.drawnAt);
  }

  function label() {
    if (!shown) return;
    const language = options.language();
    shown.language = language;
    title.textContent = attemptTitle(shown.attempt, language);
    hint.textContent = text(HINTS[shown.attempt.game], language);
    close.setAttribute('aria-label', text('team.close', language));
    again.textContent = text('skill.tryAgain', language);
    done.textContent = text('team.close', language);
    shown.game.relabel(language);
    showResult();
  }

  function showResult() {
    if (!shown) return;
    const { phase, outcome } = shown;
    card.dataset.phase = phase;
    card.dataset.outcome = outcome ?? '';
    const language = shown.language;
    line.textContent = phase === 'sent' || phase === 'starting' ? text('skill.waiting', language) : '';
    if (phase === 'result' && outcome !== null) line.textContent = resultLine({ outcome, items: lastItems, extra: lastExtra }, language);
    actions.hidden = phase !== 'result';
    again.hidden = outcome === null || WON.has(outcome);
  }

  close.addEventListener('click', shut);
  done.addEventListener('click', shut);
  again.addEventListener('click', () => {
    if (!shown || shown.phase !== 'result') return;
    shown.phase = 'starting';
    shown.askedAt = performance.now();
    shown.outcome = null;
    play.replaceChildren();
    showResult();
    options.again(shown.attempt);
  });

  window.addEventListener('keydown', (event) => {
    if (!shown || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      shut();
      return;
    }
    const place = shown.phase === 'playing' ? shown.game.keyPlace(event.code) : null;
    if (place === null) return;
    event.preventDefault();
    if (!event.repeat) press(place);
  });

  return {
    open: (attempt, now) => {
      const game = miniGame(attempt, { language: options.language(), reducedMotion: options.reducedMotion(), look: attemptLook(attempt), press });
      shown = { attempt, game, drawnAt: now, taps: [], phase: 'playing', outcome: null, resultAt: 0, askedAt: 0, language: options.language() };
      lastItems = [];
      lastExtra = [];
      const item = attemptItem(attempt);
      picture.replaceChildren(...(item ? [itemIcon(item)] : []));
      card.dataset.game = attempt.game;
      play.replaceChildren(game.element);
      root.hidden = false;
      label();
      game.frame(0);
      game.element.focus({ preventScroll: true });
    },
    result: (result, now) => {
      if (!shown || shown.attempt.attempt !== result.attempt) return;
      if (result.outcome === 'cancelled') {
        shown.phase = 'result';
        shut();
        return;
      }
      shown.phase = 'result';
      shown.outcome = result.outcome;
      shown.resultAt = now;
      lastItems = result.items;
      lastExtra = result.extra;
      showResult();
      (WON.has(result.outcome) ? done : again).focus({ preventScroll: true });
    },
    refused: () => {
      if (shown?.phase === 'starting' || shown?.phase === 'sent') {
        shown.phase = 'result';
        shut();
      }
    },
    frame: (now) => {
      if (!shown) return;
      if (shown.phase === 'starting' && now - shown.askedAt >= ANSWER_MS) {
        shown.phase = 'result';
        shut();
        return;
      }
      if (shown.language !== options.language()) label();
      step(now);
      if (shown.phase !== 'starting') shown.game.frame(now - shown.drawnAt);
      if (shown.phase !== card.dataset.phase) showResult();
      if (shown.phase === 'result' && shown.outcome !== null && WON.has(shown.outcome) && now - shown.resultAt >= RESULT_SHOW_MS) shut();
    },
    isOpen: () => shown !== null,
    close: shut,
    state: (now) =>
      shown && {
        attempt: shown.attempt.attempt,
        skill: shown.attempt.skill,
        spot: shown.attempt.spot,
        recipe: shown.attempt.recipe,
        game: shown.attempt.game,
        params: shown.attempt.params,
        open: true,
        phase: shown.phase,
        elapsedMs: Math.round(now - shown.drawnAt),
        taps: [...shown.taps],
        outcome: shown.outcome,
        line: line.textContent || null,
      },
  };
}
