import { ColyseusTestServer } from '@colyseus/testing';
import type { Room } from '@colyseus/sdk';
import {
  DIRECTIONS,
  GRACE_MS,
  LATE_MS,
  MIN_ATTEMPT_MS,
  PROTOCOL_VERSION,
  createSave,
  emptyProgress,
  encounterZoneAt,
  inBounds,
  isWalkable,
  judgeAttempt,
  newCreature,
  perfectTaps,
  samePoint,
  stepFrom,
  type AttemptPlan,
  type CreatureInstance,
  type JobChanged,
  type JobsMessage,
  type Point,
  type Progress,
  type ProgressMessage,
  type QuestChanged,
  type Refused,
  type SkillAttemptMessage,
  type SkillResultMessage,
  type SkillsMessage,
  type Spot,
  type Tap,
} from '@nebotok/core';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createGameServer } from '../src/app.ts';
import type { WorldState } from '../src/world-state.ts';
import type { WorldContent } from '../src/world.ts';
import { capturedLog, freePort, tempServices, until } from './helpers.ts';
import { PACE_MS, beside, inbox, send, sleep, type Player } from './story-server.ts';

/**
 * A real server on the real content, with a test map: every spot sits on one tile beside the tile
 * next to Bavko, and every station on another, so one player there reaches them all and can talk.
 * Wild creatures appear at every step in the grass. `clock.offset` moves the room's clock on.
 */
async function skillsServer() {
  const clock = { offset: 0 };
  const logged = capturedLog('info');
  const temp = tempServices(() => Date.now() + clock.offset);
  const real = temp.services.world;
  const skills = real.story.skills;
  if (!skills) throw new Error('the content has no skills');
  const bavko = real.map.npcs.bavko!;
  const stand = beside(real.map, bavko);
  const [spotTile, stationTile] = DIRECTIONS.map((direction) => stepFrom(stand, direction)).filter((tile) => inBounds(real.map, tile) && !samePoint(tile, bavko));
  if (!spotTile || !stationTile) throw new Error('no room beside the stand tile');
  const world: WorldContent = {
    ...real,
    map: {
      ...real.map,
      spots: Object.fromEntries([...skills.spots.keys()].map((id) => [id, spotTile])),
      stations: Object.fromEntries([...skills.stations.keys()].map((id) => [id, stationTile])),
    },
    encounters: new Map([...real.encounters].map(([id, zone]) => [id, { ...zone, encounterPercent: 100 }])),
  };
  const server = createGameServer(temp.config, logged.log, { ...temp.services, world });
  await server.listen(await freePort(), '127.0.0.1');
  const colyseus = new ColyseusTestServer(server);

  async function enter(id: number): Promise<Player> {
    const login = await temp.services.profiles.login({ profileId: id });
    if (!login.ok) throw new Error(login.error);
    colyseus.sdk.auth.token = login.value.token;
    const room = await colyseus.sdk.joinOrCreate<WorldState>('world', { protocol: PROTOCOL_VERSION });
    room.reconnection.enabled = false;
    const box = inbox(room);
    await box.take('welcome');
    return { id, room, box, progress: await box.take<ProgressMessage>('progress') };
  }

  /** Joins a player saved at `at` with `progress`, after taking `welcome` and the first `progress`. */
  async function player(name: string, at: Point, progress: Partial<Progress> = {}): Promise<Player> {
    const made = await temp.services.profiles.create({ name, avatar: 'green' });
    if (!made.ok) throw new Error(made.error);
    const position = { map: world.map.id, ...at, facing: 'left' as const };
    temp.services.progress.save(made.value.id, createSave({ name, language: 'en', createdAt: '2026-05-01T09:00:00.000Z', position, ...emptyProgress(), ...progress }));
    return enter(made.value.id);
  }

  const stored = (id: number) => temp.services.progress.load(id)?.data;

  return {
    clock,
    logged,
    world,
    colyseus,
    stand,
    spotTile,
    stationTile,
    player,
    enter,
    stored,
    async reset() {
      await colyseus.cleanup();
      temp.services.db.exec('DELETE FROM players');
      logged.lines.length = 0;
    },
    async close() {
      await colyseus.shutdown();
      temp.dispose();
    },
  };
}

