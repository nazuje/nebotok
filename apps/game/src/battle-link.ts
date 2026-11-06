import {
  CLIENT_MESSAGES,
  SERVER_MESSAGES,
  type BattleMoveMessage,
  type BattleResult,
  type BattleRunMessage,
  type BattleSwitchMessage,
  type BattleTreatMessage,
  type BattleUpdate,
  type BattleViewMessage,
  type BefriendResult,
  type ProgressMessage,
  type Refused,
  type StarterChooseMessage,
  type StorageMessage,
  type StorageSwapMessage,
  type TeamReorderMessage,
} from '@nebotok/core';
import type { WorldRoom } from './connection.ts';

/** What the server sends about one player's creatures, treats and battles: docs/protocol.md "Battles, teams and treats". */
export type ServerPayloads = {
  [SERVER_MESSAGES.progress]: ProgressMessage;
  [SERVER_MESSAGES.storage]: StorageMessage;
  [SERVER_MESSAGES.battleStarted]: BattleUpdate;
  [SERVER_MESSAGES.battleTurn]: BattleUpdate;
  [SERVER_MESSAGES.battleView]: BattleViewMessage;
  [SERVER_MESSAGES.battleBefriend]: BefriendResult;
  [SERVER_MESSAGES.battleResult]: BattleResult;
  [SERVER_MESSAGES.refused]: Refused;
};

export type ClientPayloads = {
  [CLIENT_MESSAGES.battleMove]: BattleMoveMessage;
  [CLIENT_MESSAGES.battleSwitch]: BattleSwitchMessage;
  [CLIENT_MESSAGES.battleTreat]: BattleTreatMessage;
  [CLIENT_MESSAGES.battleRun]: BattleRunMessage;
  [CLIENT_MESSAGES.teamReorder]: TeamReorderMessage;
  [CLIENT_MESSAGES.storageSwap]: StorageSwapMessage;
  [CLIENT_MESSAGES.starterChoose]: StarterChooseMessage;
};

type Tagged<Payloads> = { [Type in keyof Payloads]: { readonly type: Type; readonly payload: Payloads[Type] } }[keyof Payloads];
export type ServerMessage = Tagged<ServerPayloads>;
export type ClientMessage = Tagged<ClientPayloads>;

/** The battle and team half of a connection to the room. */
export type BattleLink = {
  /** Calls `handler` with every battle, team and progress message, in order. Returns a function that stops. */
  listen(handler: (message: ServerMessage) => void): () => void;
  send(message: ClientMessage): void;
};

const SERVER_TYPES = [
  SERVER_MESSAGES.progress,
  SERVER_MESSAGES.storage,
  SERVER_MESSAGES.battleStarted,
  SERVER_MESSAGES.battleTurn,
  SERVER_MESSAGES.battleView,
  SERVER_MESSAGES.battleBefriend,
  SERVER_MESSAGES.battleResult,
  SERVER_MESSAGES.refused,
] as const satisfies readonly (keyof ServerPayloads)[];

export function roomLink(room: WorldRoom): BattleLink {
  return {
    listen: (handler) => {
      const stops = SERVER_TYPES.map((type) => room.onMessage(type, (payload: ServerPayloads[typeof type]) => handler({ type, payload } as ServerMessage)));
      return () => {
        for (const stop of stops) stop();
      };
    },
    send: (message) => room.send(message.type, message.payload),
  };
}
