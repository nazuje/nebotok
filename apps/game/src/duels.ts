import { CLIENT_MESSAGES, DUEL_ANSWER_MS, SERVER_MESSAGES, inDuelReach, type DuelAnsweredMessage, type DuelAskedMessage, type DuelCreature, type Language, type Point, type Refused, type StringId } from '@nebotok/core';
import { levelBadge } from './arena/arena-buttons.ts';
import { avatarPortrait } from './avatars.ts';
import { speciesName } from './battle-content.ts';
import type { WorldRoom } from './connection.ts';
import { creaturePortrait } from './creature-art.ts';
import { el, pictureButton } from './dom.ts';
import { pictureIcon } from './pictures.ts';
import type { RequestPacer } from './request-pacer.ts';
import { speakerButton } from './speaker-button.ts';
import type { Speech } from './speech.ts';
import { text } from './strings.ts';
import type { ShownPlayer } from './world-view.ts';

export type DuelOverlay = 'duel';

/** The duel card up, for the test hook: the menu, your ask waiting, or an ask to answer. */
export type TestDuel = { kind: Shown['kind']; with: string; even: boolean | null; creatures: DuelCreature[]; leftMs: number };

export type DuelsOptions = {
  language(): Language;
  /** Everyone in the world as this page draws them. */
  couriers(): readonly ShownPlayer[];
  /** Your courier's tile as this page predicts it. */
  standing(): Point | null;
  requests: RequestPacer;
  speech: Pick<Speech, 'onHint' | 'say' | 'has'>;
  toast(id: StringId): void;
  /** The duel card went up or away, so the page shows another screen and input may change. */
  changed(): void;
};

export type Duels = {
  /** Listens to a joined room. Returns a function that stops. */
  joined(room: WorldRoom): () => void;
  /** Whether the server has arena fights on, from `welcome`: duels are offered only then. */
  setArena(on: boolean): void;
  /** A tap on `tile`: opens the duel menu and returns true when another courier near enough stands there. */
  tapped(tile: Point): boolean;
  /** Called every frame. */
  frame(now: number): void;
  overlay(): DuelOverlay | null;
  /** Forgets any card, as when the world is left. */
  reset(): void;
  snapshot(now: number): { duel: TestDuel | null };
};

type Shown =
  | { readonly kind: 'menu'; readonly with: string }
  | { readonly kind: 'asking'; readonly with: string; readonly even: boolean }
  | { readonly kind: 'asked'; readonly with: string; readonly even: boolean; readonly creatures: readonly DuelCreature[]; readonly until: number };

/** Whether the duel is an even match or at real levels, as a picture and words. */
const evenPicture = (even: boolean, language: Language) =>
  el('p', { className: 'duel-even' }, [pictureIcon(even ? 'even-match' : 'level-badge', 32), el('span', { text: text(even ? 'duel.evenMatch' : 'duel.realLevels', language) })]);

/**
 * Friendly duels between couriers (docs/arena.md, "Duels"; docs/protocol.md "Arena fights"). A tap
 * on another courier within DUEL_REACH tiles opens a picture menu: an even match first, then real
 * levels. The one asked gets a card with the asker's courier, their first three creatures and a
 * big tick and cross, gone after DUEL_ANSWER_MS as the server declines by itself; "Read to me"
 * reads its line. A yes starts the duel with `arena.join`, which the arena screen takes from there.
 */
