// The arena bot of the bot run (scripts/bot-run.mjs). On an in-process server with ARENA_BATTLES on,
// the script starts a wild fight through the world room (grass does not start them yet), the bot
// joins its arena room with the reservation from arena.join and streams 30 inputs a second: the
// stick towards the wild creature and a press of button 1 every fourth step. It leaves after
// FIGHT_MS if the fight has not ended by then. Then it checks arena.result against the save.
import { matchMaker } from '@colyseus/core';
import { Client } from '@colyseus/sdk';
import { ARENA_NONE, DIRECTION_VECTORS, PROTOCOL_VERSION, createSave, defaultSettings, emptyProgress, newCreature } from '../../packages/core/src/index.ts';
import { poll, sleep } from './in-turn.mjs';

export const ARENA_BOT = { name: 'Bot Arena', avatar: 'blue' };
const FIGHT_MS = 15_000;
const STEP_MS = 33;
const PRESS_EVERY = 4;
const XP_RESULTS = new Set(['won', 'wonByRingOut', 'befriended', 'timeUp']);

/** The one of the 16 stick directions closest to the way from `from` to `to`. */
function toward(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let best = ARENA_NONE;
  let bestDot = 0;
  DIRECTION_VECTORS.forEach(([x, y], direction) => {
    const dot = x * dx + y * dy;
    if (dot > bestDot) [best, bestDot] = [direction, dot];
  });
  return best;
}

async function stream(fight, endsAt, sent = 0) {
  if (fight.ended() || Date.now() > endsAt) return sent;
  const [mine, wild] = fight.room.state.bodies ?? [];
  const input = fight.room.input();
  Object.assign(input.data, { dir: mine && wild ? toward(mine, wild) : ARENA_NONE, press: sent % PRESS_EVERY === 0 ? 0 : ARENA_NONE, dash: false, treat: false, swap: false, leave: false });
  input.send();
  await sleep(STEP_MS);
  return stream(fight, endsAt, sent + 1);
}

/**
 * Plays one arena fight on `server` (startSideServer's) and checks it with `expect`: one
 * arena.result, experience only for a result that gives it, the saved team as the result says,
 * one settlement in the log, the seat free again and the arena room closed.
 */
export async function arenaRun(server, { starter, expect }) {
  const { services } = server;
  const world = services.world;
  const [zone] = world.encounters.values();
  const wild = { species: zone.creatures[0].species, level: zone.creatures[0].minLevel };
  const made = await services.profiles.create(ARENA_BOT);
  if (!made.ok) throw new Error(made.error);
  const playerId = made.value.id;
  const team = [newCreature(starter, 30, world.battle)];
  const position = { map: world.map.id, ...server.stand, facing: 'down' };
  services.progress.save(playerId, createSave({ settings: defaultSettings(), name: ARENA_BOT.name, language: 'en', createdAt: new Date().toISOString(), position, ...emptyProgress(), team }));
  const session = await services.profiles.login({ profileId: playerId });
  if (!session.ok) throw new Error(session.error);
  const client = new Client(server.base);
  client.auth.token = session.value.token;
  const room = await client.joinOrCreate('world', { protocol: PROTOCOL_VERSION });
  const heard = [];
  room.onMessage('*', (type, message) => heard.push({ type, message }));
  const message = async (type) => {
    await poll(() => heard.some((entry) => entry.type === type), { deadline: Date.now() + 5_000 });
    const found = heard.find((entry) => entry.type === type);
    if (!found) throw new Error(`${ARENA_BOT.name} heard no ${type}`);
    return found.message;
  };
  await message('progress');

  const fightId = await matchMaker.getLocalRoomById(room.roomId).startWildFight(playerId, wild);
  if (!fightId) throw new Error('the world room started no fight');
  const join = await message('arena.join');
  const arena = await client.consumeSeatReservation(join.reservation);
  arena.onMessage('*', () => {});
  const fight = { room: arena, ended: () => heard.some((entry) => entry.type === 'arena.result') };
  const steps = await stream(fight, Date.now() + FIGHT_MS);
  const ranOut = !fight.ended();
  if (ranOut) {
    const input = arena.input();
    Object.assign(input.data, { dir: ARENA_NONE, press: ARENA_NONE, leave: true });
    input.send();
  }
  const result = await message('arena.result');

  const outcome = result.outcome?.result ?? null;
  expect(result.fightId === fightId && outcome !== null, `${ARENA_BOT.name}'s fight ended with ${JSON.stringify(result.outcome)}`);
  expect(XP_RESULTS.has(outcome) === result.rewards.length > 0, `${ARENA_BOT.name}'s ${outcome} gave rewards ${JSON.stringify(result.rewards)}`);
  const saved = services.progress.load(playerId)?.data;
  const [reward] = result.rewards;
  expect(!reward || saved?.team[0]?.level === reward.level, `${ARENA_BOT.name}'s saved level ${saved?.team[0]?.level} is not the reward's ${reward?.level}`);
  expect(saved?.seen.includes(wild.species), `${ARENA_BOT.name}'s save has not seen ${wild.species}`);
  await poll(() => room.state.players?.get(room.sessionId)?.inBattle === false, { deadline: Date.now() + 2_000 });
  expect(room.state.players?.get(room.sessionId)?.inBattle === false, `${ARENA_BOT.name} is still shown fighting`);
  const settled = server.lines.filter((line) => line.msg === 'fight settled' && line.fight === fightId).length;
  expect(settled === 1, `the server settled ${ARENA_BOT.name}'s fight ${settled} times`);
  expect(heard.filter((entry) => entry.type === 'arena.result').length === 1, `${ARENA_BOT.name} heard more than one arena.result`);
  const closed = await poll(() => matchMaker.getLocalRoomById(join.reservation.roomId) === undefined, { deadline: Date.now() + 5_000 });
  expect(closed, 'the arena room did not close after its fight');
  await room.leave();
  const ended = server.lines.find((line) => line.msg === 'fight ended' && line.fight === fightId);
  return { bot: ARENA_BOT.name, wild: `${wild.species} ${wild.level}`, outcome, ranOut, inputs: steps, meanStepMs: ended?.meanStepMs ?? null, worstStepMs: ended?.worstStepMs ?? null };
}
