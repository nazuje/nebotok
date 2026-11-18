import { DIGIT_FRAMES, type Language, type ProgressMessage, type StringId, type TeamCreature } from '@nebotok/core';
import { CONTENT, moveName, moveType, speciesName } from './battle-content.ts';
import type { ClientMessage } from './battle-link.ts';
import { creaturePortrait } from './creature-art.ts';
import { button, el, pictureButton } from './dom.ts';
import { buttonFor, buttonTiles, chosenLoadout, offeredMoves, powerPips, tappedButton, type ButtonTile } from './loadout-model.ts';
import { moveArena } from './move-arena.ts';
import { abilityIcon, pictureIcon } from './pictures.ts';
import { ANSWER_MS } from './request-pacer.ts';
import { createShapePreview } from './shape-preview.ts';
import { speakerButton } from './speaker-button.ts';
import { format, text } from './strings.ts';

export type LoadoutPickerOptions = {
  language(): Language;
  progress(): ProgressMessage | null;
  send(message: ClientMessage): void;
  /** "Read to me" is on, so each move shows a speaker that reads its name. */
  readToMe(): boolean;
  /** Reads `words` aloud in the narrator's voice; `canSay` tells whether they have a clip. */
  say(words: string): void;
  canSay(words: string): boolean;
  /** The player closed the picker. */
  closed(): void;
};

/** What the browser check reads: the creature, the button shown, the moves offered for it, a change waiting for the server and the move being tried. */
export type LoadoutPickerState = {
  readonly index: number;
  readonly species: string | null;
  readonly button: number;
  readonly loadout: readonly (string | null)[];
  readonly offered: readonly string[];
  readonly pending: string | null;
  readonly saved: boolean;
  readonly trying: string | null;
};

export type LoadoutPicker = {
  /** Opens on the team creature at `index`, on the button `move` would go on, when given. */
  open(index: number, move?: string | null): void;
  /** Closes without telling `closed`, as when a battle starts. */
  close(): void;
  isOpen(): boolean;
  render(now: number): void;
  /** The server refused the change asked for, so the picker shows the loadout as it is. */
  refused(): void;
  state(): LoadoutPickerState | null;
};

/** A press this long on a move plays it on the mini island instead of choosing it. */
export const HOLD_MS = 400;
/** How long "Saved" stays after the server's answer. */
export const SAVED_MS = 2_000;

/** A number as the picture kit's digits, such as a locked button's level. */
function digits(value: number, sizePx: number): HTMLElement {
  return el(
    'span',
    { className: 'loadout-digits', attrs: { 'aria-hidden': 'true' } },
    [...String(value)].flatMap((digit) => {
      const frame = DIGIT_FRAMES[Number(digit)];
      return frame === undefined ? [] : [pictureIcon('digits', sizePx, { frame })];
    }),
  );
}

function pips(count: number, language: Language): HTMLElement {
  const row = el('span', { className: 'loadout-pips', attrs: { role: 'img', 'aria-label': format('loadout.power', language, { pips: count }), 'data-pips': String(count) } });
  for (let pip = 0; pip < 3; pip += 1) row.append(el('span', { className: pip < count ? 'loadout-pip on' : 'loadout-pip' }));
  return row;
}

/**
 * A creature's three arena buttons as big tiles, and under the button tapped the moves it has
 * learned of that button's kind, so no wrong choice is offered. Tapping one asks the server to put
 * it there (`loadout.set`); the tile shows the change at once and "Saved" once the server's
 * progress has it. A locked button shows the lock and its level, and a tap on it does nothing.
 * Holding a move plays its shape on a mini island. Sits over the team screen it was opened from.
 */
