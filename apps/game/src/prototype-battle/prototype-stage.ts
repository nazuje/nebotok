import type { Language } from '@nebotok/core';
import { AUTO, Game, Scale } from 'phaser';
import { el } from '../dom.ts';
import { ArenaScene, type ArenaLayout } from './prototype-arena.ts';
import { createLog, newBattleButton, type BattleLog } from './prototype-log.ts';
import { topBar, type Settings } from './prototype-toggles.ts';

/** What every look but "Today" shares: the arena, the bar along the top, the bottom for the controls and the log. */
export type Stage = { readonly game: Game; readonly arena: ArenaScene; readonly log: BattleLog; readonly bottom: HTMLElement };

export type StageOptions = {
  readonly language: Language;
  readonly layout: ArenaLayout;
  readonly energy: boolean;
  /** The class for the bottom area, which lays out the controls. */
  readonly controls: string;
  readonly settings: Settings;
  newBattle(): void;
};

export async function mountStage(root: HTMLElement, options: StageOptions): Promise<Stage> {
  const log = createLog(options.language);
  const world = el('div', { attrs: { id: 'world', 'aria-hidden': 'true' } });
  const top = topBar(log.button, options.settings, newBattleButton(options.newBattle));
  const bottom = el('div', { className: `proto-bottom ${options.controls}` });
  root.append(world, top, bottom, log.panel);
  const arena = new ArenaScene({
    layout: options.layout,
    energy: options.energy,
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
  return { game, arena, log, bottom };
}
