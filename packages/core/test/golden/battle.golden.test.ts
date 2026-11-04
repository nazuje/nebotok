import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BattleGoldenFile, battleReplay, battleReplayHash } from '../../src/index.ts';
import { battleContent } from '../support/battle-content.ts';

const BATTLE_DIR = fileURLToPath(new URL('../../fixtures/golden/battle/', import.meta.url));
const files = readdirSync(BATTLE_DIR).filter((name) => name.endsWith('.json')).toSorted();
const golden = (name: string) => BattleGoldenFile.parse(JSON.parse(readFileSync(join(BATTLE_DIR, name), 'utf8')));

describe('battle golden replays', () => {
  it('has several scripted battles', () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files)('%s replays to its recorded hash', (name) => {
    // A mismatch means battle rules or content/creatures changed. If that was intended, run `npm run golden:update`.
    expect(battleReplayHash(golden(name), battleContent)).toBe(golden(name).expectedHash);
  });

  it.each(files)('%s plays to the end', (name) => {
    expect(battleReplay(golden(name), battleContent).state.phase).toBe('over');
  });
});