export function createLoadoutPicker(root: HTMLElement, options: LoadoutPickerOptions): LoadoutPicker {
  const t = (id: StringId) => text(id, options.language());
  let index: number | null = null;
  let shown = 0;
  let pending: { button: number; move: string; sentAt: number } | null = null;
  let savedUntil = 0;
  let key = '';
  let holding: ReturnType<typeof setTimeout> | undefined;
  let tried = false;

  const canvas = el('canvas', { className: 'loadout-island', attrs: { role: 'img', 'aria-label': t('loadout.try') } });
  const previewPanel = el('div', { className: 'loadout-preview', attrs: { 'aria-hidden': 'true' } }, [canvas]);
  previewPanel.hidden = true;
  const preview = createShapePreview(canvas);

  const creature = (): TeamCreature | null => (index === null ? null : (options.progress()?.team[index] ?? null));
  /** The loadout as the picker shows it: the server's, with a change on its way already in place. */
  const shownLoadout = (of: TeamCreature) => (pending ? of.loadout.map((id, at) => (at === pending?.button ? pending.move : id)) : of.loadout);

  function stopTrying() {
    clearTimeout(holding);
    holding = undefined;
    preview.stop();
    previewPanel.hidden = true;
  }

  function tryMove(move: string) {
    tried = true;
    previewPanel.hidden = false;
    preview.play(move);
  }

  function choose(move: string) {
    const of = creature();
    if (!of || index === null || pending) return;
    const loadout = chosenLoadout(of, shown, move, CONTENT);
    if (!loadout) return;
    pending = { button: shown, move, sentAt: performance.now() };
    savedUntil = 0;
    options.send({ type: 'loadout.set', payload: { index, loadout } });
    render(performance.now(), true);
  }

  function slot(tile: ButtonTile, language: Language): HTMLElement {
    const kind = text(`arena.kind.${tile.kind}`, language);
    const made = button(`loadout-slot${tile.locked ? ' locked' : ''}`, '', () => {
      const of = creature();
      if (!of) return;
      const next = tappedButton(of, shown, tile.button, CONTENT);
      if (next === shown) return;
      shown = next;
      render(performance.now(), true);
    });
    made.dataset.button = String(tile.button);
    made.setAttribute('aria-pressed', String(!tile.locked && tile.button === shown));
    if (tile.locked) {
      const level = tile.unlocksAt ?? 0;
      made.setAttribute('aria-disabled', 'true');
      made.setAttribute('aria-label', `${kind}: ${format('arena.locked', language, { level })}`);
      made.append(pictureIcon('lock', 32), digits(level, 24));
      return made;
    }
    const move = tile.move;
    made.setAttribute('aria-label', `${kind}: ${move === null ? t('loadout.empty') : moveName(move, language)}`);
    made.append(move === null ? el('span', { className: 'loadout-empty' }) : abilityIcon(move, 48), digits(tile.button + 1, 16));
    return made;
  }

  function moveTile(move: string, equipped: boolean, language: Language): HTMLElement {
    const name = moveName(move, language);
    const arena = moveArena(move);
    const tile = button(`loadout-move type-${moveType(move) ?? 'none'}`, '', () => {
      if (tried) {
        tried = false;
        return;
      }
      choose(move);
    });
    tile.dataset.move = move;
    tile.setAttribute('aria-pressed', String(equipped));
    if (pending?.move === move) tile.setAttribute('aria-busy', 'true');
    const words = el('span', { className: 'loadout-move-words' }, [el('span', { className: 'loadout-move-name', text: name })]);
    if (arena) words.append(el('span', { className: 'loadout-move-shape', text: text(`arena.shape.${arena.shape}`, language) }));
    tile.append(abilityIcon(move, 48), words, pips(powerPips(CONTENT.moves.get(move)?.power ?? 0), language));
    if (equipped) tile.append(pictureIcon('check', 32, { className: 'loadout-chosen' }));
    tile.addEventListener('pointerdown', () => {
      tried = false;
      clearTimeout(holding);
      holding = setTimeout(() => tryMove(move), HOLD_MS);
    });
    tile.addEventListener('contextmenu', (event) => event.preventDefault());
    const parts: HTMLElement[] = [tile];
    if (options.readToMe() && options.canSay(name)) parts.push(speakerButton('loadout-say', name, () => options.say(name)));
    return el('li', { className: 'loadout-move-row' }, parts);
  }

  function build(of: TeamCreature, saved: boolean) {
    const language = options.language();
    const loadout = shownLoadout(of);
    const tiles = buttonTiles({ ...of, loadout: [loadout[0] ?? null, loadout[1] ?? null, loadout[2] ?? null] }, CONTENT);
    const kind = tiles[shown]?.kind ?? 'quick';
    const head = el('div', { className: 'loadout-head' }, [
      creaturePortrait(of.species),
      el('div', { className: 'loadout-who' }, [
        el('h2', { className: 'screen-title', text: t('loadout.title') }),
        el('span', { className: 'creature-name', text: `${speciesName(of.species, language)} · ${format('battle.level', language, { level: of.level })}` }),
      ]),
    ]);
    const moves = offeredMoves(of, shown, CONTENT).map((move) => moveTile(move, loadout[shown] === move, language));
    const answer = el('p', { className: 'loadout-answer', attrs: { role: 'status', 'aria-live': 'polite' } });
    if (saved) answer.append(pictureIcon('check', 32), el('span', { text: t('loadout.saved') }));
    const done = pictureButton('primary loadout-done', pictureIcon('check', 32), t('loadout.done'), () => {
      close();
      options.closed();
    });
    root.replaceChildren(
      el('div', { className: 'screen-body loadout-body' }, [
        head,
        el('p', { className: 'hint centred', text: t('loadout.hint') }),
        el('div', { className: 'loadout-slots', attrs: { role: 'group', 'aria-label': t('loadout.title') } }, tiles.map((tile) => slot(tile, language))),
        el('h3', { className: 'loadout-kind', text: text(`arena.kind.${kind}`, language) }),
        el('ul', { className: 'loadout-moves' }, moves),
        answer,
        done,
      ]),
      previewPanel,
    );
  }

  /** Settles a change on its way: done once the server's progress has it, given up after ANSWER_MS. */
  function settle(of: TeamCreature, now: number) {
    if (!pending) return;
    if (of.loadout[pending.button] === pending.move) {
      pending = null;
      savedUntil = now + SAVED_MS;
    } else if (now - pending.sentAt > ANSWER_MS) pending = null;
  }

  function render(now: number, force = false) {
    root.hidden = index === null;
    const of = creature();
    if (index === null) return;
    if (!of) {
      close();
      options.closed();
      return;
    }
    settle(of, now);
    const saved = now < savedUntil;
    const next = JSON.stringify([options.language(), options.readToMe(), of, shown, pending?.move ?? null, saved]);
    if (!force && next === key) return;
    key = next;
    build(of, saved);
  }

  function close() {
    stopTrying();
    index = null;
    pending = null;
    savedUntil = 0;
    key = '';
    root.hidden = true;
    root.replaceChildren();
  }

  // A hold ends wherever the finger lifts, even after the tile under it was redrawn.
  for (const type of ['pointerup', 'pointercancel'] as const) window.addEventListener(type, stopTrying);
  root.hidden = true;

  return {
    open: (at, move = null) => {
      stopTrying();
      index = at;
      pending = null;
      savedUntil = 0;
      const of = creature();
      shown = of ? buttonFor(of, move, CONTENT) : 0;
      render(performance.now(), true);
    },
    close,
    isOpen: () => index !== null,
    render: (now) => render(now),
    refused: () => {
      pending = null;
      render(performance.now(), true);
    },
    state: () => {
      const of = creature();
      if (index === null) return null;
      return {
        index,
        species: of?.species ?? null,
        button: shown,
        loadout: of?.loadout ?? [],
        offered: of ? offeredMoves(of, shown, CONTENT) : [],
        pending: pending?.move ?? null,
        saved: performance.now() < savedUntil,
        trying: preview.playing(),
      };
    },
  };
}
