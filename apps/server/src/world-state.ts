import { schema, t, type SchemaType } from '@colyseus/schema';

export const Player = schema(
  {
    id: t.string(),
    connected: t.boolean().default(true),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

export const WorldState = schema(
  {
    playerCount: t.uint16().default(0),
    players: t.map(Player),
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;
