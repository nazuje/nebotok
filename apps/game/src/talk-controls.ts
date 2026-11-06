import { samePoint, type Point } from '@nebotok/core';
import type { InputDeps } from './input.ts';
import { facedNpc, npcAt, talkSpot } from './talk.ts';
import type { Talks } from './talks.ts';
import type { WorldView } from './world-view.ts';

/** What input needs to walk up to characters and talk to them, from the world view and the talks. */
export function talkControls(view: WorldView, talks: Talks): Pick<InputDeps, 'npcAt' | 'talkSpot' | 'standsOn' | 'talk'> {
  /** Whether your courier stands still on `tile`, as this page predicts and as the server last said. */
  const standsOn = (tile: Point): boolean => {
    const predicted = view.predicted();
    const server = view.shown(performance.now()).find((player) => player.self);
    return predicted !== null && server !== undefined && predicted.intent === 'idle' && !predicted.moving && !server.moving && samePoint(predicted.tile, tile) && samePoint(server.tile, tile);
  };
  return {
    npcAt: (tile) => {
      const map = view.standing()?.map;
      return map ? npcAt(map, tile) : null;
    },
    talkSpot: (npc) => {
      const map = view.standing()?.map;
      const from = view.predicted()?.tile;
      return map && from ? talkSpot(map, from, npc, (tile) => view.canReach(tile)) : null;
    },
    standsOn,
    talk: (npc) => {
      const predicted = view.predicted();
      const map = view.standing()?.map;
      if (!predicted || !map) return;
      // Space or Enter talks only while standing still, to the character in front.
      const who = npc ?? (standsOn(predicted.tile) ? facedNpc(map, predicted.tile, predicted.facing) : null);
      if (who !== null) talks.start(who);
    },
  };
}
