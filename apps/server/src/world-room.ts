import { ErrorCode, Room, ServerError, validate, type Client } from '@colyseus/core';
import { isCompatibleProtocol, welcome, type WorldInfo } from '@nebotok/core';
import { z } from 'zod';
import { createLog, type Log } from './log.ts';
import { Player, WorldState } from './world-state.ts';

const WORLD: WorldInfo = { name: 'sky' };
const RECONNECT_SECONDS = 20;
const MAX_PLAYERS = 16;

export const JoinOptions = z.object({ protocol: z.number().int() });

/** The one shared family world. The server owns this state; clients only send intents. */
export class WorldRoom extends Room {
  override maxClients = MAX_PLAYERS;
  override state = new WorldState();
  /** Replaced by `worldRoomWithLog`; the default keeps a bare room quiet. */
  protected log: Log = createLog('silent');

  override messages = {
    ping: validate(z.strictObject({ sentAt: z.number().finite() }), (client: Client, { sentAt }) => {
      client.send('pong', { sentAt });
    }),
  };

  /** Turns away a client built for another protocol before it takes a seat. */
  static override async onAuth(_token: string, options: unknown): Promise<true> {
    const parsed = JoinOptions.safeParse(options);
    if (!parsed.success) throw new ServerError(ErrorCode.AUTH_FAILED, 'join options need a protocol number');
    if (!isCompatibleProtocol(parsed.data.protocol)) {
      throw new ServerError(ErrorCode.AUTH_FAILED, `protocol ${parsed.data.protocol} is not supported`);
    }
    return true;
  }

  override onCreate() {
    this.log.info('room created', { room: this.roomName, roomId: this.roomId });
  }

  override onJoin(client: Client) {
    const player = new Player();
    player.id = client.sessionId;
    this.state.players.set(client.sessionId, player);
    this.state.playerCount = this.state.players.size;
    client.send('welcome', welcome(WORLD, this.state.playerCount));
    this.log.info('player joined', { roomId: this.roomId, sessionId: client.sessionId, playerCount: this.state.playerCount });
  }

  override onDrop(client: Client, code: number) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.allowReconnection(client, RECONNECT_SECONDS);
    this.log.info('player dropped', { roomId: this.roomId, sessionId: client.sessionId, code });
  }

  override onReconnect(client: Client) {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.log.info('player reconnected', { roomId: this.roomId, sessionId: client.sessionId });
  }

  override onLeave(client: Client, code: number) {
    this.state.players.delete(client.sessionId);
    this.state.playerCount = this.state.players.size;
    this.log.info('player left', { roomId: this.roomId, sessionId: client.sessionId, code, playerCount: this.state.playerCount });
  }

  override onDispose() {
    this.log.info('room disposed', { roomId: this.roomId });
  }
}

/** A WorldRoom that writes to the server's log. Colyseus builds rooms itself, so the log rides on the class. */
export function worldRoomWithLog(log: Log): typeof WorldRoom {
  return class LoggedWorldRoom extends WorldRoom {
    protected override log = log;
  };
}
