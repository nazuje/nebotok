import { Callbacks } from '@colyseus/sdk';
import { SERVER_MESSAGES } from '@nebotok/core';
import type { Player } from '../../server/src/world-state.ts';
import type { WorldRoom } from './connection.ts';
import type { PlayerFacts, WorldView } from './world-view.ts';

const factsOf = (player: Player): PlayerFacts => ({
  name: player.name,
  avatar: player.avatar,
  x: player.x,
  y: player.y,
  facing: player.facing,
  moving: player.moving,
  connected: player.connected,
  inBattle: player.inBattle,
  talking: player.talking,
  skill: player.skill,
});

export type FeedEvents = {
  /** The map everyone is on, whenever it is first known or changes. */
  map(id: string): void;
  /** The server could not plan a walk the player asked for. */
  refused(): void;
};

/**
 * Keeps the view model in step with a room's state, stamped with the page's clock when each
 * change arrives. Returns a function that stops listening.
 */
export function feedWorldView(room: WorldRoom, view: WorldView, events: FeedEvents): () => void {
  view.reset();
  view.setSelf(room.sessionId);
  const callbacks = Callbacks.get(room);
  const stops: (() => void)[] = [
    callbacks.listen('stepMs', (stepMs) => view.setStepMs(stepMs)),
    callbacks.listen('map', (id) => {
      if (id) events.map(id);
    }),
    callbacks.onAdd('players', (player, id) => {
      view.update(id, factsOf(player), performance.now());
      stops.push(callbacks.onChange(player, () => view.update(id, factsOf(player), performance.now())));
    }),
    callbacks.onRemove('players', (_player, id) => view.remove(id)),
    room.onMessage(SERVER_MESSAGES.walkRefused, () => {
      view.refused();
      events.refused();
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