let server: Awaited<ReturnType<typeof skillsServer>>;
beforeAll(async () => {
  server = await skillsServer();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  await server.reset();
});

const content = () => server.world.story.skills!;
const map = () => server.world.map;
const me = ({ room }: Player) => room.state.players.get(room.sessionId);
const strong = (): CreatureInstance => newCreature('glowbun', 60, server.world.battle);
/** The first spot of the skill that plays `game`, at level 1, or above it. */
const spotFor = (game: string, above = false): Spot => {
  const skill = [...content().skills.values()].find((each) => each.game === game)!;
  return [...content().spots.values()].find((spot) => spot.skill === skill.id && (above ? spot.level > 1 : spot.level === 1))!;
};
const fishing = () => spotFor('dip');
const foraging = () => spotFor('sparkle');
const bun = () => [...content().recipes.values()].find((recipe) => recipe.level === 1)!;
const pot = () => [...content().stations.values()].find((station) => station.kind === 'cookingPot')!.id;
const board = () => [...content().stations.values()].find((station) => station.kind === 'jobBoard')!.id;
const held = (progress: Pick<Progress, 'inventory'>, item: string) => progress.inventory.find((entry) => entry.item === item)?.count ?? 0;

/** A walkable tile out of the grass, at least five steps from every spot and station. */
function farTile(): Point {
  for (let y = 0; y < map().height; y += 1) {
    for (let x = 0; x < map().width; x += 1) {
      const tile = { x, y };
      const away = [server.spotTile, server.stationTile].every((point) => Math.abs(point.x - x) + Math.abs(point.y - y) >= 5);
      if (away && isWalkable(map(), tile) && encounterZoneAt(map(), tile) === null) return tile;
    }
  }
  throw new Error('no tile far from the spots');
}

const gatherer = (name: string, progress: Partial<Progress> = {}) => server.player(name, server.stand, { team: [strong()], ...progress });

const planOf = (attempt: SkillAttemptMessage) => ({ game: attempt.game, params: attempt.params, endsByMs: attempt.endsByMs }) as AttemptPlan;

async function gather(who: Player, spot: string): Promise<SkillAttemptMessage> {
  await send(who, 'gather.start', { spot });
  return who.box.take<SkillAttemptMessage>('skill.attempt');
}

async function cook(who: Player, recipe: string): Promise<SkillAttemptMessage> {
  await send(who, 'cook.start', { recipe, station: pot() });
  return who.box.take<SkillAttemptMessage>('skill.attempt');
}

/** Moves the room's clock on by `elapsedMs` (by default past the game's end), sends the taps and takes the result. */
async function finish(who: Player, attempt: SkillAttemptMessage, taps: readonly Tap[], elapsedMs = attempt.endsByMs + 100): Promise<SkillResultMessage> {
  server.clock.offset += elapsedMs;
  who.room.send('skill.finish', { attempt: attempt.attempt, taps });
  return who.box.take<SkillResultMessage>('skill.result');
}

const perfectly = (who: Player, attempt: SkillAttemptMessage) => finish(who, attempt, perfectTaps(planOf(attempt)));

async function refusedWith(who: Player, type: string, payload: object): Promise<Refused['reason']> {
  await send(who, type, payload);
  return (await who.box.take<Refused>('refused')).reason;
}

/** The types heard since `from`, the place in `heard` to start at. */
const heardSince = (who: Player, from: number) => who.box.types().slice(from);

describe('joining', () => {
  it('sends skills after progress and story, every skill at level 1 and nothing resting', async () => {
    const who = await gatherer('Fresh Gatherer');
    expect(who.box.types().slice(0, 2)).toEqual(['story', 'skills']);
    const skills = await who.box.take<SkillsMessage>('skills');
    expect(skills.skills.map((entry) => entry.skill)).toEqual([...content().skills.keys()]);
    expect(skills.skills.every((entry) => entry.level === 1 && entry.xp === 0 && entry.toNext === content().levelCosts[0])).toBe(true);
    expect(skills.resting).toEqual([]);
    expect(me(who)?.skill).toBe('');
  });
});

