import { defineRoom, defineServer } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import type { Config } from './config.ts';
import { mountHttp } from './http.ts';
import { colyseusLogger, type Log } from './log.ts';
import { worldRoomWithLog } from './world-room.ts';

export function createGameServer(config: Config, log: Log) {
  return defineServer({
    rooms: {
      world: defineRoom(worldRoomWithLog(log)),
    },
    transport: new WebSocketTransport(),
    express: (app) => mountHttp(app, config, log),
    logger: colyseusLogger(log),
    greet: false,
  });
}

/** For the client SDK: `new Client<GameServer>()` types room names and messages end to end. */
export type GameServer = ReturnType<typeof createGameServer>;
