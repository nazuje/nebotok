import { frameNames, spriteFor, type BattleView, type Language, type ProgressMessage, type StringId } from '@nebotok/core';
import { isTreat, itemName, moveName, moveType, speciesName, weatherName } from './battle-content.ts';
import type { ClientMessage } from './battle-link.ts';
import { resultLines, type BattleScreenState, type Picker } from './battle-model.ts';
import type { Line } from './battle-playback.ts';
import { creatureSummary } from './creature-card.ts';
import { button, el } from './dom.ts';
import { paintFrame, sprite } from './sprites.ts';
import { format, text } from './strings.ts';

/** A line under the field in words: creatures by their species' name, moves and weather by theirs. */
export function lineText(line: Line, view: BattleView, language: Language): string {
  const creature = [...view.team.creatures, ...view.opponent.creatures].find((candidate) => candidate.id === line.creature);
  const species = creature?.species ?? line.species;
  return format(line.id, language, {
    creature: species ? speciesName(species, language) : '',
    move: line.move ? moveName(line.move, language) : '',
    weather: line.weather ? weatherName(line.weather, language) : '',
    xp: line.xp ?? '',
    level: line.level ?? '',
  });
}

export type BattleScreenOptions = {
  language(): Language;
  progress(): ProgressMessage | null;
  /** Sends a choice to the server; the model waits for the answer. */
  send(message: ClientMessage): void;
  pick(picker: Picker): void;
  /** A tap while a turn plays: on to the next line, or to the end. */
  advance(): void;
  close(): void;
};

export type BattleScreen = {
  /** Draws `state`, rebuilding the page only when something on it changed. */
  render(state: BattleScreenState | null): void;
  /** Where the field is, for the Phaser scene to draw in. */
  field(): DOMRect | null;
};

type Card = { readonly id: string; readonly species: string; readonly level: number; readonly maxHp: number };

/** The weather on the field, as its icon and name, while there is any. */
function weatherBadge(weather: string | null, language: Language): HTMLElement {
  const badge = el('p', { className: 'battle-weather' });
  badge.hidden = weather === null;
  if (weather === null) return badge;
  const id = spriteFor.weatherIcon(weather);
  const picture = el('canvas', { className: 'weather-icon', attrs: { 'aria-hidden': 'true' } });
  paintFrame(picture, id, frameNames(sprite(id))[0] ?? '');
  badge.dataset.weather = weather;
  badge.setAttribute('aria-label', format('battle.weather', language, { weather: weatherName(weather, language) }));
  badge.append(picture, el('span', { text: weatherName(weather, language), attrs: { 'aria-hidden': 'true' } }));
  return badge;
}

/**
 * The words and buttons of a battle, as HTML over the Phaser field: each side's name, level and
 * health, the weather, the line saying what just happened, and below it the menu, a picker or the
 * result. While a turn plays the panel is empty and a tap anywhere moves on to the next line.
 */
