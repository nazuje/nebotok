import type { BattleView } from '@nebotok/core';
import { resultKind, resultLines, type BattleScreenState, type ResultKind } from './battle-model.ts';
import type { Effect } from './battle-playback.ts';
import type { SoundPlayer } from './sound.ts';
import { battleEndSound } from './sounds-world.ts';

/**
 * The sounds of a turn battle, until arena fights replace them: a hit and a faint as their step
 * plays on the field, and one sound as the result goes up: a befriending's hearts or a level up
 * (sounds-world.ts `battleEndSound`), else a win or a loss. A run and a battle that is simply over
 * have none.
 */

const STEP_SOUNDS: Partial<Readonly<Record<Effect['kind'], string>>> = { hit: 'battle.hit', faint: 'battle.faint' };
const RESULT_SOUNDS: Partial<Readonly<Record<ResultKind, string>>> = { won: 'battle.win', fainted: 'battle.lose' };

/** Every sound a turn battle can play, for the test that each has its recipe. */
export const BATTLE_SOUND_IDS: readonly string[] = [...new Set([...Object.values(STEP_SOUNDS), ...Object.values(RESULT_SOUNDS)])];

export const battleStepSound = (effect: Effect | null): string | null => (effect ? (STEP_SOUNDS[effect.kind] ?? null) : null);
export const battleResultSound = (kind: ResultKind): string | null => RESULT_SOUNDS[kind] ?? null;

/** Plays the sounds of the battle screen's state, given each frame: each step's once, and each battle's result once. */
export function createBattleSounds(sound: Pick<SoundPlayer, 'play'>): (state: BattleScreenState | null) => void {
  let step: string | null = null;
  let ended: BattleView['id'] | null = null;
  return (state) => {
    const key = state?.step?.key ?? null;
    const id = state?.step && key !== step ? battleStepSound(state.step.effect) : null;
    if (id) sound.play(id);
    step = key;
    if (state?.panel !== 'result' || !state.result || ended === state.view.id) return;
    ended = state.view.id;
    const result = battleEndSound(state.result, state.befriended, state.view) ?? battleResultSound(resultKind(resultLines(state.result, state.befriended, state.view)[0]));
    if (result) sound.play(result, 'keep');
  };
}