describe('starting', () => {
  it('refuses a player without a creature, one too far away, and what the content does not have', async () => {
    const starterless = await server.player('Starterless Gatherer', server.stand);
    expect(await refusedWith(starterless, 'gather.start', { spot: foraging().id })).toBe('notNow');
    expect(await refusedWith(starterless, 'cook.start', { recipe: bun().id, station: pot() })).toBe('notNow');

    const far = await server.player('Distant Gatherer', farTile(), { team: [strong()] });
    expect(await refusedWith(far, 'gather.start', { spot: foraging().id })).toBe('tooFar');
    expect(await refusedWith(far, 'cook.start', { recipe: bun().id, station: pot() })).toBe('tooFar');

    const who = await gatherer('Muddled Gatherer');
    expect(await refusedWith(who, 'gather.start', { spot: 'no-such-spot' })).toBe('invalid');
    expect(await refusedWith(who, 'cook.start', { recipe: 'no-such-dish', station: pot() })).toBe('invalid');
    expect(await refusedWith(who, 'cook.start', { recipe: bun().id, station: board() })).toBe('invalid');
    expect(me(who)?.skill).toBe('');
  });

  it('refuses a spot above the level, a cook without ingredients and a full stack', async () => {
    const who = await gatherer('Eager Gatherer', { inventory: [{ item: foraging().item, count: 99 }] });
    expect(await refusedWith(who, 'gather.start', { spot: spotFor('sparkle', true).id })).toBe('needsLevel');
    expect(await refusedWith(who, 'gather.start', { spot: foraging().id })).toBe('bagFull');
    const empty = await gatherer('Empty Cook');
    expect(await refusedWith(empty, 'cook.start', { recipe: bun().id, station: pot() })).toBe('noItem');
  });

  it('refuses a player in a talk, in a battle or already playing, and refuses a talk while playing', async () => {
    const talker = await gatherer('Talking Gatherer');
    await send(talker, 'talk.start', { npc: 'bavko' });
    await talker.box.take('talk.node');
    expect(await refusedWith(talker, 'gather.start', { spot: foraging().id })).toBe('notNow');

    const busy = await gatherer('Busy Gatherer');
    const attempt = await gather(busy, foraging().id);
    expect(await refusedWith(busy, 'gather.start', { spot: fishing().id })).toBe('notNow');
    expect(await refusedWith(busy, 'cook.start', { recipe: bun().id, station: pot() })).toBe('notNow');
    expect(await refusedWith(busy, 'talk.start', { npc: 'bavko' })).toBe('notNow');
    expect(await refusedWith(busy, 'skill.finish', { attempt: attempt.attempt + 1, taps: [] })).toBe('invalid');
    expect(await refusedWith(busy, 'skill.cancel', { attempt: attempt.attempt + 1 })).toBe('invalid');

    const fighter = await gatherer('Fighting Gatherer');
    const grass = map().encounterAreas[0]!;
    fighter.room.send('walk.to', { x: grass.x, y: grass.y });
    await fighter.box.take('battle.started');
    expect(await refusedWith(fighter, 'gather.start', { spot: foraging().id })).toBe('inBattle');
  });

  it('refuses a finish or a cancel with no attempt open', async () => {
    const who = await gatherer('Idle Gatherer');
    expect(await refusedWith(who, 'skill.finish', { attempt: 1, taps: [] })).toBe('notNow');
    expect(await refusedWith(who, 'skill.cancel', { attempt: 1 })).toBe('notNow');
  });

  it('stops the player facing the spot, shows the skill to others, and sends the game only to its player', async () => {
    const who = await gatherer('Watched Gatherer');
    const watcher = await gatherer('Watching Gatherer');
    const attempt = await gather(who, fishing().id);
    expect(attempt).toMatchObject({ skill: fishing().skill, spot: fishing().id, recipe: null, game: 'dip' });
    expect(attempt.endsByMs).toBeGreaterThan(MIN_ATTEMPT_MS);
    const facing = DIRECTIONS.find((direction) => samePoint(stepFrom(server.stand, direction), server.spotTile));
    await until(() => watcher.room.state.players.get(who.room.sessionId)?.skill === fishing().skill, 'the watcher to see the skill');
    await until(() => me(who)?.facing === facing, 'the player to face the spot');
    expect(me(who)).toMatchObject({ skill: fishing().skill, facing, moving: false });
    await sleep(100);
    expect(watcher.box.has('skill.attempt')).toBe(false);
  });
});

