import type { Language, ProgressMessage, StringId } from '@nebotok/core';
import { STARTERS, speciesName, speciesType } from './battle-content.ts';
import type { ClientMessage } from './battle-link.ts';
import { typeChip } from './creature-card.ts';
import { creaturePortrait } from './creature-art.ts';
import { button, el } from './dom.ts';
import { text } from './strings.ts';

export type StarterScreen = {
  /** Shows the choice while `progress` says the player needs a starter. */
  render(progress: ProgressMessage | null): void;
  isOpen(): boolean;
  /** The species chosen and not yet confirmed by the server, if any. */
  chosen(): string | null;
};

/** A new player's first visit: one of three starters from content/starters.json, each a big button. */
export function createStarterScreen(root: HTMLElement, options: { language(): Language; send(message: ClientMessage): void }): StarterScreen {
  const t = (id: StringId) => text(id, options.language());
  let open = false;
  let chosen: string | null = null;
  let shown = '';

  function build() {
    const language = options.language();
    const choices = STARTERS.species.map((species) => {
      const choice = button('starter-choice', '', () => {
        if (chosen) return;
        chosen = species;
        root.setAttribute('aria-busy', 'true');
        options.send({ type: 'starter.choose', payload: { species } });
      });
      choice.append(creaturePortrait(species), el('span', { className: 'creature-name', text: speciesName(species, language) }), typeChip(speciesType(species), language));
      return el('li', {}, [choice]);
    });
    root.replaceChildren(el('div', { className: 'screen-body' }, [el('h2', { className: 'screen-title', text: t('starter.title') }), el('p', { className: 'hint centred', text: t('starter.hint') }), el('ul', { className: 'starter-list' }, choices)]));
  }

  return {
    render: (progress) => {
      const next = progress?.needsStarter === true;
      if (!next) chosen = null;
      open = next;
      root.hidden = !open;
      root.setAttribute('aria-busy', String(chosen !== null));
      if (!open) {
        shown = '';
        return;
      }
      const key = JSON.stringify([options.language(), progress]);
      if (key === shown) return;
      shown = key;
      build();
    },
    isOpen: () => open,
    chosen: () => chosen,
  };
}
