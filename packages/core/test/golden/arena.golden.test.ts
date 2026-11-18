import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ArenaGoldenFile, arenaReplay, arenaReplayHash, stormRadius } from '../../src/index.ts';
import { goldenArenaContent } from '../support/arena-content.ts';

const ARENA_DIR = fileURLToPath(new URL('../../fixtures/golden/arena/', import.meta.url));
const files = readdirSync(ARENA_DIR).filter((name) => name.endsWith('.json')).toSorted();
const golden = (name: string) => ArenaGoldenFile.parse(JSON.parse(readFileSync(join(ARENA_DIR, name), 'utf8')));
const replayOf = (name: string) => arenaReplay(golden(name), goldenArenaContent);
const kinds = (name: string) => replayOf(name).events.map((event) => event.kind);

describe('arena golden replays', () => {
  it('has the four body goldens', () => {
    expect(files).toEqual(['bump-war.json', 'ring-out-by-dash.json', 'storm-to-the-floor.json', 'walk-and-dash.json']);
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

  it('ring-out by dash: the lip holds the walker until the dash knocks it off', () => {
    const { events, state } = replayOf('ring-out-by-dash.json');
    expect(events.map((event) => event.kind)).toEqual(['teeter', 'dashed', 'bumped', 'ringOut']);
    expect(state.outcome?.how).toBe('ringOut');
    expect(state.outcome?.winner).toBe(0);
    expect(state.bodies[1].out).toBe(true);
  });
});
