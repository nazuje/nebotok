import type { Language } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import { moveName, speciesName } from '../battle-content.ts';
import { creaturePortrait } from '../creature-art.ts';
import { el, icon } from '../dom.ts';
import { pictureIcon } from '../pictures.ts';
import { WILD_EASIER, WILD_SKILL, createBrain, think } from './arena-ai.ts';
import { createControls, type ArenaControls, type ButtonView } from './arena-controls.ts';
import { abilityIcon } from './arena-icons.ts';
import { ARENA, PLAYER_SPECIES, TREAT } from './arena-kits.ts';
import { stepArena } from './arena-rules.ts';
import { measureArena, simulateArena } from './arena-sim.ts';
import { createArena, healthShare, you, type Action, type ArenaState } from './arena-state.ts';
import { ArenaView, type Field } from './arena-view.ts';
import { newBattleButton } from './prototype-log.ts';
import { easierButton, gapButton, type Settings } from './prototype-toggles.ts';

/** Variant 6, "Arena": mounts the page, runs the fixed 60 Hz step from Phaser's frame, and shows the end. */

export type ArenaSetup = {
  readonly seed: number;
  readonly language: Language;
  readonly settings: Settings;
  readonly ringOut: boolean;
  readonly abilities: number;
  readonly kit: number;
  /** Reloads the page with these address changes. */
  go(changes: Readonly<Record<string, string>>): void;
};

const STEP_MS = 1000 / 60;
const RING_ON_PATH = 'M12 3a9 4 0 1 1 0 8a9 4 0 1 1 0 -8zM12 13l4 0l-4 5l-4 -5z M3 7.2v1.6a9 4 0 0 0 18 0v-1.6';
const RING_OFF_PATH = 'M12 3a9 4 0 1 1 0 8a9 4 0 1 1 0 -8zM12 5a6 2.3 0 1 0 0 4.6a6 2.3 0 1 0 0 -4.6zM3 7v10a9 4 0 0 0 18 0v-10a9 4 0 0 1 -18 0z';

function ringOutButton(setup: ArenaSetup): HTMLButtonElement {
  const on = setup.ringOut;
  const made = el('button', { className: `proto-round arena-toggle${on ? ' on' : ''}`, attrs: { type: 'button', 'aria-label': 'Ring-out', 'aria-pressed': String(on) } }, [icon(on ? RING_ON_PATH : RING_OFF_PATH)]);
  made.addEventListener('click', () => setup.go({ ringout: on ? '0' : '1' }));
  return made;
}

function abilitiesButton(setup: ArenaSetup): HTMLButtonElement {
  const pips = [1, 2, 3].map((count) => el('span', { className: `arena-pip${count <= setup.abilities ? ' on' : ''}` }));
  const made = el('button', { className: 'proto-round arena-toggle arena-count', attrs: { type: 'button', 'aria-label': `Abilities: ${setup.abilities}` } }, pips);
  made.addEventListener('click', () => setup.go({ abilities: String((setup.abilities % 3) + 1) }));
  return made;
}

/** The sheet "New battle" opens: pick which of your three creatures starts. */
function picker(setup: ArenaSetup): { sheet: HTMLElement; open(): void } {
  const choices = PLAYER_SPECIES.map((species, kit) => {
    const portrait = creaturePortrait(species);
    const made = el('button', { className: `arena-pick${kit === setup.kit ? ' current' : ''}`, attrs: { type: 'button', 'aria-label': speciesName(species, setup.language) } }, [portrait]);
    made.addEventListener('click', () => setup.go({ seed: String(Math.floor(Math.random() * 1_000_000)), kit: String(kit) }));
    return made;
  });
  const close = el('button', { className: 'proto-round', attrs: { type: 'button', 'aria-label': 'Close' } }, [pictureIcon('cross', 32)]);
  const sheet = el('div', { className: 'arena-sheet', attrs: { role: 'dialog', 'aria-label': 'New battle' } }, [el('div', { className: 'arena-picks' }, choices), close]);
  sheet.hidden = true;
  close.addEventListener('click', () => {
    sheet.hidden = true;
  });
  return {
    sheet,
    open: () => {
      sheet.hidden = false;
    },
  };
}

function resultBanner(state: ArenaState): HTMLElement {
  const outcome = state.outcome;
  const won = outcome?.winner === 0;
  const picture = outcome?.how === 'befriend' ? 'heart' : won ? 'trophy' : 'puff';
  const winner = won ? you(state) : state.wild;
  const portrait = creaturePortrait(outcome?.how === 'befriend' ? state.wild.creature.species : winner.creature.species);
  return el('div', { className: `arena-result ${won ? 'won' : 'lost'} ${outcome?.how ?? ''}`, attrs: { role: 'status', 'aria-label': outcome?.how ?? '' } }, [pictureIcon(picture, 64), portrait]);
}