describe('finishing', () => {
  it('gives two on a perfect, with the XP and the rest, saved at once and sent in order', async () => {
    const spot = fishing();
    const who = await gatherer('Perfect Fisher');
    await who.box.take('skills');
    const attempt = await gather(who, spot.id);
    const from = who.box.heard.length;
    const result = await perfectly(who, attempt);
    const rest = content().skills.get(spot.skill);
    expect(result).toEqual({
      attempt: attempt.attempt,
      outcome: 'perfect',
      items: [{ item: spot.item, count: 2 }],
      used: [],
      extra: [],
      skill: spot.skill,
      xp: spot.xp,
      level: 1,
      levelUp: false,
      restMs: rest?.uses === 'spots' ? rest.restSeconds * 1_000 : 0,
    });
    const progress = await who.box.take<ProgressMessage>('progress');
    expect(held(progress, spot.item)).toBe(2);
    const skills = await who.box.take<SkillsMessage>('skills');
    expect(skills.skills.find((entry) => entry.skill === spot.skill)?.xp).toBe(spot.xp);
    expect(skills.resting).toEqual([{ spot: spot.id, ms: result.restMs }]);
    expect(heardSince(who, from)).toEqual([]);
    expect(held(server.stored(who.id)!, spot.item)).toBe(2);
    expect(server.stored(who.id)?.skills).toEqual([{ skill: spot.skill, level: 1, xp: spot.xp }]);
    await until(() => me(who)?.skill === '', 'the skill to clear');
    expect(await refusedWith(who, 'gather.start', { spot: spot.id })).toBe('resting');
  });

  it('gives one on a success and nothing on a miss, which rests nothing', async () => {
    const spot = fishing();
    const who = await gatherer('Plain Fisher');
    await who.box.take('skills');
    const missed = await gather(who, spot.id);
    expect(await finish(who, missed, [])).toMatchObject({ outcome: 'miss', items: [], xp: 0, restMs: 0 });
    await sleep(100);
    expect(who.box.has('progress')).toBe(false);
    expect(who.box.has('skills')).toBe(false);
    const attempt = await gather(who, spot.id);
    const plan = planOf(attempt);
    if (plan.game !== 'dip') throw new Error('fishing plays dip');
    const late = plan.params.dipAtMs + plan.params.perfectMs + GRACE_MS + 10;
    expect(await finish(who, attempt, [{ at: late, place: 0 }])).toMatchObject({ outcome: 'success', items: [{ item: spot.item, count: 1 }], xp: spot.xp });
    expect(held(await who.box.take<ProgressMessage>('progress'), spot.item)).toBe(1);
  });

  it('counts a tap claimed after the server’s own elapsed time, or a finish under the minimum, as a miss', async () => {
    const who = await gatherer('Hasty Fisher');
    const early = await gather(who, fishing().id);
    const taps = perfectTaps(planOf(early));
    expect(judgeAttempt(planOf(early), taps, early.endsByMs)).toBe('perfect');
    expect(await finish(who, early, taps, 0)).toMatchObject({ outcome: 'miss', items: [] });

    const ahead = await gather(who, fishing().id);
    const plan = planOf(ahead);
    if (plan.game !== 'dip') throw new Error('fishing plays dip');
    // At least the minimum, and well short of the dip the perfect tap claims to have seen.
    const elapsed = Math.max(MIN_ATTEMPT_MS, plan.params.dipAtMs - 300);
    expect(await finish(who, ahead, perfectTaps(plan), elapsed)).toMatchObject({ outcome: 'miss', items: [] });
    await sleep(100);
    expect(who.box.has('progress')).toBe(false);
  });

  it('ends an attempt with no finish late, and refuses a finish after that', async () => {
    const who = await gatherer('Slow Fisher');
    const watcher = await gatherer('Patient Watcher');
    const attempt = await gather(who, fishing().id);
    await until(() => watcher.room.state.players.get(who.room.sessionId)?.skill !== '', 'the watcher to see the skill');
    server.clock.offset += attempt.endsByMs + LATE_MS + 100;
    expect(await who.box.take<SkillResultMessage>('skill.result')).toMatchObject({ attempt: attempt.attempt, outcome: 'late', items: [], restMs: 0 });
    await until(() => watcher.room.state.players.get(who.room.sessionId)?.skill === '', 'the watcher to see the skill end');
    expect(await refusedWith(who, 'skill.finish', { attempt: attempt.attempt, taps: perfectTaps(planOf(attempt)) })).toBe('notNow');
  });
});

