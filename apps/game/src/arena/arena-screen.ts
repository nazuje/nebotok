import { xpToNextLevel, type ArenaResultMessage, type Language, type PictureId, type StringId, type TeamCreature } from '@nebotok/core';
import { speciesName, weatherName } from '../battle-content.ts';
import { creaturePortrait } from '../creature-art.ts';
import { restHint } from '../creature-card.ts';
import { el, pictureButton } from '../dom.ts';
import { healthLevel } from '../health-level.ts';
import { pictureIcon, weatherIcon } from '../pictures.ts';
import { format, text } from '../strings.ts';
import { levelBadge } from './arena-buttons.ts';
import type { BadgeTone, Popup } from './arena-juice.ts';

/**
 * The HTML of the fight over the arena scene: a card for each creature at the top (its portrait,
 * level badge coloured by the level gap, and health with a trail of what was just lost), the
 * island's weather in the corner, the damage numbers over the creatures, the parts the controls
 * fill in, and the result once the server has settled the fight, with a picture for every ending
 * so it reads without words. Your card has a yellow edge, and an arrow to the shrine under it when
 * your creature came in hurt. A duel's watcher has no side of their own, so no yellow edge, and gets
 * Stop watching, a one-tap button, instead of the controls; everyone sees when the fight waits for
 * a player.
 */

/**
 * A creature on the island, as its card shows it; `tone` compares its level with the other
 * creature's, and `rest` is whether it is yours and came onto the island hurt (health-level.ts `cameInHurt`).
 */
export type CardView = { readonly species: string; readonly level: number; readonly tone: BadgeTone; readonly health: number; readonly max: number; readonly turtle: boolean; readonly rest: boolean };

export type ArenaScreenView = {
  /** Your creature's card, then the other side's. */
  readonly cards: readonly [CardView | null, CardView | null];
  /** The weather on the island, or ''. */
  readonly weather: string;
  readonly result: ArenaResultMessage | null;
  /** Your team as the server last sent it, for the result's experience bars. */
  readonly team: readonly TeamCreature[];
  /** Whether you watch someone's duel, rather than fight. */
  readonly watching: boolean;
  /** Whether the fight waits for a player who is away, or a watcher waits for the players to pick. */
  readonly waiting: boolean;
};

export type ArenaScreen = {
  /** Where the island is drawn; the scene fits it in this box. */
  readonly field: HTMLElement;
  readonly zone: HTMLElement;
  readonly cluster: HTMLElement;
  readonly leave: HTMLButtonElement;
  /** Where a best of 3 shows picking and the score between rounds. */
  readonly rounds: HTMLElement;
  render(view: ArenaScreenView | null, language: Language): void;
  /** Pops a damage number or health back up at (x, y), in CSS pixels from the page's top left. */
  popup(popup: Popup, x: number, y: number, language: Language): void;
};

type Ending = { readonly picture: PictureId; readonly line: StringId; readonly also: StringId | null };

/** The picture and words for how a fight ended, for one who fought it or, `watching`, one who watched. */
export function endingOf(result: ArenaResultMessage, watching = false): Ending {
  const outcome = result.outcome?.result ?? null;
  const gaveUp = result.rounds.some((round) => round.how === 'gaveUp') ? 'arena.gaveUp' : null;
  if (watching) return outcome === null ? { picture: 'cloud-off', line: 'battle.interrupted', also: null } : { picture: 'trophy', line: 'arena.duelOver', also: gaveUp };
  switch (outcome) {
    case 'won':
      return { picture: 'trophy', line: 'battle.won', also: gaveUp };
    case 'wonByRingOut':
      return { picture: 'ring-out', line: 'battle.won', also: 'arena.ringOut' };
    case 'befriended':
      return { picture: 'heart', line: result.befriended?.placedIn === 'storage' ? 'battle.befriendedStored' : 'battle.befriended', also: null };
    case 'lost':
      return { picture: 'puff', line: result.woke ? 'battle.teamFainted' : 'battle.over', also: gaveUp };
    case 'ran':
      return { picture: 'leave', line: 'battle.ranAway', also: null };
    case 'timeUp':
      return { picture: 'clock', line: 'arena.timeUp', also: null };
    case 'draw':
      return { picture: 'puff', line: 'battle.over', also: null };
    default:
      return { picture: 'cloud-off', line: 'battle.interrupted', also: null };
  }
}

