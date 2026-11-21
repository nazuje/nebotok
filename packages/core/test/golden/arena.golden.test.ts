import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ARENA_SHAPES, ArenaGoldenFile, arenaHash, arenaReplay, arenaReplayHash, mindFight, stormRadius, type ArenaEvent, type ArenaShape } from '../../src/index.ts';
import { goldenArenaContent } from '../support/arena-content.ts';

const ARENA_DIR = fileURLToPath(new URL('../../fixtures/golden/arena/', import.meta.url));
const files = readdirSync(ARENA_DIR).filter((name) => name.endsWith('.json')).toSorted();
const golden = (name: string) => ArenaGoldenFile.parse(JSON.parse(readFileSync(join(ARENA_DIR, name), 'utf8')));
const replayOf = (name: string) => arenaReplay(golden(name), goldenArenaContent);
const kinds = (name: string) => replayOf(name).events.map((event) => event.kind);

/** Each shape's golden: side 0's move of that shape is cast and hits, and the fight ends in a knockout or a ring-out. */
const shapeGoldens: readonly (readonly [string, string, ArenaShape])[] = [
  ['bolt-pelting.json', 'drip-drop', 'bolt'],
  ['spray-fan.json', 'static-zap', 'spray'],
  ['cone-up-close.json', 'heat-shimmer', 'cone'],
  ['snare-root-and-pull.json', 'icicle-poke', 'snare'],
  ['lunge-windup.json', 'gale-wallop', 'lunge'],
  ['burst-ring.json', 'twirl', 'burst'],
  ['puddle-slow.json', 'puddle-jump', 'puddle'],
  ['shield-reflect.json', 'sun-ray', 'shield'],
  ['strike-marks.json', 'sky-crackle', 'strike'],
  ['wall-sweep.json', 'sky-sweep', 'wall'],
  ['freeze-root.json', 'big-freeze', 'freeze'],
  ['zone-heal.json', 'noon-blaze', 'zone'],
  ['weather-ring.json', 'gale-call', 'weather'],
];
/** Each archetype's wild golden: a WILD-mind creature on side 1 against the BOT mind on side 0, with both minds' inputs recorded. */
const wildGoldens = ['wild-gale.json', 'wild-rain.json', 'wild-sun.json'] as const;
const has = (events: readonly ArenaEvent[], wanted: Partial<ArenaEvent>) => events.some((event) => Object.entries(wanted).every(([key, value]) => (event as Record<string, unknown>)[key] === value));

