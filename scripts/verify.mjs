// The proof command. Runs every check up to the asked level, writes the evidence to
// .proof/<short sha>[-dirty]/ and exits non-zero if anything failed.
//   npm run verify -- --level N [--container]     (N is 0 to 4; each level includes the ones below)
//
// 0  lint, typecheck, unit tests, content:validate, core import boundary, secret scan
// 1  core property tests and golden replays
// 2  save migration round-trips over every fixture version
// 3  server room tests, and a bot run against the real server process
// 4  game build, then Chromium and WebKit against the real server serving it
//    --container (level 4 only): also build the production image, run it sealed, check it from
//    outside and inside, and play it in both browsers (needs Docker)
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inTurn } from './lib/in-turn.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_LEVEL = 4;
const BIN = (name) => join(ROOT, 'node_modules', '.bin', name);
const GITLEAKS = process.env.GITLEAKS_BIN ?? 'gitleaks';

const { values } = parseArgs({ options: { level: { type: 'string', default: '0' }, container: { type: 'boolean', default: false } } });
const level = Number(values.level);
if (!Number.isInteger(level) || level < 0 || level > MAX_LEVEL) {
  console.error(`verify: --level must be a whole number from 0 to ${MAX_LEVEL}, got "${values.level}"`);
  process.exit(2);
}
if (values.container && level < MAX_LEVEL) {
  console.error(`verify: --container needs --level ${MAX_LEVEL}`);
  process.exit(2);
}

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
const sha = git('rev-parse', '--short', 'HEAD').stdout.trim() || 'no-commit';
const dirty = git('status', '--porcelain').stdout.trim() !== '';
const proof = join(ROOT, '.proof', `${sha}${dirty ? '-dirty' : ''}`);
rmSync(proof, { recursive: true, force: true });
mkdirSync(join(proof, 'logs'), { recursive: true });

const vitest = (...projects) => [BIN('vitest'), ['run', ...projects.flatMap((name) => ['--project', name])]];
const STEPS = [
  { level: 0, name: 'lint', run: [BIN('oxlint'), ['--deny-warnings']] },
  { level: 0, name: 'typecheck', run: ['npm', ['run', 'typecheck']] },
  { level: 0, name: 'unit-tests', run: vitest('core-unit', 'game-unit') },
  { level: 0, name: 'content-validate', run: [process.execPath, ['scripts/validate-content.mjs']] },
  { level: 0, name: 'core-boundary', run: [process.execPath, ['scripts/check-core-imports.mjs']] },
  { level: 0, name: 'secrets-history', run: [GITLEAKS, ['detect', '--no-banner', '--redact', '--source', '.', '--report-path', join(proof, 'logs', 'gitleaks-history.json')]] },
  { level: 0, name: 'secrets-worktree', run: [GITLEAKS, ['detect', '--no-banner', '--redact', '--no-git', '--source', '.', '--report-path', join(proof, 'logs', 'gitleaks-worktree.json')]] },
  { level: 1, name: 'property-tests', run: vitest('core-property') },
  { level: 1, name: 'golden-replays', run: vitest('core-golden') },
  { level: 2, name: 'save-migrations', run: vitest('core-saves') },
  { level: 3, name: 'server-tests', run: vitest('server') },
  { level: 3, name: 'bot-run', run: [process.execPath, ['scripts/bot-run.mjs', '--out', proof]], timeoutMs: 60_000 },
  { level: 4, name: 'build', run: ['npm', ['run', 'build']] },
  { level: 4, name: 'browser-check', run: [process.execPath, ['scripts/browser-check.mjs', '--out', proof]], needs: 'build', timeoutMs: 600_000 },
  { level: 4, container: true, name: 'container-check', run: [process.execPath, ['scripts/container-check.mjs', '--out', proof]], timeoutMs: 1_500_000 },
];

const DEFAULT_TIMEOUT_MS = 300_000;

function runStep(step) {
  const [command, args] = step.run;
  const logPath = join(proof, 'logs', `${step.name}.log`);
  const log = createWriteStream(logPath);
  const shown = [command === process.execPath ? 'node' : command.startsWith(ROOT) ? relative(ROOT, command) : command, ...args.map((arg) => (arg.startsWith(ROOT) ? relative(ROOT, arg) || '.' : arg))].join(' ');
  log.write(`$ ${shown}\n\n`);
  const started = performance.now();
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: ROOT, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    const timer = setTimeout(() => {
      log.write(`\nverify: killed after ${(step.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000}s\n`);
      child.kill('SIGKILL');
    }, step.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    const finish = (exitCode, note) => {
      clearTimeout(timer);
      if (note) log.write(`\nverify: ${note}\n`);
      log.end();
      resolve({ name: step.name, level: step.level, command: shown, exitCode, durationMs: Math.round(performance.now() - started), log: relative(ROOT, logPath) });
    };
    child.once('error', (error) => finish(127, `could not start: ${error.message}`));
    child.once('close', (code, signal) => finish(code ?? (signal ? 128 : 1), signal ? `ended by ${signal}` : undefined));
  });
}

const started = Date.now();
const results = [];
// Steps run one at a time: several start the server or browsers, and the log reads in order.
await inTurn(STEPS.filter((candidate) => candidate.level <= level && (!candidate.container || values.container)), async (step) => {
  const needed = step.needs && results.find((result) => result.name === step.needs);
  if (needed && needed.exitCode !== 0) {
    results.push({ name: step.name, level: step.level, command: step.run.flat().join(' '), exitCode: null, durationMs: 0, log: null, skipped: `${step.needs} failed` });
    return;
  }
  process.stdout.write(`verify: ${step.name} ...`);
  const result = await runStep(step);
  results.push(result);
  process.stdout.write(` ${result.exitCode === 0 ? 'ok' : `FAILED (exit ${result.exitCode})`} ${(result.durationMs / 1000).toFixed(1)}s\n`);
});

const filesIn = (dir, pattern) => {
  try {
    return readdirSync(join(proof, dir)).filter((name) => pattern.test(name)).toSorted().map((name) => relative(ROOT, join(proof, dir, name)));
  } catch {
    return [];
  }
};

const readJson = (path) => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
};

const ok = results.every((result) => result.exitCode === 0);
const summary = {
  ok,
  level,
  container: values.container ? readJson(join(proof, 'logs', 'container-check.json')) : null,
  timestamp: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  git: { sha, dirty },
  node: process.version,
  steps: results,
  screenshots: [...filesIn('screenshots', /\.png$/), ...filesIn(join('container', 'screenshots'), /\.png$/)],
  logs: filesIn('logs', /\.(log|json)$/),
};
const summaryPath = join(proof, 'summary.json');
writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log('');
for (const result of results) {
  const mark = result.skipped ? 'skip' : result.exitCode === 0 ? ' ok ' : 'FAIL';
  console.log(`  [${mark}] L${result.level} ${result.name.padEnd(18)} ${result.skipped ?? `${(result.durationMs / 1000).toFixed(1)}s`}`);
  if (result.exitCode !== 0 && result.log) console.log(`         see ${result.log}`);
}
console.log(`\nverify level ${level}: ${ok ? 'PASSED' : 'FAILED'} in ${((Date.now() - started) / 1000).toFixed(1)}s, ${summary.screenshots.length} screenshot(s)`);
console.log(`proof: ${relative(ROOT, summaryPath)}`);
process.exit(ok ? 0 : 1);