describe('cancelling', () => {
  it('ends the attempt cancelled on skill.cancel or a walk, using and resting nothing', async () => {
    const spot = foraging();
    const who = await gatherer('Fickle Gatherer');
    const first = await gather(who, spot.id);
    await send(who, 'skill.cancel', { attempt: first.attempt });
    expect(await who.box.take<SkillResultMessage>('skill.result')).toMatchObject({ attempt: first.attempt, outcome: 'cancelled', items: [], restMs: 0 });
    await until(() => me(who)?.skill === '', 'the skill to clear');

    const second = await gather(who, spot.id);
    const away = DIRECTIONS.map((direction) => stepFrom(server.stand, direction)).find((tile) => isWalkable(map(), tile) && encounterZoneAt(map(), tile) === null && !samePoint(tile, server.spotTile));
    await send(who, 'walk.to', away ?? farTile());
    expect(await who.box.take<SkillResultMessage>('skill.result')).toMatchObject({ attempt: second.attempt, outcome: 'cancelled' });
    await sleep(100);
    expect(who.box.has('progress')).toBe(false);
  });

  it('ends the attempt cancelled on a reconnection, then sends skills', async () => {
    const who = await gatherer('Dropping Gatherer');
    const attempt = await gather(who, foraging().id);
    const { reconnectionToken } = who.room;
    await who.room.leave(false);
    const back: Room<unknown, WorldState> = await server.colyseus.sdk.reconnect<WorldState>(reconnectionToken);
    back.reconnection.enabled = false;
    const again: Player = { ...who, room: back, box: inbox(back) };
    await again.box.take<ProgressMessage>('progress');
    expect(await again.box.take<SkillResultMessage>('skill.result')).toMatchObject({ attempt: attempt.attempt, outcome: 'cancelled' });
    await again.box.take<SkillsMessage>('skills');
    await until(() => me(again)?.skill === '', 'the skill to clear');
  });

  it('ends the attempt cancelled when the player leaves', async () => {
    const who = await gatherer('Leaving Gatherer');
    const attempt = await gather(who, foraging().id);
    await who.room.leave();
    await until(() => server.logged.lines.some((line) => line.msg === 'skill attempt ended' && line.attempt === attempt.attempt), 'the attempt to end');
    expect(server.logged.lines.find((line) => line.msg === 'skill attempt ended')).toMatchObject({ outcome: 'cancelled' });
  });
});

describe('spots and players', () => {
  it('rests a spot for its gatherer only, and each player sees the other’s skill', async () => {
    const spot = foraging();
    const first = await gatherer('First Forager');
    const second = await gatherer('Second Forager');
    const attempt = await gather(first, spot.id);
    await until(() => second.room.state.players.get(first.room.sessionId)?.skill === spot.skill, 'the second to see the first forage');
    expect((await perfectly(first, attempt)).outcome).toBe('perfect');
    const theirs = await gather(second, spot.id);
    await until(() => first.room.state.players.get(second.room.sessionId)?.skill === spot.skill, 'the first to see the second forage');
    expect(await refusedWith(first, 'gather.start', { spot: spot.id })).toBe('resting');
    expect((await perfectly(second, theirs)).outcome).toBe('perfect');
  });

  it('keeps a rest by profile, across leaving and joining again', async () => {
    const spot = foraging();
    const who = await gatherer('Returning Forager');
    await perfectly(who, await gather(who, spot.id));
    await who.room.leave();
    const back = await server.enter(who.id);
    const skills = await back.box.take<SkillsMessage>('skills');
    expect(skills.resting.map((rest) => rest.spot)).toEqual([spot.id]);
    expect(await refusedWith(back, 'gather.start', { spot: spot.id })).toBe('resting');
  });
});