type Card = {
  readonly root: HTMLElement;
  readonly portrait: HTMLElement;
  readonly level: HTMLElement;
  readonly health: HTMLElement;
  readonly fill: HTMLElement;
  readonly trail: HTMLElement;
  readonly turtle: HTMLElement;
  readonly rest: HTMLElement;
  species: string;
};

function makeCard(className: string): Card {
  const portrait = el('span', { className: 'arena-portrait' });
  const level = el('span', { className: 'arena-level' });
  const trail = el('span', { className: 'arena-health-trail' });
  const fill = el('span', { className: 'arena-health-fill' });
  const health = el('span', { className: 'arena-health', attrs: { role: 'img' } }, [trail, fill]);
  const turtle = el('span', { className: 'arena-turtle' });
  const rest = el('span', { className: 'arena-rest' }, [restHint(24)]);
  const root = el('div', { className: `arena-card ${className}` }, [portrait, el('span', { className: 'arena-card-words' }, [level, health]), turtle, rest]);
  return { root, portrait, level, health, fill, trail, turtle, rest, species: '' };
}

function renderCard(card: Card, view: CardView | null, language: Language): void {
  card.root.hidden = view === null;
  if (!view) return;
  if (card.species !== view.species) {
    card.species = view.species;
    card.portrait.replaceChildren(creaturePortrait(view.species));
  }
  card.root.setAttribute('aria-label', speciesName(view.species, language));
  card.level.textContent = levelBadge(view.level, language);
  card.level.dataset.tone = view.tone;
  const share = view.max > 0 ? Math.max(0, Math.min(1, view.health / view.max)) : 0;
  const width = `${(share * 100).toFixed(1)}%`;
  card.fill.style.width = width;
  card.trail.style.width = width;
  card.fill.dataset.level = healthLevel(view.health, view.max);
  card.rest.hidden = !view.rest;
  card.health.setAttribute('aria-label', format('battle.health', language, { hp: view.health, max: view.max }));
  card.turtle.hidden = !view.turtle;
  if (view.turtle && card.turtle.childElementCount === 0) card.turtle.append(pictureIcon('turtle', 24));
  card.turtle.setAttribute('aria-label', text('arena.turtle', language));
}

function rewardRow(reward: ArenaResultMessage['rewards'][number], team: readonly TeamCreature[], language: Language): HTMLElement {
  const creature = team[reward.index];
  const xp = creature && creature.level === reward.level ? creature.xp : 0;
  const share = Math.max(0, Math.min(1, xp / xpToNextLevel(reward.level)));
  const bar = el('span', { className: 'arena-xp', attrs: { 'aria-hidden': 'true' } }, [el('span', { className: 'arena-xp-fill' })]);
  bar.style.setProperty('--xp', share.toFixed(3));
  return el('li', { className: 'arena-reward' }, [
    creature ? creaturePortrait(creature.species) : el('span'),
    el('span', { className: 'arena-level', text: levelBadge(reward.level, language) }),
    bar,
    el('span', { className: 'arena-xp-gained', text: format('battle.xpGained', language, { xp: reward.xp }) }),
  ]);
}

