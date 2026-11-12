import { schema, t, type SchemaType } from '@colyseus/schema';

/**
 * What every client sees of a player: only what the world shows. No profile id, PIN, token, team or
 * battle. `x`
 * and `y` are the tile the player occupies or is stepping onto (see Walker in packages/core).
 */
export const Player = schema(
  {
    name: t.string(),
    avatar: t.string(),
    x: t.uint16(),
    y: t.uint16(),
    facing: t.string().default('down'),
    moving: t.boolean().default(false),
    connected: t.boolean().default(true),
    /** True while the player is in a battle. Everything about the battle goes only to them, as messages. */
    inBattle: t.boolean().default(false),
    /** True while the player is talking to a character. What is said goes only to them, as messages. */
    talking: t.boolean().default(false),
    /** `''`, or the skill the player is doing (`foraging`, `fishing`, `cooking`), for the pose others see. Everything else about it goes only to them. */
    skill: t.string().default(''),
  },
  'Player',
);
export type Player = SchemaType<typeof Player>;

export const WorldState = schema(
  {
    playerCount: t.uint16().default(0),
    /** The map everyone is on, served at /maps/<map>.tmj. */
    map: t.string(),
    /** How long one step takes, for clients that predict movement with the same rules. */
    stepMs: t.uint16(),
    players: t.map(Player),
  },
  'WorldState',
);
export type WorldState = SchemaType<typeof WorldState>;