function buttonViews(state: ArenaState, abilities: number): Partial<Record<Action, ButtonView>> {
  const mine = you(state);
  const { tick } = state;
  const left = (readyAt: number, length: number) => (readyAt <= tick ? 0 : Math.min(1, (readyAt - tick) / length));
  const views: Partial<Record<Action, ButtonView>> = {
    dash: { cooldown: left(mine.dashReady, ARENA.dashCooldown) },
    swap: { cooldown: left(state.swapReady, ARENA.swapCooldown) },
    treat: { cooldown: 0, hidden: state.treat.state !== 'hand' || healthShare(state.wild) >= TREAT.share || state.outcome !== null },
  };
  mine.kit.forEach((ability, slot) => {
    const action = (['a0', 'a1', 'a2'] as const)[slot];
    if (action) views[action] = { cooldown: left(mine.ready[slot] ?? 0, ability.cooldown), locked: slot >= abilities };
  });
  return views;
}

/** Rebuilds the ability buttons' pictures after a swap. */
function abilityPictures(state: ArenaState, language: Language): { label: string; picture: Element }[] {
  const mine = you(state);
  return mine.kit.map((ability, slot) => ({ label: moveName(mine.moves[slot]?.id ?? '', language), picture: abilityIcon(ability.kind, mine.creature.type) }));
}

function fieldOf(rows: HTMLElement, cluster: HTMLElement): () => Field {
  return () => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const top = rows.getBoundingClientRect().bottom + 6;
    const box = cluster.getBoundingClientRect();
    if (width > height * 1.05) {
      const side = Math.max(0, width - box.left);
      return { left: side, top, right: width - side, bottom: height - 6 };
    }
    return { left: 0, top, right: width, bottom: box.top - 6 };
  };
}

type Loop = { readonly language: Language; state: ArenaState; view: ArenaView; controls: ArenaControls; holdUntil: number; carry: number; shown: boolean; stats: { steps: number; ms: number; worst: number } };

function frame(loop: Loop, root: HTMLElement, abilities: number, think1: () => ReturnType<typeof think>) {
  return (now: number, dt: number): void => {
    const { state, view, controls } = loop;
    if (now >= loop.holdUntil) loop.carry += Math.min(dt, 100);
    while (loop.carry >= STEP_MS) {
      loop.carry -= STEP_MS;
      const steer = controls.steer();
      const started = performance.now();
      stepArena(state, { mx: steer.x, my: steer.y, face: null, actions: controls.take() }, think1());
      const spent = performance.now() - started;
      loop.stats.steps += 1;
      loop.stats.ms += spent;
      loop.stats.worst = Math.max(loop.stats.worst, spent);
      const stop = view.react(state, state.events, now);
      if (state.events.some((event) => event.kind === 'swap')) swapPictures(loop, root);
      if (stop > 0) {
        loop.holdUntil = now + stop;
        loop.carry = 0;
      }
    }
    view.draw(state, now < loop.holdUntil ? 1 : loop.carry / STEP_MS, now, dt);
    controls.show(buttonViews(state, abilities));
    if (state.outcome && !loop.shown) {
      loop.shown = true;
      document.body.dataset.turn = 'over';
      setTimeout(() => root.append(resultBanner(state)), state.outcome.how === 'ringout' ? 1100 : 700);
    }
  };
}

function swapPictures(loop: Loop, root: HTMLElement): void {
  const pictures = abilityPictures(loop.state, loop.language);
  root.querySelectorAll<HTMLButtonElement>('.arena-button.a0, .arena-button.a1, .arena-button.a2').forEach((button, slot) => {
    const next = pictures[slot];
    const old = button.querySelector('canvas');
    if (!next || !old) return;
    old.replaceWith(next.picture);
    button.setAttribute('aria-label', next.label);
  });
}

export async function mountArena(root: HTMLElement, setup: ArenaSetup): Promise<void> {
  const state = createArena({ seed: setup.seed, gap: setup.settings.gap, easier: setup.settings.easier ?? false, ringOut: setup.ringOut, abilities: setup.abilities, kit: setup.kit });
  const world = el('div', { attrs: { id: 'world', 'aria-hidden': 'true' } });
  const choose = picker(setup);
  const easier = easierButton(setup.settings);
  const top = el('div', { className: 'proto-top arena-top' }, [el('div', { className: 'proto-top-left' }, [...(easier ? [easier] : []), gapButton(setup.settings), ringOutButton(setup), abilitiesButton(setup)]), newBattleButton(choose.open)]);
  const pill = document.querySelector<HTMLElement>('.proto-pill');
  const rows = el('div', { className: 'arena-rows' }, [top, el('div', { className: 'arena-row2' }, pill ? [pill] : [])]);
  const controls = createControls(abilityPictures(state, setup.language));
  root.append(world, controls.zone, rows, controls.cluster, choose.sheet);
  const view = new ArenaView(fieldOf(rows, controls.cluster));
  const game = new Game({ type: AUTO, parent: world, pixelArt: true, backgroundColor: '#8fd3ff', banner: false, audio: { noAudio: true }, scale: { mode: Scale.RESIZE, width: window.innerWidth, height: window.innerHeight }, scene: [view] });
  await view.ready;
  view.bind(state);
  const brain = createBrain(1, setup.seed, setup.settings.easier ? WILD_EASIER : WILD_SKILL);
  const loop: Loop = { language: setup.language, state, view, controls, holdUntil: 0, carry: 0, shown: false, stats: { steps: 0, ms: 0, worst: 0 } };
  view.onFrame = frame(loop, root, setup.abilities, () => think(state, brain));
  document.body.dataset.turn = 'live';
  Object.assign(window, { __prototype: { game, state, view, controls, loop, simulateArena, measureArena, createArena } });
}