export function createDuels(root: HTMLElement, options: DuelsOptions): Duels {
  let room: WorldRoom | null = null;
  let arena = false;
  let shown: Shown | null = null;
  let key = '';
  const bar = el('span', { className: 'duel-time-fill' });

  const set = (next: Shown | null) => {
    shown = next;
    options.changed();
  };
  const send = (type: string, payload: object) => {
    const to = room;
    if (to) options.requests.send(() => to.send(type, payload));
  };
  const courier = (id: string) => options.couriers().find((player) => player.id === id) ?? null;
  const portrait = (id: string) => {
    const player = courier(id);
    return player ? [avatarPortrait(player.avatar)] : [];
  };

  function ask(to: string, even: boolean) {
    send(CLIENT_MESSAGES.duelAsk, { to, even });
    set({ kind: 'asking', with: to, even });
  }

  function answer(yes: boolean) {
    send(CLIENT_MESSAGES.duelAnswer, { yes });
    set(null);
  }

  function cancel() {
    send(CLIENT_MESSAGES.duelCancel, {});
    set(null);
  }

  function menu(to: string, language: Language): Node[] {
    return [
      el('div', { className: 'duel-faces' }, [...portrait(to), pictureIcon('challenge', 48)]),
      el('h2', { className: 'duel-title', text: text('duel.challenge', language) }),
      pictureButton('primary duel-even-match', pictureIcon('even-match', 48), text('duel.evenMatch', language), () => ask(to, true)),
      pictureButton('secondary duel-real-levels', pictureIcon('level-badge', 48), text('duel.realLevels', language), () => ask(to, false)),
      pictureButton('secondary duel-close', pictureIcon('cross', 32), text('duel.close', language), () => set(null)),
    ];
  }

  function asking(to: string, even: boolean, language: Language): Node[] {
    return [
      el('div', { className: 'duel-faces' }, [...portrait(to), pictureIcon('clock', 48)]),
      el('p', { className: 'duel-line', text: text('duel.waiting', language) }),
      evenPicture(even, language),
      pictureButton('secondary duel-cancel', pictureIcon('cross', 32), text('duel.cancel', language), cancel),
    ];
  }

  function asked({ with: from, even, creatures }: Extract<Shown, { kind: 'asked' }>, language: Language): Node[] {
    const line = text('duel.asked', language);
    const team = creatures.map((creature) =>
      el('li', { className: 'duel-creature', attrs: { 'aria-label': `${speciesName(creature.species, language)}, ${levelBadge(creature.level, language)}` } }, [
        creaturePortrait(creature.species),
        el('span', { className: 'level-badge', text: String(creature.level), attrs: { 'aria-hidden': 'true' } }),
      ]),
    );
    const name = courier(from)?.name;
    return [
      el('div', { className: 'duel-faces' }, [...portrait(from), pictureIcon('challenge', 48)]),
      ...(name ? [el('p', { className: 'duel-name', text: name })] : []),
      el('p', { className: 'duel-line' }, [
        el('span', { text: line }),
        ...(options.speech.has(null, line) ? [speakerButton('duel-speaker', text('speech.play', language), () => options.speech.say(null, line))] : []),
      ]),
      el('ul', { className: 'duel-team' }, team),
      evenPicture(even, language),
      el('span', { className: 'duel-time', attrs: { 'aria-hidden': 'true' } }, [bar]),
      el('div', { className: 'duel-answers' }, [
        pictureButton('secondary duel-decline', pictureIcon('cross', 48), text('duel.decline', language), () => answer(false)),
        pictureButton('primary duel-accept', pictureIcon('check', 48), text('duel.accept', language), () => answer(true)),
      ]),
    ];
  }

  function draw(now: number) {
    const language = options.language();
    root.hidden = shown === null;
    if (shown?.kind === 'asked') bar.style.width = `${((Math.max(0, shown.until - now) / DUEL_ANSWER_MS) * 100).toFixed(1)}%`;
    const next = JSON.stringify([language, shown, shown ? (courier(shown.with)?.avatar ?? null) : null]);
    if (next === key) return;
    key = next;
    if (!shown) return root.replaceChildren();
    root.dataset.kind = shown.kind;
    root.setAttribute('aria-label', text(shown.kind === 'asked' ? 'duel.asked' : 'duel.challenge', language));
    const card = shown.kind === 'menu' ? menu(shown.with, language) : shown.kind === 'asking' ? asking(shown.with, shown.even, language) : asked(shown, language);
    root.replaceChildren(el('div', { className: 'duel-card' }, card));
    root.querySelector<HTMLElement>('.primary')?.focus();
  }

  function onAsked(message: DuelAskedMessage) {
    set({ kind: 'asked', with: message.from, even: message.even, creatures: message.creatures, until: performance.now() + DUEL_ANSWER_MS });
    options.speech.onHint(text('duel.asked', options.language()));
  }

  function onAnswered(message: DuelAnsweredMessage) {
    const was = shown;
    if (was?.kind !== 'asking' && was?.kind !== 'asked') return;
    set(null);
    if (!message.yes && was.kind === 'asking') options.toast('duel.no');
  }

  function onRefused(message: Refused) {
    // The refusal's own toast says why; the card waiting on the request goes.
    if (message.request === CLIENT_MESSAGES.duelAsk && shown?.kind === 'asking') set(null);
  }

  return {
    joined: (joined) => {
      room = joined;
      const stops = [joined.onMessage(SERVER_MESSAGES.duelAsked, onAsked), joined.onMessage(SERVER_MESSAGES.duelAnswered, onAnswered), joined.onMessage(SERVER_MESSAGES.refused, onRefused)];
      return () => {
        for (const stop of stops) stop();
        if (room === joined) room = null;
        if (shown) set(null);
      };
    },
    setArena: (on) => {
      arena = on;
    },
    tapped: (tile) => {
      const from = options.standing();
      if (!arena || !from || shown) return false;
      const other = options.couriers().find((player) => !player.self && player.connected && !player.inBattle && Math.round(player.at.x) === tile.x && Math.round(player.at.y) === tile.y);
      if (!other || !inDuelReach(from, other.tile)) return false;
      set({ kind: 'menu', with: other.id });
      return true;
    },
    frame: (now) => {
      if (shown?.kind === 'asked' && now >= shown.until) set(null);
      draw(now);
    },
    overlay: () => (shown ? 'duel' : null),
    reset: () => {
      if (shown) set(null);
    },
    snapshot: (now) => ({
      duel: shown && {
        kind: shown.kind,
        with: shown.with,
        even: shown.kind === 'menu' ? null : shown.even,
        creatures: shown.kind === 'asked' ? [...shown.creatures] : [],
        leftMs: shown.kind === 'asked' ? Math.max(0, Math.round(shown.until - now)) : 0,
      },
    }),
  };
}
