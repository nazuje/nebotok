// Checks every file in content/ against its schema in @nebotok/core. Fails on the first bad file
// with every problem in it, and on any file that has no schema.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkContentFile } from '../packages/core/src/index.ts';

const CONTENT_DIR = fileURLToPath(new URL('../content/', import.meta.url));

const files = readdirSync(CONTENT_DIR, { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
  .map((entry) => join(entry.parentPath, entry.name).slice(CONTENT_DIR.length))
  .toSorted();

let failures = 0;
for (const file of files) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(join(CONTENT_DIR, file), 'utf8'));
  } catch (error) {
    console.error(`FAIL content/${file}: not valid JSON (${error.message})`);
    failures += 1;
    continue;
  }
  const result = checkContentFile(file, raw);
  if (result.ok) {
    console.log(`ok   content/${file}`);
  } else {
    failures += 1;
    console.error(`FAIL content/${file}`);
    for (const problem of result.problems) console.error(`     - ${problem}`);
  }
}

if (files.length === 0) {
  console.error('FAIL content/ is empty');
  process.exit(1);
}
if (failures) {
  console.error(`\ncontent:validate: ${failures} of ${files.length} file(s) failed`);
  process.exit(1);
}
console.log(`\ncontent:validate: all ${files.length} file(s) valid`);
