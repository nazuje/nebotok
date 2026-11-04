// Pre-commit check of what is staged: no database files, no .env files (except .env.example) and
// no new file over 1 MiB. Run by .githooks/pre-commit after the gitleaks scan.
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_NEW_FILE_BYTES = 1024 * 1024;

/** entries: { status, path, size } for every staged file that is not being deleted. */
export function stagedProblems(entries) {
  const problems = [];
  for (const { status, path, size } of entries) {
    const name = basename(path);
    if (/\.sqlite/.test(name) || /\.db(?:-\w+)?$/.test(name)) problems.push(`${path}: database files never go in git; they may hold player data.`);
    else if (name.startsWith('.env') && name !== '.env.example') problems.push(`${path}: .env files hold secrets and stay on the machine they belong to.`);
    else if (status === 'A' && size > MAX_NEW_FILE_BYTES) {
      problems.push(`${path}: a new file of ${(size / 1024 / 1024).toFixed(1)} MiB. Keep new files under 1 MiB, or ask the owner first.`);
    }
  }
  return problems;
}

const git = (...args) => spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

function staged() {
  const listed = git('diff', '--cached', '--name-status', '--no-renames', '--diff-filter=d', '-z');
  if (listed.status !== 0) throw new Error(listed.stderr);
  const parts = listed.stdout.split('\0').filter(Boolean);
  const entries = [];
  for (let at = 0; at + 1 < parts.length; at += 2) {
    const status = parts[at];
    const path = parts[at + 1];
    const size = Number(git('cat-file', '-s', `:${path}`).stdout.trim()) || 0;
    entries.push({ status, path, size });
  }
  return entries;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = stagedProblems(staged());
  if (problems.length) {
    console.error('pre-commit: refusing this commit.');
    for (const problem of problems) console.error(`  - ${problem}`);
    console.error('Unstage with `git restore --staged <file>`.');
    process.exit(1);
  }
}
