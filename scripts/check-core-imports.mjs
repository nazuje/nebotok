// Keeps packages/core engine-free: its source may import only its own files and the packages
// listed in ALLOWED. The tsconfig (no DOM, no Node types) catches globals; this catches imports.
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORE_SRC = join(ROOT, 'packages/core/src');
const ALLOWED = new Set(['zod']);
const SPECIFIER = /(?:\bimport\s*(?:[\w*{}\s,]+\s*from\s*)?|\bexport\s*[\w*{}\s,]+\s*from\s*|\bimport\s*\(\s*)['"]([^'"]+)['"]/g;

function packageName(specifier) {
  const parts = specifier.split('/');
  return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const problems = [];
const files = readdirSync(CORE_SRC, { recursive: true })
  .filter((name) => /\.(ts|mts|cts|js|mjs)$/.test(name))
  .map((name) => join(CORE_SRC, name));

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const [, specifier] of source.matchAll(SPECIFIER)) {
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const target = join(file, '..', specifier);
      if (!target.startsWith(CORE_SRC)) problems.push(`${relative(ROOT, file)}: "${specifier}" reaches outside packages/core/src`);
      continue;
    }
    if (!ALLOWED.has(packageName(specifier))) problems.push(`${relative(ROOT, file)}: imports "${specifier}"`);
  }
  if (/\brequire\s*\(/.test(source)) problems.push(`${relative(ROOT, file)}: uses require()`);
}

if (files.length === 0) problems.push('found no source files in packages/core/src');
if (problems.length) {
  console.error('core:boundary: packages/core must stay engine-free. Only zod and its own files are allowed.');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`core:boundary: ${files.length} core file(s) import only ${[...ALLOWED].join(', ')} and each other`);
