import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runName, runSummaries, standingSummary } from './proof.mjs';

const run = (level, ok, container = false) => ({ ok, level, run: runName(level, container) });

describe('standingSummary', () => {
  it('keeps a higher passing level when a lower level runs after it', () => {
    const higher = run(4, true);
    expect(standingSummary([higher, run(0, true)], run(0, true))).toBe(higher);
  });

  it('ranks the container run above plain level 4', () => {
    const container = run(4, true, true);
    expect(standingSummary([run(4, true), container, run(3, true)], run(3, true))).toBe(container);
  });

  it('skips failed runs, and falls back to the latest when nothing passed', () => {
    const passed = run(1, true);
    expect(standingSummary([run(4, false), passed], run(4, false))).toBe(passed);
    const latest = run(2, false);
    expect(standingSummary([run(4, false), latest], latest)).toBe(latest);
  });
});

describe('runSummaries', () => {
  it('reads each run folder and ignores everything else', () => {
    const proof = mkdtempSync(join(tmpdir(), 'nebotok-proof-test-'));
    for (const [name, summary] of [['L0', run(0, true)], ['L4-container', run(4, true, true)]]) {
      mkdirSync(join(proof, name));
      writeFileSync(join(proof, name, 'summary.json'), JSON.stringify(summary));
    }
    mkdirSync(join(proof, 'L3'));
    mkdirSync(join(proof, 'screenshots'));
    writeFileSync(join(proof, 'summary.json'), '{}');
    expect(runSummaries(proof).map((summary) => summary.run).toSorted()).toEqual(['L0', 'L4-container']);
    expect(runSummaries(join(proof, 'missing'))).toEqual([]);
  });
});
