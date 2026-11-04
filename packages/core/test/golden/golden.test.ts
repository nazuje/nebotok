import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { GoldenFile, replayHash } from '../../src/index.ts';

const GOLDEN_DIR = fileURLToPath(new URL('../../fixtures/golden/', import.meta.url));
const files = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.json')).toSorted();

describe('golden replays', () => {
  it('has at least one golden', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s replays to its recorded hash', (name) => {
    const golden = GoldenFile.parse(JSON.parse(readFileSync(join(GOLDEN_DIR, name), 'utf8')));
    // A mismatch means rule behaviour changed. If that was intended, run `npm run golden:update`.
    expect(replayHash(golden.seed, golden.commands)).toBe(golden.expectedHash);
  });
});
