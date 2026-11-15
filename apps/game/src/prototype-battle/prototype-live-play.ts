import type { Language } from '@nebotok/core';
import { ATTACK_LEAD_MS, type ArenaScene } from './prototype-arena.ts';
import { actionButton, moveButtons, type ActionButton, type MoveControls } from './prototype-controls.ts';
import type { BattleLog } from './prototype-log.ts';
import { LIVE, LIVE_EASIER, LIVE_NORMAL, LiveDuel, measureLive, simulateLive, type WindUp } from './prototype-live.ts';
import { newBattle, type Strike } from './prototype-sim.ts';
import { mountStage } from './prototype-stage.ts';
import type { Settings } from './prototype-toggles.ts';

export type LiveOptions = { readonly seed: number; readonly language: Language; readonly settings: Settings; newBattle(): void };

const EMPOWERED_COLOUR = 0xffd43b;
const SWIPE_PX = 40;
const SWIPE_MS = 500;

type Live = { readonly duel: LiveDuel; readonly arena: ArenaScene; readonly log: BattleLog; readonly controls: MoveControls; readonly dodge: ActionButton; finished: boolean };

async function finish(live: Live, result: Strike | null): Promise<void> {
  if (!result) return;
  live.log.strike(live.duel.battle, result);
  if (!result.fainted || live.finished) return;
  live.finished = true;
  live.arena.stopRing();
  live.arena.endWindUp(1);
  document.body.dataset.turn = 'over';
  live.controls.setBusy(true);
  live.controls.setCooldowns([]);
  live.dodge.element.disabled = true;
  live.dodge.setCooldown(0);
  await live.arena.playFaint(result.side === 0 ? 1 : 0);
  live.arena.crown(result.side);
}

/** The wild creature's attack: "!" and a lean back, the dodge ring closing on you, then the hit. */
function theirAttack(live: Live, windup: WindUp): void {
  const { arena, duel } = live;
  const now = performance.now();
  arena.windUp(1, windup.impact - now);
  arena.startRing('shield', windup.impact - now, duel.tuning.perfectMs);
  setTimeout(
    () => {
      if (live.finished) return;
      arena.endWindUp(1);
      void arena
        .playAttack({
          side: 1,
          move: windup.move,
          land: () => {
            arena.stopRing();
            const landed = duel.landTheirs(performance.now());
            if (duel.lastDodge === 'good') arena.showJudgement('good', 'shield');
            return landed;
          },
        })
        .then((result) => finish(live, result));
    },
    Math.max(0, windup.impact - now - ATTACK_LEAD_MS),
  );
}

function useMove(live: Live, slot: number): void {
  const { duel, arena } = live;
  if (live.finished || !duel.use(slot, performance.now())) return;
  const move = duel.battle.fighters[0].moves[slot] ?? '';
  void arena.playAttack({ side: 0, move, land: () => duel.landYours(slot, performance.now()) }).then((result) => finish(live, result));
}

function dodge(live: Live): void {
  if (!live.finished && live.duel.dodge(performance.now())) live.arena.dodgeHop(0);
}

/** Space dodges, 1 to 4 use a move, and a quick swipe up anywhere on the field dodges too. */
function listen(live: Live, world: HTMLElement): void {
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      dodge(live);
      return;
    }
    const slot = Number.parseInt(event.key, 10) - 1;
    if (slot >= 0 && slot < live.duel.battle.fighters[0].moves.length) useMove(live, slot);
  });
  let from: { y: number; at: number } | null = null;
  world.addEventListener('pointerdown', (event) => {
    from = { y: event.clientY, at: performance.now() };
  });
  world.addEventListener('pointermove', (event) => {
    if (from && from.y - event.clientY > SWIPE_PX && performance.now() - from.at < SWIPE_MS) {
      from = null;
      dodge(live);
    }
  });
  world.addEventListener('pointerup', () => {
    from = null;
  });
}

function frame(live: Live): void {
  const { duel, arena, controls } = live;
  const now = performance.now();
  const { windup, weatherEnded } = duel.tick(now);
  if (weatherEnded) {
    arena.setWeather(null);
    live.log.line('battle.weatherEnded');
  }
  if (windup && !live.finished) theirAttack(live, windup);
  arena.setEnergy(0, duel.energy[0], false);
  arena.setEnergy(1, duel.energy[1], false);
  controls.setEnergy(duel.energy[0]);
  controls.setCooldowns(duel.battle.fighters[0].moves.map((_, slot) => duel.cooldownLeft(slot, now)));
  live.dodge.setCooldown(duel.dodgeLeft(now));
  if (!live.finished) {
    arena.setAura(0, duel.empowered ? EMPOWERED_COLOUR : null);
    arena.setMark(0, duel.empowered ? 'star' : null);
    requestAnimationFrame(() => frame(live));
  }
}

/** Variant 5, "Live duel": real time, no turns. Moves cool down, energy flows in, and you dodge what is coming. */
export async function mountLive(root: HTMLElement, options: LiveOptions): Promise<void> {
  const battle = newBattle(options.seed, options.settings.gap, LIVE.hpScale);
  const { game, arena, log, bottom } = await mountStage(root, { ...options, layout: 'duel', energy: true, controls: 'buttons live' });
  const duel = new LiveDuel(battle, options.settings.easier ? LIVE_EASIER : LIVE_NORMAL, performance.now());
  arena.show(battle, duel.energy);
  let live: Live | null = null;
  const controls = moveButtons(
    battle,
    options.language,
    (slot) => {
      if (live) useMove(live, slot);
    },
    { energy: true },
  );
  const dodgeButton = actionButton('dodge', 'Dodge', () => {
    if (live) dodge(live);
  });
  bottom.append(dodgeButton.element, controls.element);
  live = { duel, arena, log, controls, dodge: dodgeButton, finished: false };
  const world = root.querySelector<HTMLElement>('#world');
  if (world) listen(live, world);
  document.body.dataset.turn = 'live';
  frame(live);
  Object.assign(window, { __prototype: { game, battle, arena, duel, simulateLive, measureLive } });
}
