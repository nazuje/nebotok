import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { arenaRoom } from './arena-room.ts';
import type { Config } from './config.ts';
import { ARENA_ROOM, createFightBook, type FightBook } from './fights.ts';
import { mountHttp } from './http.ts';
import { colyseusLogger, type Log } from './log.ts';
import { closeMatchmakeCors, matchmakeRoutes } from './matchmake.ts';
import type { Services } from './services.ts';
import { worldRoom } from './world-room.ts';

/** For tests and scripts: the fight book to share, and whether arena rooms keep their inputs for a replay. */
export type GameServerOptions = { readonly fights?: FightBook; readonly recordFights?: boolean };

export function createGameServer(config: Config, log: Log, services: Services, { fights = createFightBook(), recordFights = false }: GameServerOptions = {}) {
  closeMatchmakeCors();
  const { world, profiles, progress, now } = services;
  return defineServer({
    rooms: {
      world: defineRoom(worldRoom({ log, world, profiles, progress, now, fights, arenaBattles: config.arenaBattles })),
      [ARENA_ROOM]: defineRoom(arenaRoom({ log, world, profiles, fights, now, record: recordFights })),
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
