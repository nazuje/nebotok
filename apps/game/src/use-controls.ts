import { samePoint, type Point } from '@nebotok/core';
import type { InputDeps } from './input.ts';
import type { Skills } from './skills-link.ts';
import { facedTarget, standBeside, targetAt, targetTile } from './talk.ts';
import type { Talks } from './talks.ts';
import type { WorldView } from './world-view.ts';

/** What input needs to walk up to characters, spots and stations and use them, from the world view, the talks and the skills. */
export function useControls(view: WorldView, talks: Talks, skills: Skills): Pick<InputDeps, 'targetAt' | 'standFor' | 'standsOn' | 'use'> {
  /** Whether your courier stands still on `tile`, as this page predicts and as the server last said. */
  const standsOn = (tile: Point): boolean => {
    const predicted = view.predicted();
    const server = view.shown(performance.now()).find((player) => player.self);
    return predicted !== null && server !== undefined && predicted.intent === 'idle' && !predicted.moving && !server.moving && samePoint(predicted.tile, tile) && samePoint(server.tile, tile);
  };
  return {
    targetAt: (tile) => {
      const map = view.standing()?.map;
      return map ? targetAt(map, tile) : null;
    },
    standFor: (target) => {
      const map = view.standing()?.map;
      const from = view.predicted()?.tile;
      const at = map ? targetTile(map, target) : null;
      return map && from && at ? standBeside(map, from, at, (tile) => view.canReach(tile)) : null;
    },
    standsOn,
    use: (target) => {
      const predicted = view.predicted();
      const map = view.standing()?.map;
      if (!predicted || !map) return;
      // Space or Enter works only while standing still, on what is in front.
      const what = target ?? (standsOn(predicted.tile) ? facedTarget(map, predicted.tile, predicted.facing) : null);
      if (what?.kind === 'npc') talks.start(what.id);
      else if (what?.kind === 'spot') skills.gather(what.id);
      else if (what?.kind === 'station') skills.useStation(what.id);
    },
  };
}
