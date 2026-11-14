import type { Language } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import { el } from '../dom.ts';
import { ArenaScene, type Judgement, type RingKind } from './prototype-arena.ts';
import { moveButtons, moveCards } from './prototype-controls.ts';
import { createLog, newBattleButton } from './prototype-log.ts';
import { movePower, newBattle, type Side } from './prototype-sim.ts';
import { pause, playTurn, type BeforeStrike } from './prototype-turn.ts';

export type PlayOptions = {
  readonly seed: number;
  readonly language: Language;
  readonly layout: 'duel' | 'wheel';
  readonly controls: 'buttons' | 'cards';
  /** Variant 2: a shrinking ring to tap on before each damaging move. */
  readonly timed: boolean;
  newBattle(): void;
};

/** How long the ring takes to reach the inner circle, and how far off a tap may be. Generous, for small hands. */
export const RING_MS = 1_000;
export const PERFECT_MS = 110;
export const GOOD_MS = 380;
/** A tap this much earlier than the good window is taken as a stray tap and ignored. */
const IGNORE_EARLY_MS = 300;
const JUDGED_PAUSE_MS = 200;

/** Waits for a tap or Space while the ring shrinks, and judges how close it came. */
function timedTap(arena: ArenaScene, kind: RingKind): Promise<Judgement> {
  const target = arena.startRing(kind, RING_MS, PERFECT_MS);
  return new Promise((resolve) => {
    const finish = (judgement: Judgement) => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
      clearTimeout(timer);
      arena.stopRing();
      resolve(judgement);
    };
    const judge = () => {
      const off = performance.now() - target;
      if (off < -GOOD_MS - IGNORE_EARLY_MS) return;
      const distance = Math.abs(off);
      finish(distance <= PERFECT_MS ? 'perfect' : distance <= GOOD_MS ? 'good' : 'miss');
    };
    const onPointer = () => judge();
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return;
      event.preventDefault();
      judge();
    };
    const timer = setTimeout(() => finish('miss'), RING_MS + GOOD_MS);
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
  });
}

function timedBefore(arena: ArenaScene): BeforeStrike {
  return async (side: Side, move: string) => {
    if (movePower(move) === 0) return { multiplier: 1, shielded: false };
    const kind: RingKind = side === 0 ? 'aim' : 'shield';
    const judgement = await timedTap(arena, kind);
    arena.showJudgement(judgement, kind);
    await pause(JUDGED_PAUSE_MS);
    if (side === 0) return { multiplier: judgement === 'perfect' ? 1.5 : judgement === 'good' ? 1 : 0.75, shielded: false };
    return judgement === 'miss' ? { multiplier: 1, shielded: false } : { multiplier: 0.5, shielded: true };
  };
}

/** Variants 1 to 3: the fast arena with no narration, a log for readers, and picture moves. */
export async function mountPlay(root: HTMLElement, options: PlayOptions): Promise<void> {
  const battle = newBattle(options.seed);
  const log = createLog(options.language);
  const world = el('div', { attrs: { id: 'world', 'aria-hidden': 'true' } });
  const top = el('div', { className: 'proto-top' }, [log.button, newBattleButton(options.newBattle)]);
  const bottom = el('div', { className: `proto-bottom ${options.controls}` });
  root.append(world, top, bottom, log.panel);
  const arena = new ArenaScene({
    layout: options.layout,
    field: () => ({ top: top.getBoundingClientRect().bottom + 4, bottom: bottom.getBoundingClientRect().top - 4 }),
  });
  const game = new Game({
    type: AUTO,
    parent: world,
    pixelArt: true,
    backgroundColor: '#8fd3ff',
    banner: false,
    audio: { noAudio: true },
    scale: { mode: Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    scene: [arena],
  });
  await arena.ready;
  arena.show(battle);
  const before = options.timed ? timedBefore(arena) : undefined;
  let busy = false;
  const pick = async (slot: number) => {
    if (busy || battle.winner !== null) return;
    busy = true;
    controls.setBusy(true);
    document.body.dataset.turn = 'playing';
    await playTurn(battle, arena, slot, log, before);
    busy = false;
    document.body.dataset.turn = battle.winner === null ? 'idle' : 'over';
    controls.settle();
    controls.setBusy(battle.winner !== null);
  };
  const onPick = (slot: number) => void pick(slot);
  const controls = options.controls === 'cards' ? moveCards(battle, options.language, onPick) : moveButtons(battle, options.language, onPick);
  bottom.append(controls.element);
  document.body.dataset.turn = 'idle';
  Object.assign(window, { __prototype: { game, battle, arena } });
}
