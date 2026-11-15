import type { Language } from '@nebotok/core';
import type { ArenaScene, RingKind } from './prototype-arena.ts';
import { moveButtons, moveCards } from './prototype-controls.ts';
import { movePower, newBattle, type Side } from './prototype-sim.ts';
import { mountStage } from './prototype-stage.ts';
import { easierWindows, timedTap, type Windows } from './prototype-timing.ts';
import type { Settings } from './prototype-toggles.ts';
import { pause, playTurn, type BeforeStrike } from './prototype-turn.ts';

export type PlayOptions = {
  readonly seed: number;
  readonly language: Language;
  readonly layout: 'duel' | 'wheel';
  readonly controls: 'buttons' | 'cards';
  /** Variant 2: a shrinking ring to tap on before each damaging move. */
  readonly timed: boolean;
  readonly settings: Settings;
  newBattle(): void;
};

/** Variant 2's ring: generous, for small hands. */
export const TIMED_WINDOWS: Windows = { ringMs: 1_000, perfectMs: 110, goodMs: 380 };
const JUDGED_PAUSE_MS = 200;

function timedBefore(arena: ArenaScene, windows: Windows): BeforeStrike {
  return async (side: Side, move: string) => {
    if (movePower(move) === 0) return { multiplier: 1, shielded: false };
    const kind: RingKind = side === 0 ? 'aim' : 'shield';
    const judgement = await timedTap(arena, kind, windows);
    arena.showJudgement(judgement, kind);
    await pause(JUDGED_PAUSE_MS);
    if (side === 0) return { multiplier: judgement === 'perfect' ? 1.5 : judgement === 'good' ? 1 : 0.75, shielded: false };
    return judgement === 'miss' ? { multiplier: 1, shielded: false } : { multiplier: 0.5, shielded: true };
  };
}

/** Variants 1 to 3: the fast arena with no narration, a log for readers, and picture moves. */
export async function mountPlay(root: HTMLElement, options: PlayOptions): Promise<void> {
  const battle = newBattle(options.seed, options.settings.gap);
  const { game, arena, log, bottom } = await mountStage(root, { ...options, energy: false });
  arena.show(battle);
  const windows = options.settings.easier ? easierWindows(TIMED_WINDOWS) : TIMED_WINDOWS;
  const before = options.timed ? timedBefore(arena, windows) : undefined;
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
