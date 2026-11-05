import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Config } from './config.ts';
import { mountHttp } from './http.ts';
import { colyseusLogger, type Log } from './log.ts';
import { closeMatchmakeCors, matchmakeRoutes } from './matchmake.ts';
import type { Services } from './services.ts';
import { worldRoom } from './world-room.ts';

export function createGameServer(config: Config, log: Log, services: Services) {
  closeMatchmakeCors();
  return defineServer({
    rooms: {
      world: defineRoom(worldRoom({ log, world: services.world, profiles: services.profiles, progress: services.progress, now: services.now })),
    },
    routes: matchmakeRoutes(),
    transport: new WebSocketTransport(),
    express: (app) => mountHttp(app, config, log, services),
    logger: colyseusLogger(log),
    greet: false,
  });
}

/** For the client SDK: `new Client<GameServer>()` types room names and messages end to end. */
export type GameServer = ReturnType<typeof createGameServer>;
