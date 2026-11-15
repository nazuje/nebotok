import type { Language, StringId } from '@nebotok/core';
import { moveName, speciesName, weatherName } from '../battle-content.ts';
import { button, el, icon } from '../dom.ts';
import { format } from '../strings.ts';
import type { ProtoBattle, Strike } from './prototype-sim.ts';

const LINES_PATH = 'M4 5h16v2.5h-16zM4 10.75h16v2.5h-16zM4 16.5h11v2.5h-11z';
const CLOSE_PATH = 'M6.4 4.6l5.6 5.6l5.6-5.6l1.8 1.8l-5.6 5.6l5.6 5.6l-1.8 1.8l-5.6-5.6l-5.6 5.6l-1.8-1.8l5.6-5.6l-5.6-5.6z';

export type BattleLog = {
  /** The small button that opens the log. */
  readonly button: HTMLButtonElement;
  readonly panel: HTMLElement;
  line(id: StringId, values?: Readonly<Record<string, string | number>>): void;
  strike(battle: ProtoBattle, strike: Strike): void;
};

/** A text log of the battle for readers, closed by default: the battle itself never waits for it. */
export function createLog(language: Language): BattleLog {
  const list = el('ol', { className: 'proto-log-lines' });
  const close = el('button', { className: 'proto-round', attrs: { type: 'button', 'aria-label': 'Close log' } }, [icon(CLOSE_PATH)]);
  const panel = el('section', { className: 'proto-log', attrs: { 'aria-label': 'Battle log' } }, [close, list]);
  panel.hidden = true;
  const open = el('button', { className: 'proto-round', attrs: { type: 'button', 'aria-label': 'Battle log' } }, [icon(LINES_PATH)]);
  open.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    list.lastElementChild?.scrollIntoView({ block: 'end' });
  });
  close.addEventListener('click', () => {
    panel.hidden = true;
  });
  const add = (words: string) => {
    list.append(el('li', { text: words }));
    list.lastElementChild?.scrollIntoView({ block: 'end' });
  };
  const line = (id: StringId, values: Readonly<Record<string, string | number>> = {}) => add(format(id, language, values));
  return {
    button: open,
    panel,
    line,
    strike: (battle, strike) => {
      const attacker = battle.fighters[strike.side];
      const target = battle.fighters[strike.side === 0 ? 1 : 0];
      line('battle.used', { creature: speciesName(attacker.species, language), move: moveName(strike.move, language) });
      if (strike.missed) return line('battle.missed');
      if (strike.damage > 0) add(`${speciesName(target.species, language)} −${strike.damage}${strike.critical ? ' ★' : ''}`);
      if (strike.effectiveness === 'strong' && strike.damage > 0) line('battle.strong');
      if (strike.effectiveness === 'weak' && strike.damage > 0) line('battle.weak');
      if (strike.weather) line('battle.weather', { weather: weatherName(strike.weather, language) });
      if (strike.fainted) line('battle.fainted', { creature: speciesName(target.species, language) });
      return undefined;
    },
  };
}

/** The button that starts a new battle with a new pair of creatures. */
export function newBattleButton(onTap: () => void): HTMLButtonElement {
  const made = button('proto-new', '', onTap);
  made.setAttribute('aria-label', 'New battle');
  made.append(icon('M12 4a8 8 0 1 1 -7.4 5h2.7a5.5 5.5 0 1 0 4.7 -2.5v3l-5 -4.25l5 -4.25z'), el('span', { text: 'New battle' }));
  return made;
}
