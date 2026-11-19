import { xpToNextLevel, type ArenaResultMessage, type Language, type PictureId, type StringId, type TeamCreature } from '@nebotok/core';
import { speciesName } from '../battle-content.ts';
import { creaturePortrait } from '../creature-art.ts';
import { el, pictureButton } from '../dom.ts';
import { pictureIcon } from '../pictures.ts';
import { format, text } from '../strings.ts';
import { levelBadge } from './arena-buttons.ts';

/**
 * The HTML of the fight over the arena scene: a card for each creature at the top (its portrait,
 * level badge and health), the parts the controls fill in, and the result once the server has
 * settled the fight, with a picture for every ending so it reads without words.
 */

/** A creature on the island, as its card shows it. */
export type CardView = { readonly species: string; readonly level: number; readonly health: number; readonly max: number; readonly turtle: boolean };

export type ArenaScreenView = {
  /** Your creature's card, then the other side's. */
  readonly cards: readonly [CardView | null, CardView | null];
  readonly result: ArenaResultMessage | null;
  /** Your team as the server last sent it, for the result's experience bars. */
  readonly team: readonly TeamCreature[];
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
};

type Ending = { readonly picture: PictureId; readonly line: StringId; readonly also: StringId | null };

/** The picture and words for how a fight ended. */
export function endingOf(result: ArenaResultMessage): Ending {
  const outcome = result.outcome?.result ?? null;
  switch (outcome) {
    case 'won':
      return { picture: 'trophy', line: 'battle.won', also: null };
    case 'wonByRingOut':
      return { picture: 'ring-out', line: 'battle.won', also: 'arena.ringOut' };
    case 'befriended':
      return { picture: 'heart', line: result.befriended?.placedIn === 'storage' ? 'battle.befriendedStored' : 'battle.befriended', also: null };
    case 'lost':
      return { picture: 'puff', line: result.woke ? 'battle.teamFainted' : 'battle.over', also: null };
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

type Card = { readonly root: HTMLElement; readonly portrait: HTMLElement; readonly level: HTMLElement; readonly health: HTMLElement; readonly fill: HTMLElement; readonly turtle: HTMLElement; species: string };

function makeCard(className: string): Card {
  const portrait = el('span', { className: 'arena-portrait' });
  const level = el('span', { className: 'arena-level' });
  const fill = el('span', { className: 'arena-health-fill' });
  const health = el('span', { className: 'arena-health', attrs: { role: 'img' } }, [fill]);
  const turtle = el('span', { className: 'arena-turtle' });
  const root = el('div', { className: `arena-card ${className}` }, [portrait, el('span', { className: 'arena-card-words' }, [level, health]), turtle]);
  return { root, portrait, level, health, fill, turtle, species: '' };
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
  const share = view.max > 0 ? Math.max(0, Math.min(1, view.health / view.max)) : 0;
  card.fill.style.width = `${(share * 100).toFixed(1)}%`;
  card.fill.dataset.low = String(share < 0.3);
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

export function createArenaScreen(root: HTMLElement, options: { continue(): void }): ArenaScreen {
  const cards = [makeCard('mine'), makeCard('theirs')] as const;
  const leave = el('button', { className: 'arena-leave', attrs: { type: 'button' } });
  const top = el('div', { className: 'arena-top' }, [cards[0].root, cards[1].root, leave]);
  const field = el('div', { className: 'arena-field' });
  const zone = el('div', { className: 'arena-zone', attrs: { role: 'application' } });
  const cluster = el('div', { className: 'arena-cluster' });
  const rounds = el('div', { className: 'arena-rounds' });
  const result = el('div', { className: 'arena-result', attrs: { role: 'dialog', 'aria-modal': 'true' } });
  root.replaceChildren(field, top, zone, cluster, rounds, result);
  let resultKey = '';

  function renderResult(view: ArenaScreenView, language: Language) {
    const shown = view.result;
    result.hidden = shown === null;
    root.dataset.ended = String(shown !== null);
    const key = JSON.stringify([language, shown, view.team.map((creature) => [creature.species, creature.level, creature.xp])]);
    if (!shown || key === resultKey) return;
    resultKey = key;
    const ending = endingOf(shown);
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
        return;
      }
      zone.setAttribute('aria-label', text('arena.move', language));
      renderCard(cards[0], view.cards[0], language);
      renderCard(cards[1], view.cards[1], language);
      renderResult(view, language);
    },
  };
}