export function createArenaScreen(root: HTMLElement, options: { continue(): void; unwatch(): void }): ArenaScreen {
  const cards = [makeCard('mine'), makeCard('theirs')] as const;
  const leave = el('button', { className: 'arena-leave', attrs: { type: 'button' } });
  const top = el('div', { className: 'arena-top' }, [cards[0].root, cards[1].root, leave]);
  const field = el('div', { className: 'arena-field' });
  const weather = el('div', { className: 'arena-weather' });
  const popups = el('div', { className: 'arena-popups', attrs: { 'aria-hidden': 'true' } });
  const zone = el('div', { className: 'arena-zone', attrs: { role: 'application' } });
  const cluster = el('div', { className: 'arena-cluster' });
  const rounds = el('div', { className: 'arena-rounds' });
  const result = el('div', { className: 'arena-result', attrs: { role: 'dialog', 'aria-modal': 'true' } });
  const waiting = el('p', { className: 'arena-waiting', attrs: { role: 'status' } });
  const unwatch = el('div', { className: 'arena-unwatch' });
  root.replaceChildren(field, weather, popups, top, zone, cluster, rounds, waiting, unwatch, result);
  let resultKey = '';
  let weatherKey = '';
  let watchKey = '';

  function renderWatching(view: ArenaScreenView, language: Language) {
    root.dataset.watching = String(view.watching);
    waiting.hidden = !view.waiting || view.result !== null;
    unwatch.hidden = !view.watching || view.result !== null;
    const key = `${language}/${view.watching}`;
    if (key === watchKey) return;
    watchKey = key;
    waiting.replaceChildren(pictureIcon('clock', 32), el('span', { text: text('arena.waiting', language) }));
    unwatch.replaceChildren(...(view.watching ? [pictureButton('arena-stop-watching secondary', pictureIcon('watch', 32), text('arena.stopWatching', language), options.unwatch)] : []));
  }

  function renderWeather(type: string, language: Language) {
    const key = `${type}/${language}`;
    if (key === weatherKey) return;
    weatherKey = key;
    weather.hidden = type === '';
    weather.dataset.weather = type;
    weather.replaceChildren(...(type === '' ? [] : [weatherIcon(type, 40, { label: weatherName(type, language) })]));
  }

  function renderResult(view: ArenaScreenView, language: Language) {
    const shown = view.result;
    result.hidden = shown === null;
    root.dataset.ended = String(shown !== null);
    const key = JSON.stringify([language, shown, view.team.map((creature) => [creature.species, creature.level, creature.xp])]);
    if (!shown || key === resultKey) return;
    resultKey = key;
    const ending = endingOf(shown, view.watching);
    const befriended = shown.befriended;
    const line = format(ending.line, language, { creature: befriended ? speciesName(befriended.species, language) : '' });
    const proceed = pictureButton('arena-continue primary', pictureIcon('check', 32), text('battle.continue', language), options.continue);
    result.dataset.outcome = shown.outcome?.result ?? 'none';
    result.replaceChildren(
      pictureIcon(ending.picture, 64, { className: 'arena-result-picture' }),
      el('p', { className: 'arena-result-line', text: line }),
      ...(ending.also ? [el('p', { className: 'arena-result-also', text: text(ending.also, language) })] : []),
      ...(befriended ? [el('div', { className: 'arena-befriended' }, [creaturePortrait(befriended.species), pictureIcon('heart', 32)])] : []),
      el(
        'ul',
        { className: 'arena-rewards' },
        shown.rewards.map((reward) => rewardRow(reward, view.team, language)),
      ),
      proceed,
    );
  }

  return {
    field,
    zone,
    cluster,
    leave,
    rounds,
    render: (view, language) => {
      root.hidden = view === null;
      if (!view) {
        resultKey = '';
        watchKey = '';
        popups.replaceChildren();
        return;
      }
      zone.setAttribute('aria-label', text('arena.move', language));
      renderCard(cards[0], view.cards[0], language);
      renderCard(cards[1], view.cards[1], language);
      renderWeather(view.weather, language);
      renderWatching(view, language);
      renderResult(view, language);
    },
    popup: (popup, x, y, language) => {
      const words = popup.tone === 'heal' ? format('arena.healed', language, { amount: popup.amount }) : format(popup.tone === 'strong' ? 'arena.damageStrong' : 'arena.damage', language, { damage: popup.amount });
      const shown = el('span', { className: 'arena-pop', text: words });
      shown.dataset.tone = popup.tone;
      shown.style.left = `${Math.round(x)}px`;
      shown.style.top = `${Math.round(y)}px`;
      // arena.css fades every number out, under reduced motion too, so its end removes it.
      shown.addEventListener('animationend', () => shown.remove(), { once: true });
      popups.append(shown);
    },
  };
}