describe('cooking', () => {
  it('uses the ingredients only on a success', async () => {
    const recipe = bun();
    const inventory = recipe.ingredients.map(({ item, count }) => ({ item, count: count + 1 }));
    const who = await gatherer('Careful Cook', { inventory });
    const missed = await cook(who, recipe.id);
    expect(missed).toMatchObject({ skill: [...content().skills.values()].find((skill) => skill.uses === 'recipes')?.id, spot: null, recipe: recipe.id, game: 'marker' });
    expect(await finish(who, missed, [])).toMatchObject({ outcome: 'miss', used: [], items: [] });
    await sleep(100);
    expect(who.box.has('progress')).toBe(false);

    const result = await perfectly(who, await cook(who, recipe.id));
    expect(result).toMatchObject({ outcome: 'perfect', used: recipe.ingredients, items: [{ item: recipe.makes, count: 2 }], xp: recipe.xp, restMs: 0 });
    const progress = await who.box.take<ProgressMessage>('progress');
    for (const { item } of recipe.ingredients) expect(held(progress, item)).toBe(1);
    expect(held(progress, recipe.makes)).toBe(2);
    expect(await refusedWith(who, 'cook.start', { recipe: recipe.id, station: pot() })).toBe('noItem');
  });
});

describe('quests and jobs', () => {
  it('moves a gather job and a gather quest step, sending each change in order', async () => {
    const spot = foraging();
    const quest = [...server.world.story.quests.values()].find((each) => each.steps[0]?.kind === 'gather' && each.steps[0].item === spot.item)!;
    const template = [...content().templates.values()].find((each) => each.kind === 'gather' && each.item === spot.item)!;
    const jobs = { seed: 7, drawn: 1, done: 0, board: [{ job: 1, template: template.id, item: spot.item, count: 9, to: null, progress: 0 }] };
    const step = quest.steps[0]!;
    // One short of the step, so the two a perfect gives finish it.
    const story = { active: [{ quest: quest.id, step: 0, count: 'count' in step ? step.count - 1 : 0 }], done: [], flags: [] };
    const who = await gatherer('Busy Forager', { jobs, story });
    await who.box.take('skills');
    await who.box.take('jobs');
    const attempt = await gather(who, spot.id);
    const from = who.box.heard.length;
    server.clock.offset += attempt.endsByMs + 100;
    who.room.send('skill.finish', { attempt: attempt.attempt, taps: perfectTaps(planOf(attempt)) });
    await until(() => who.box.has('jobs'), 'the jobs message');
    expect(heardSince(who, from)).toEqual(['skill.result', 'job.changed', 'quest.changed', 'progress', 'skills', 'story', 'jobs']);
    expect(await who.box.take<JobChanged>('job.changed')).toEqual({ job: 1, change: 'progress', progress: 2, rewards: null, next: null });
    expect(await who.box.take<QuestChanged>('quest.changed')).toMatchObject({ quest: quest.id, change: 'step', step: 1 });
    expect((await who.box.take<JobsMessage>('jobs')).board).toEqual([{ job: 1, template: template.id, kind: 'gather', item: spot.item, count: 9, to: null, progress: 2 }]);
    expect(server.stored(who.id)?.jobs?.board[0]?.progress).toBe(2);
  });
});

describe('limits and logs', () => {
  it(`drops starts beyond the request limit without an answer`, async () => {
    const who = await gatherer('Spamming Gatherer');
    await sleep(PACE_MS);
    for (let at = 0; at < 8; at += 1) who.room.send('gather.start', { spot: foraging().id });
    await who.box.take('skill.attempt');
    await sleep(300);
    const answers = who.box.types().filter((type) => type === 'refused');
    expect(answers.length).toBe(4);
  });

  it('logs attempts by ids and counts, never names', async () => {
    const who = await gatherer('Logged Gatherer');
    await perfectly(who, await gather(who, fishing().id));
    const line = server.logged.lines.find((entry) => entry.msg === 'skill attempt ended');
    expect(line).toMatchObject({ playerId: who.id, skill: fishing().skill, spot: fishing().id, recipe: null, outcome: 'perfect', items: 2, xp: fishing().xp });
    expect(JSON.stringify(server.logged.lines)).not.toContain('Logged Gatherer');
  });
});
