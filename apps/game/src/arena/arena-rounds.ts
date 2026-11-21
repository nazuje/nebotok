import { ARENA_PICK_MS, ROUNDS, maxHpOf, togglePick, type Language, type PictureId, type Side, type TeamCreature } from '@nebotok/core';
import { CONTENT, speciesName, speciesType } from '../battle-content.ts';
import { healthBar, restHint } from '../creature-card.ts';
import { creaturePortrait } from '../creature-art.ts';
import { el, pictureButton } from '../dom.ts';
import { needsRest } from '../health-level.ts';
import { digits } from '../loadout-picker.ts';
import { pictureIcon, weatherIcon } from '../pictures.ts';
import { format, text } from '../strings.ts';
import { levelBadge } from './arena-buttons.ts';

/**
 * The screens of a best of 3 around its rounds (docs/arena.md, "Fight modes"): picking three, where
 * a tap puts a team creature in the next empty slot and a second tap takes it out, with Go and its
 * timer ring; and the score between rounds, a pip for each round with both next creatures sliding
 * in. The server decides the picks and the rounds; these only show them and send the order.
 */

/** A round's pip, for your side: a trophy for a round you won, a puff for one you did not, empty for one still to come. */
export type Pip = 'won' | 'lost' | 'empty';

/** The three pips from the state's `rounds`: each round's winner, or `ROUND_DRAW`, which is no win either. */
export function pipsOf(rounds: readonly number[], side: Side): Pip[] {
  return Array.from({ length: ROUNDS }, (_, at) => {
    const round = rounds[at];
    if (round === undefined) return 'empty';
    return round === side ? 'won' : 'lost';
  });
}

export type PickView = {
  readonly team: readonly TeamCreature[];
  /** The team places picked, in round order. */
  readonly order: readonly number[];
  /** Whether the order has gone to the server. */
  readonly sent: boolean;
  /** Milliseconds left to pick. */
  readonly countdown: number;
};

export type BetweenView = {
  readonly pips: readonly Pip[];
  readonly score: readonly [number, number];
  /** The species of your next creature, then of theirs. */
  readonly next: readonly [string | null, string | null];
};

export type RoundsView = { readonly pick: PickView | null; readonly between: BetweenView | null };

export type RoundsScreen = { render(view: RoundsView, language: Language): void };

const PIP_PICTURES: Readonly<Record<Exclude<Pip, 'empty'>, PictureId>> = { won: 'trophy', lost: 'puff' };

/** The places standing creatures hold on the team. */
const standingOf = (team: readonly TeamCreature[]): number[] => team.flatMap((creature, place) => (creature.hp > 0 ? [place] : []));

function slotOf(place: number | undefined, at: number, team: readonly TeamCreature[], language: Language): HTMLElement {
  const creature = place === undefined ? undefined : team[place];
  const label = format('arena.roundSlot', language, { round: at + 1 });
  return el('li', { className: 'arena-slot', attrs: { 'aria-label': creature ? `${label}: ${speciesName(creature.species, language)}` : label, 'data-filled': String(creature !== undefined) } }, [
    digits(at + 1, 24),
    creature ? creaturePortrait(creature.species) : el('span', { className: 'arena-slot-empty' }),
  ]);
}

function pickChoice(creature: TeamCreature, place: number, slot: number, language: Language, tapped: (place: number) => void): HTMLElement {
  const type = speciesType(creature.species);
  const standing = creature.hp > 0;
  const maxHp = maxHpOf(creature, CONTENT);
  const made = el('button', { className: 'arena-choice', attrs: { type: 'button', 'aria-pressed': String(slot >= 0), 'aria-label': speciesName(creature.species, language), 'data-place': String(place) } }, [
    creaturePortrait(creature.species),
    el('span', { className: 'arena-choice-words' }, [
      el('span', { className: 'arena-level', text: levelBadge(creature.level, language) }),
      ...(type ? [weatherIcon(type, 24)] : []),
    ]),
    healthBar(creature.hp, maxHp, language, false),
    ...(needsRest(creature.hp, maxHp) ? [restHint(16)] : []),
    ...(slot >= 0 ? [digits(slot + 1, 24)] : []),
  ]);
  made.disabled = !standing;
  made.addEventListener('click', () => tapped(place));
  return made;
}

/** Fills `root` with the pick screen or the score between rounds, whichever the view holds. */
export function createRoundsScreen(root: HTMLElement, options: { tapped(place: number): void; go(): void }): RoundsScreen {
  const pick = el('div', { className: 'arena-pick', attrs: { role: 'dialog', 'aria-modal': 'true' } });
  const between = el('div', { className: 'arena-between', attrs: { role: 'status' } });
  root.replaceChildren(pick, between);
  let pickKey = '';
  let betweenKey = '';
  let ring: HTMLElement | null = null;

  function renderPick(view: PickView, language: Language) {
    const key = JSON.stringify([language, view.order, view.sent, view.team.map(({ species, level, hp }) => [species, level, hp])]);
    if (key !== pickKey) {
      pickKey = key;
      const go = pictureButton('arena-go primary', pictureIcon('check', 32), text('arena.go', language), options.go);
      go.disabled = view.sent || view.order.length === 0;
      ring = el('span', { className: 'arena-go-ring' }, [go]);
      pick.replaceChildren(
        el('h2', { className: 'arena-pick-title', text: text('arena.pickTitle', language) }),
        el(
          'ol',
          { className: 'arena-slots' },
          Array.from({ length: ROUNDS }, (_, at) => slotOf(view.order[at], at, view.team, language)),
        ),
        el(
          'div',
          { className: 'arena-choices' },
          view.team.map((creature, place) => pickChoice(creature, place, view.order.indexOf(place), language, options.tapped)),
        ),
        ring,
      );
    }
    ring?.style.setProperty('--left', Math.max(0, Math.min(1, view.countdown / ARENA_PICK_MS)).toFixed(3));
  }

  function renderBetween(view: BetweenView, language: Language) {
    const key = JSON.stringify([language, view]);
    if (key === betweenKey) return;
    betweenKey = key;
    const [mine, theirs] = view.next;
    between.replaceChildren(
      el(
        'ol',
        { className: 'arena-pips', attrs: { role: 'img', 'aria-label': format('arena.score', language, { mine: view.score[0], theirs: view.score[1] }) } },
        view.pips.map((pip) => el('li', { className: 'arena-pip', attrs: { 'data-pip': pip } }, pip === 'empty' ? [] : [pictureIcon(PIP_PICTURES[pip], 40)])),
      ),
      el('div', { className: 'arena-next' }, [
        el('span', { className: 'arena-next-mine' }, mine ? [creaturePortrait(mine)] : []),
        el('span', { className: 'arena-next-theirs' }, theirs ? [creaturePortrait(theirs)] : []),
      ]),
    );
  }

  return {
    render: (view, language) => {
      pick.hidden = view.pick === null;
      between.hidden = view.between === null;
      if (view.pick) renderPick(view.pick, language);
      else pickKey = '';
      if (view.between) renderBetween(view.between, language);
      else betweenKey = '';
    },
  };
}

/** The order after a tap on the creature at `place` of `team`. */
export const tappedOrder = (order: readonly number[], place: number, team: readonly TeamCreature[]): number[] => togglePick(order, place, standingOf(team));
