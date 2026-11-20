import { ArraySchema, schema, t, type SchemaType } from '@colyseus/schema';
import { ARENA_INPUT_FIELDS, ARENA_NONE, type ArenaFight, type Body, type FightContent, type Thing } from '@nebotok/core';

/**
 * What an arena room shows its players (docs/protocol.md, "Arena state"): the island of the fight,
 * copied from core's `ArenaFight` after every fixed step by `showFight`. Positions and velocities
 * in 1/256 arena units, timers in ticks left. Only the room's own players receive it.
 */

/** The flat input each player streams, built from core's `ARENA_INPUT_FIELDS`; none is `ARENA_NONE`. */
export const ArenaInputSchema = schema(
  {
    dir: t[ARENA_INPUT_FIELDS.dir]().default(ARENA_NONE),
    press: t[ARENA_INPUT_FIELDS.press]().default(ARENA_NONE),
    dash: t[ARENA_INPUT_FIELDS.dash]().default(false),
    treat: t[ARENA_INPUT_FIELDS.treat]().default(false),
    swap: t[ARENA_INPUT_FIELDS.swap]().default(false),
    leave: t[ARENA_INPUT_FIELDS.leave]().default(false),
  },
  'ArenaInput',
);
export type ArenaInputSchema = SchemaType<typeof ArenaInputSchema>;

/** `ArenaBody.status` bits. */
export const STATUS_BITS = { slowed: 1, rooted: 2, shielded: 4, tumbling: 8, windingUp: 16 } as const;

/** Ticks left on each of these, in order: buttons 1 to 3, dash and swap. */
const COOLDOWN_COUNT = 5;

export const ArenaBody = schema(
  {
    /** The fighter id: `a<place + 1>` for a team creature of a wild fight, `b1` for the wild one. */
    id: t.string(),
    species: t.string(),
    level: t.uint8(),
    x: t.int32(),
    y: t.int32(),
    vx: t.int32(),
    vy: t.int32(),
    facing: t.uint8(),
    health: t.uint32(),
    max: t.uint32(),
    status: t.uint8(),
    cooldowns: t.array('uint16'),
    turtle: t.boolean(),
  },
  'ArenaBody',
);
export type ArenaBody = SchemaType<typeof ArenaBody>;

export const ArenaThing = schema(
  {
    id: t.uint32(),
    side: t.uint8(),
    move: t.string(),
    shape: t.string(),
    x: t.int32(),
    y: t.int32(),
    radius: t.uint32(),
    armTicks: t.uint16(),
    ticks: t.uint16(),
  },
  'ArenaThing',
);
export type ArenaThing = SchemaType<typeof ArenaThing>;

export const ArenaStorm = schema(
  {
    step: t.uint8(),
    phase: t.string(),
    /** The tick the next shrink starts, or -1 once the island is at its floor. */
    next: t.int32(),
  },
  'ArenaStorm',
);
export type ArenaStorm = SchemaType<typeof ArenaStorm>;

export const ArenaTreat = schema(
  {
    /** The treat's item, or '' when none is out. */
    item: t.string(),
    x: t.int32(),
    y: t.int32(),
    landed: t.boolean(),
  },
  'ArenaTreat',
);
export type ArenaTreat = SchemaType<typeof ArenaTreat>;

export const ArenaRoomState = schema(
  {
    mode: t.string(),
    /** `fighting` or `ended`; `picking` and `between` come with the rounds' picks (#155). */
    phase: t.string().default('fighting'),
    tick: t.uint32(),
    /** The tick the island's time limit falls on; each island of a best of 3 has its own. */
    limit: t.uint32(),
    radius: t.int32(),
    storm: t.ref(ArenaStorm),
    /** The weather on the island, or ''. */
    weather: t.string(),
    bodies: t.array(ArenaBody),
    /** Shots, zones and strikes, the first `MAX_THINGS`. */
    things: t.array(ArenaThing),
    treat: t.ref(ArenaTreat),
    /** Round wins of each side; 0 and 0 in a wild fight. */
    score: t.array('uint8'),
    round: t.uint8(),
  },
  'ArenaRoomState',
);
export type ArenaRoomState = SchemaType<typeof ArenaRoomState>;

