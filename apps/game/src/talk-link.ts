import { CLIENT_MESSAGES, SERVER_MESSAGES, type Refused, type StoryMessage, type TalkEnded, type TalkEndMessage, type TalkNextMessage, type TalkNode, type TalkStartMessage } from '@nebotok/core';
import type { WorldRoom } from './connection.ts';

/** What the server sends about one player's talks and story: docs/protocol.md "Talking, quests and the bag". */
export type TalkServerPayloads = {
  [SERVER_MESSAGES.talkNode]: TalkNode;
  [SERVER_MESSAGES.talkEnded]: TalkEnded;
  [SERVER_MESSAGES.story]: StoryMessage;
  [SERVER_MESSAGES.refused]: Refused;
};

export type TalkClientPayloads = {
  [CLIENT_MESSAGES.talkStart]: TalkStartMessage;
  [CLIENT_MESSAGES.talkNext]: TalkNextMessage;
  [CLIENT_MESSAGES.talkEnd]: TalkEndMessage;
};

type Tagged<Payloads> = { [Type in keyof Payloads]: { readonly type: Type; readonly payload: Payloads[Type] } }[keyof Payloads];
export type TalkServerMessage = Tagged<TalkServerPayloads>;
export type TalkClientMessage = Tagged<TalkClientPayloads>;

/** The talking half of a connection to the room. */
export type TalkLink = {
  /** Calls `handler` with every talk, story and refusal message, in order. Returns a function that stops. */
  listen(handler: (message: TalkServerMessage) => void): () => void;
  send(message: TalkClientMessage): void;
};

const SERVER_TYPES = [SERVER_MESSAGES.talkNode, SERVER_MESSAGES.talkEnded, SERVER_MESSAGES.story, SERVER_MESSAGES.refused] as const satisfies readonly (keyof TalkServerPayloads)[];

export function roomTalkLink(room: WorldRoom): TalkLink {
  return {
    listen: (handler) => {
      const stops = SERVER_TYPES.map((type) => room.onMessage(type, (payload: TalkServerPayloads[typeof type]) => handler({ type, payload } as TalkServerMessage)));
      return () => {
        for (const stop of stops) stop();
      };
    },
    send: (message) => room.send(message.type, message.payload),
  };
}