describe('arena golden replays', () => {
  it('has the four body goldens, one for each shape, the weather flip and a wild fight for each archetype', () => {
    expect(files).toEqual([
      'bolt-pelting.json',
      'bump-war.json',
      'burst-ring.json',
      'cone-up-close.json',
      'freeze-root.json',
      'lunge-windup.json',
      'puddle-slow.json',
      'ring-out-by-dash.json',
      'shield-reflect.json',
      'snare-root-and-pull.json',
      'spray-fan.json',
      'storm-to-the-floor.json',
      'strike-marks.json',
      'walk-and-dash.json',
      'wall-sweep.json',
      'weather-flip.json',
      'weather-ring.json',
      'wild-gale.json',
      'wild-rain.json',
      'wild-sun.json',
      'zone-heal.json',
    ]);
    const shapes = new Set(shapeGoldens.map(([, , shape]) => shape));
    expect([...shapes].toSorted()).toEqual([...ARENA_SHAPES].toSorted());
  });

  it.each(files)('%s replays to its recorded hash', (name) => {
    // A mismatch means arena rules or the frozen content in fixtures/golden/arena/content/ changed. If that was intended, run `npm run golden:update`.
    expect(arenaReplayHash(golden(name), goldenArenaContent)).toBe(golden(name).expectedHash);
  });

  it('walk and dash: side 0 dashes twice and side 1 once, and they never touch', () => {
    expect(kinds('walk-and-dash.json').filter((kind) => kind === 'dashed')).toHaveLength(3);
    expect(kinds('walk-and-dash.json')).not.toContain('bumped');
    expect(replayOf('walk-and-dash.json').state.outcome).toBeNull();
  });

  it('bump war: each side is bumped, and nobody falls', () => {
    const { events, state } = replayOf('bump-war.json');
    const bumped = new Set(events.flatMap((event) => (event.kind === 'bumped' ? [event.side] : [])));
    expect([...bumped].toSorted()).toEqual([0, 1]);
    expect(events.some((event) => event.kind === 'stormWarning')).toBe(true);
    expect(state.outcome).toBeNull();
  });

  it('storm to the floor: ten shrinks to a quarter, then the time limit draws', () => {
    const { events, state } = replayOf('storm-to-the-floor.json');
    expect(events.filter((event) => event.kind === 'stormShrank')).toHaveLength(10);
    expect(state.radius).toBe(stormRadius(10, goldenArenaContent.arena));
    expect(state.radius * 4).toBe(goldenArenaContent.arena.island.radius * 256);
    expect(state.storm.phase).toBe('floor');
    expect(state.outcome).toEqual({ winner: null, how: 'timeUp', tick: goldenArenaContent.arena.island.limitTicks });
  });

  it('ring-out by dash: the lip holds the glaciyak against a dash at full health, and a dash knocks it off once it is below half', () => {
    const { events, state } = replayOf('ring-out-by-dash.json');
    const dashes = events.filter((event) => ['dashed', 'bumped', 'ringOut'].includes(event.kind)).map((event) => event.kind);
    expect(dashes).toEqual(['dashed', 'bumped', 'dashed', 'bumped', 'ringOut']);
    expect(events.at(-1)).toEqual({ kind: 'ringOut', side: 1 });
    expect(events.some((event) => event.kind === 'hit' && event.side === 1 && event.move === 'gale-tap')).toBe(true);
    expect(state.outcome?.how).toBe('ringOut');
    expect(state.outcome?.winner).toBe(0);
    expect(state.bodies[1].out).toBe(true);
    expect(2 * state.bodies[1].health).toBeLessThan(state.bodies[1].maxHealth);
  });

  it.each(shapeGoldens)('%s: %s (%s) is cast and hits, and the fight ends in a knockout or a ring-out', (name, move, shape) => {
    const { events, state } = replayOf(name);
    expect(has(events, { kind: 'cast', side: 0, move, shape })).toBe(true);
    expect(has(events, { kind: 'hit', side: 1, by: 0, move })).toBe(true);
    expect(['knockout', 'ringOut']).toContain(state.outcome?.how);
  });

  it('snare: icicle-poke roots the bloomlet and vine-tickle pulls the snowsnoot', () => {
    const { events } = replayOf('snare-root-and-pull.json');
    expect(has(events, { kind: 'status', side: 1, status: 'root', ticks: 48 })).toBe(true);
    expect(has(events, { kind: 'status', side: 0, status: 'pull' })).toBe(true);
  });

  it('lunge: the computer winds up 36 ticks before every lunge', () => {
    const { events } = replayOf('lunge-windup.json');
    const windups = events.filter((event) => event.kind === 'windup');
    expect(windups.length).toBeGreaterThan(0);
    expect(windups.every((event) => event.ticks === 36)).toBe(true);
    expect(events.filter((event) => event.kind === 'cast')).toHaveLength(windups.length);
  });

  it('puddle and freeze slow and root', () => {
    expect(has(replayOf('puddle-slow.json').events, { kind: 'status', side: 1, status: 'slow' })).toBe(true);
    expect(has(replayOf('freeze-root.json').events, { kind: 'status', side: 1, status: 'root', ticks: 96 })).toBe(true);
  });

  it('shield: sends bolts back, and blocks with a knock on touch', () => {
    const { events } = replayOf('shield-reflect.json');
    expect(has(events, { kind: 'reflected', side: 0 })).toBe(true);
    expect(has(events, { kind: 'hit', side: 1, by: 0, move: 'frost-tap' })).toBe(true);
    expect(has(events, { kind: 'blocked', side: 0, by: 1 })).toBe(true);
  });

  it('zone: noon-blaze heals its caster while it pulses', () => {
    expect(has(replayOf('zone-heal.json').events, { kind: 'healed', side: 0 })).toBe(true);
  });

  it('ultimates bring their own weather for 600 ticks, and a call its weather for 900', () => {
    expect(has(replayOf('strike-marks.json').events, { kind: 'weatherStarted', weather: 'storm', ticks: 600 })).toBe(true);
    expect(has(replayOf('weather-ring.json').events, { kind: 'weatherStarted', weather: 'gale', ticks: 900 })).toBe(true);
  });

  it.each(wildGoldens)('%s: the minds still play exactly the recorded fight, to a knockout or a ring-out', (name) => {
    // A mismatch with a matching replay hash means the mind (mind.ts or the frozen arena.json minds) changed, not the rules.
    const { setup } = golden(name);
    const { state } = replayOf(name);
    expect(arenaHash(mindFight(setup, ['BOT', 'WILD'], goldenArenaContent))).toBe(arenaHash(state));
    expect(['knockout', 'ringOut']).toContain(state.outcome?.how);
  });

  it.each(wildGoldens)('%s: the wild creature casts every button, and winds up 36 ticks before each special and ultimate', (name) => {
    const { events } = replayOf(name);
    const casts = events.flatMap((event) => (event.kind === 'cast' && event.side === 1 ? [event.move] : []));
    const windups = events.flatMap((event) => (event.kind === 'windup' && event.side === 1 ? [event.ticks] : []));
    const [quick, special, ultimate] = golden(name).setup.fighters[1].loadout;
    expect(casts).toEqual(expect.arrayContaining([quick, special, ultimate]));
    expect(windups.every((ticks) => ticks === 36)).toBe(true);
    expect(windups).toHaveLength(casts.filter((move) => move === special || move === ultimate).length);
  });

  it('weather flip: rain ends the sun early, and the puddlepip wins', () => {
    const { events, state } = replayOf('weather-flip.json');
    const weather = events.filter((event) => event.kind === 'weatherStarted' || event.kind === 'weatherEnded');
    expect(weather).toEqual([
      { kind: 'weatherStarted', weather: 'sun', ticks: 900 },
      { kind: 'weatherEnded', weather: 'sun' },
      { kind: 'weatherStarted', weather: 'rain', ticks: 900 },
    ]);
    expect(state.outcome).toMatchObject({ winner: 1, how: 'knockout' });
  });
});