export function createBattleScreen(root: HTMLElement, options: BattleScreenOptions): BattleScreen {
  const t = (id: StringId) => text(id, options.language());
  let shown = '';
  let current: BattleScreenState | null = null;
  let field: HTMLElement | null = null;

  root.addEventListener('pointerdown', () => {
    if (current?.playing) options.advance();
  });

  const choose = (message: ClientMessage) => {
    if (current?.waiting || current?.playing) return;
    options.send(message);
  };

  function card(side: 'mine' | 'foe', creature: Card | undefined, hp: number): HTMLElement {
    const box = el('div', { className: `battle-card ${side}` });
    if (creature) box.append(...creatureSummary({ ...creature, hp }, options.language(), { portrait: false, labelled: side === 'mine' }));
    box.hidden = !creature;
    return box;
  }

  function menu(state: BattleScreenState): HTMLElement[] {
    const language = options.language();
    const moves = state.menu.moves.map((move, slot) => button(`move type-${moveType(move) ?? 'none'}`, moveName(move, language), () => choose({ type: 'battle.move', payload: { slot } })));
    const parts: HTMLElement[] = [];
    if (moves.length > 0) parts.push(el('div', { className: 'battle-moves', attrs: { role: 'group', 'aria-label': t('battle.moves') } }, moves));
    const team = button('secondary battle-team', t('battle.team'), () => options.pick('team'));
    const treat = button('secondary battle-treat', t('battle.treat'), () => options.pick('treats'));
    // Once the wild creature has fainted, leaving it is the end of a battle won, not running away.
    const run = button('secondary battle-run', t(state.view.phase === 'befriend' ? 'battle.done' : 'battle.run'), () => choose({ type: 'battle.run', payload: {} }));
    team.disabled = !state.menu.team;
    treat.disabled = !state.menu.treat;
    run.disabled = !state.menu.run;
    parts.push(el('div', { className: 'battle-actions' }, [team, treat, run]));
    if (state.menu.treatReason) {
      const reason = el('p', { className: 'battle-reason', text: t(state.menu.treatReason), attrs: { id: 'battle-treat-reason' } });
      treat.setAttribute('aria-describedby', reason.id);
      parts.push(reason);
    }
    return parts;
  }

  function teamPicker(state: BattleScreenState): HTMLElement[] {
    const language = options.language();
    const { creatures, active } = state.view.team;
    const choices = creatures.map((creature, index) => {
      const resting = creature.hp === 0;
      const out = index === active && !resting;
      const choice = button('battle-choice', '', () => choose({ type: 'battle.switch', payload: { index } }));
      choice.append(...creatureSummary(creature, language, { labelled: true }));
      if (resting || out) choice.append(el('span', { className: 'tag', text: t(resting ? 'battle.resting' : 'battle.out') }));
      choice.disabled = resting || out;
      return el('li', {}, [choice]);
    });
    const parts: HTMLElement[] = [el('ul', { className: 'battle-choices' }, choices)];
    if (!state.view.mustSwap) parts.push(button('secondary battle-back', t('battle.back'), () => options.pick('menu')));
    return parts;
  }

  function treatPicker(): HTMLElement[] {
    const language = options.language();
    const treats = (options.progress()?.inventory ?? []).filter((entry) => isTreat(entry.item) && entry.count > 0);
    const choices = treats.map((entry) => {
      const choice = button('battle-choice treat-choice', '', () => choose({ type: 'battle.treat', payload: { itemId: entry.item } }));
      choice.append(el('span', { className: 'treat-name', text: itemName(entry.item, language) }), el('span', { className: 'treat-count', text: String(entry.count) }));
      return el('li', {}, [choice]);
    });
    const parts: HTMLElement[] = [el('p', { className: 'battle-heading', text: t('battle.treats') })];
    parts.push(treats.length > 0 ? el('ul', { className: 'battle-choices' }, choices) : el('p', { className: 'hint centred', text: t('refused.noItem') }));
    parts.push(button('secondary battle-back', t('battle.back'), () => options.pick('menu')));
    return parts;
  }

  function result(state: BattleScreenState): HTMLElement[] {
    if (!state.result) return [];
    const lines = resultLines(state.result, state.befriended, state.view).map((line) => el('li', { text: lineText(line, state.view, options.language()) }));
    return [el('ul', { className: 'battle-result' }, lines), button('primary battle-continue', t('battle.continue'), () => options.close())];
  }

  function panel(state: BattleScreenState): HTMLElement[] {
    switch (state.panel) {
      case 'menu':
        return menu(state);
      case 'team':
        return teamPicker(state);
      case 'treats':
        return treatPicker();
      case 'result':
        return result(state);
      default:
        return [];
    }
  }

  function build(state: BattleScreenState) {
    const { view } = state;
    const mine = view.team.creatures.find((creature) => creature.id === state.shown.active[0]);
    const foe = view.opponent.creatures.find((creature) => creature.id === state.shown.active[1]);
    const top = el('div', { className: 'battle-top' }, [card('foe', foe, foe ? (state.shown.hp[foe.id] ?? foe.hp) : 0), weatherBadge(state.shown.weather, options.language())]);
    field = el('div', { className: 'battle-field' }, [top, card('mine', mine, mine ? (state.shown.hp[mine.id] ?? mine.hp) : 0)]);
    const line = el('p', { className: 'battle-line', text: state.line ? lineText(state.line, view, options.language()) : '', attrs: { 'aria-live': 'polite' } });
    line.hidden = state.panel === 'result';
    const below = el('div', { className: 'battle-panel', attrs: { 'data-panel': state.panel ?? 'playing' } }, panel(state));
    root.replaceChildren(field, el('div', { className: 'battle-bottom' }, [line, below]));
  }

  return {
    render: (state) => {
      current = state;
      root.hidden = state === null;
      if (!state) {
        shown = '';
        field = null;
        return;
      }
      root.setAttribute('aria-busy', String(state.waiting));
      const inventory = state.panel === 'treats' ? options.progress()?.inventory : null;
      const key = JSON.stringify([options.language(), state.view, state.shown, state.line, state.panel, state.result, state.befriended, inventory]);
      if (key === shown) return;
      shown = key;
      build(state);
    },
    field: () => field?.getBoundingClientRect() ?? null,
  };
}