export const MAX_THINGS = 24;

/** Sets `list[index]` only when it changed, so an unchanged number sends nothing. */
function setAt<T>(list: ArraySchema<T>, index: number, value: T) {
  if (list.length <= index) list.push(value);
  else if (list[index] !== value) list[index] = value;
}

function statusOf(body: Body): number {
  let bits = 0;
  if (body.status.slowTicks > 0) bits |= STATUS_BITS.slowed;
  if (body.status.rootTicks > 0) bits |= STATUS_BITS.rooted;
  if (body.status.shieldTicks > 0) bits |= STATUS_BITS.shielded;
  if (body.knockedTicks > 0) bits |= STATUS_BITS.tumbling;
  if (body.windup !== null) bits |= STATUS_BITS.windingUp;
  return bits;
}

function showBody(shown: ArenaBody, body: Body, swapCooldown: number) {
  shown.id = body.id;
  shown.species = body.species;
  shown.level = body.level;
  shown.x = body.x;
  shown.y = body.y;
  shown.vx = body.vx;
  shown.vy = body.vy;
  shown.facing = body.facing;
  shown.health = body.health;
  shown.max = body.maxHealth;
  shown.status = statusOf(body);
  shown.turtle = body.turtle;
  const cooldowns = [...body.cooldowns, body.dashCooldown, swapCooldown];
  for (let index = 0; index < COOLDOWN_COUNT; index += 1) setAt(shown.cooldowns, index, cooldowns[index] ?? 0);
}

function showThing(shown: ArenaThing, thing: Thing) {
  shown.id = thing.id;
  shown.side = thing.side;
  shown.move = thing.move;
  shown.shape = thing.shape;
  shown.x = thing.x;
  shown.y = thing.y;
  shown.radius = thing.radius;
  shown.armTicks = thing.armTicks;
  shown.ticks = thing.ticks;
}

/** Copies the fight onto the room's state, changing only what moved. */
export function showFight(state: ArenaRoomState, fight: ArenaFight, content: FightContent) {
  const { island } = fight;
  state.mode = fight.mode;
  state.phase = fight.outcome ? 'ended' : 'fighting';
  state.tick = fight.tick;
  // The island's own clock restarts each round, so the limit is given on the fight's.
  state.limit = fight.tick - island.tick + content.arena.island.limitTicks;
  state.radius = island.radius;
  state.storm.step = island.storm.step;
  state.storm.phase = island.storm.phase;
  state.storm.next = island.storm.nextShrink ?? -1;
  state.weather = island.weather?.type ?? '';
  const swapCooldown = fight.mode === 'wild' ? fight.swapCooldown : 0;
  island.bodies.forEach((body, side) => {
    if (!state.bodies[side]) state.bodies.push(new ArenaBody());
    showBody(state.bodies[side]!, body, side === 0 ? swapCooldown : 0);
  });
  const things = island.things.slice(0, MAX_THINGS);
  while (state.things.length > things.length) state.things.pop();
  things.forEach((thing, index) => {
    if (!state.things[index]) state.things.push(new ArenaThing());
    showThing(state.things[index]!, thing);
  });
  const treat = fight.mode === 'wild' ? fight.treat : null;
  state.treat.item = treat?.item ?? '';
  state.treat.x = treat?.x ?? 0;
  state.treat.y = treat?.y ?? 0;
  state.treat.landed = treat?.landed ?? false;
  const score = fight.mode === 'rounds' ? fight.score : [0, 0];
  score.forEach((wins, side) => setAt(state.score, side, wins));
  state.round = fight.mode === 'rounds' ? fight.round : 0;
}
