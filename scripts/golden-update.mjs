// Re-records every golden's expectedHash from the current rules. Run only when a change in rule
// behaviour is intended, and say why in the commit.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoldenFile, replayHash } from '../packages/core/src/index.ts';

const GOLDEN_DIR = fileURLToPath(new URL('../packages/core/fixtures/golden/', import.meta.url));

let changed = 0;
for (const name of readdirSync(GOLDEN_DIR).filter((file) => file.endsWith('.json')).toSorted()) {
  const path = join(GOLDEN_DIR, name);
  const golden = GoldenFile.parse(JSON.parse(readFileSync(path, 'utf8')));
  const expectedHash = replayHash(golden.seed, golden.commands);
  if (expectedHash === golden.expectedHash) {
    console.log(`unchanged  ${name}`);
    continue;
  }
  writeFileSync(path, `${JSON.stringify({ ...golden, expectedHash }, null, 2)}\n`);
  console.log(`updated    ${name}  ${golden.expectedHash} -> ${expectedHash}`);
  changed += 1;
}
console.log(changed ? `\n${changed} golden(s) re-recorded. Review the diff before committing.` : '\nAll goldens already match.');
