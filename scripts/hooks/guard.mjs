// PreToolUse guard for Claude Code, Factory Droid and Codex (.claude/settings.json,
// .factory/hooks.json, .codex/hooks.json). Each tool pipes the pending tool call to stdin as JSON.
// A refused call gets its reason on stderr and exit code 2, which all three treat as "block".
// It is a guardrail against slips and injected instructions, not a sandbox: a determined shell
// command can always be written in a way no pattern catches.
import { readFileSync } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const SHELL_TOOLS = new Set(['Bash', 'Execute', 'exec_command', 'shell', 'local_shell']);
const PATH_KEYS = ['file_path', 'path', 'notebook_path', 'directory_path', 'folder', 'filePath'];
const PATCH_HEADER = /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$|^\+\+\+ (?:b\/)?(\S+)/gm;

/** Why a path must not be read or written, or null when it may be. */
export function pathProblem(path, cwd = ROOT) {
  const name = basename(path);
  if (name.startsWith('.env') && name !== '.env.example') {
    return `${path} is a secrets file (.env*). Only .env.example may be read or edited. Ask the owner for a value you need; never print one.`;
  }
  if (/\.sqlite/.test(name) || /\.db(?:-\w+)?$/.test(name)) {
    return `${path} is a database file and may hold player data. Use fixtures, or a database that a test creates in a temporary folder.`;
  }
  const inRepo = relative(ROOT, resolve(cwd, path));
  if (inRepo === 'data' || inRepo.startsWith(`data${sep}`)) {
    return `${path} is under data/, which holds runtime world and player data. Use fixtures instead.`;
  }
  return null;
}

const SHELL_RULES = [
  {
    pattern: /\bdocker[ -]compose\b[^;&|\n]*\bdown\b[^;&|\n]*\s(?:-[a-zA-Z]*v[a-zA-Z]*|--volumes)\b/,
    reason: '`docker compose down -v` deletes the volumes: the world saves and the Tailscale identity. Use `docker compose down` or `docker compose stop`.',
  },
  { pattern: /\bdocker\s+volume\s+(?:rm|remove|prune)\b/, reason: 'removing Docker volumes can delete the world saves. Leave volumes to the owner.' },
  { pattern: /\bdocker\s+system\s+prune\b/, reason: '`docker system prune` can delete images and volumes the Mac mini needs. Leave it to the owner.' },
  {
    pattern: /\bgit\b[^;&|\n]*\bpush\b[^;&|\n]*(?:\s--force\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S)/,
    reason: 'force-pushing rewrites published history. Agents never force-push; a person pushes.',
  },
  {
    pattern: /ignore[-_]scripts(?:\s*=\s*|\s+)false\b/i,
    reason: 'install scripts stay off (`ignore-scripts=true` in .npmrc). If one package truly needs its script, follow docs/security.md.',
  },
  {
    pattern: /\bnpm\s+(?:rebuild|rb)\b(?:\s+-{1,2}[\w=-]+)*\s*(?:$|[;&|\n)])/m,
    reason: '`npm rebuild` without a package name runs every dependency\'s install scripts. Name the one package, after the docs/security.md checklist.',
  },
  {
    pattern: /\b(?:curl|wget)\b[^;\n]*\|\s*(?:sudo\s+)?(?:env\s+)?(?:ba|z|da|k)?sh\b|\b(?:ba|z)?sh\s+(?:-c\s+)?(?:<\(|\$\()\s*(?:curl|wget)\b/,
    reason: 'piping a download into a shell runs unreviewed code. Download the file, read it, then decide.',
  },
];

/** Strips quoting and line continuations so `docker compose down "-v"` reads like the plain command. */
function normalise(command) {
  return command.replace(/\\\r?\n/g, ' ').replace(/['"`\\]/g, '');
}

export function shellProblem(command, cwd = ROOT) {
  const plain = normalise(command);
  for (const { pattern, reason } of SHELL_RULES) if (pattern.test(plain)) return reason;
  for (const token of plain.split(/[\s;&|<>()=,]+/)) {
    if (!token || token.startsWith('-') || token.includes('$')) continue;
    const problem = pathProblem(token, cwd);
    if (problem) return problem;
  }
  return null;
}

function patchProblem(text, cwd) {
  for (const match of text.matchAll(PATCH_HEADER)) {
    const problem = pathProblem((match[1] ?? match[2] ?? match[3]).trim(), cwd);
    if (problem) return problem;
  }
  return null;
}

/** The reason to refuse a PreToolUse event, or null to let it through. */
export function check(event) {
  const tool = String(event?.tool_name ?? '');
  const input = event?.tool_input && typeof event.tool_input === 'object' ? event.tool_input : {};
  const cwd = typeof event?.cwd === 'string' ? event.cwd : ROOT;
  const command = Array.isArray(input.command) ? input.command.join(' ') : input.command;

  for (const value of Object.values(input)) {
    if (typeof value === 'string' && /^\*\*\* Begin Patch/m.test(value)) {
      const problem = patchProblem(value, cwd);
      if (problem) return problem;
    }
  }
  if (SHELL_TOOLS.has(tool) && typeof command === 'string') {
    const problem = shellProblem(command, cwd);
    if (problem) return problem;
  }
  for (const key of PATH_KEYS) {
    if (typeof input[key] !== 'string') continue;
    const problem = pathProblem(input[key], cwd);
    if (problem) return problem;
  }
  return null;
}

function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.stderr.write('Blocked by scripts/hooks/guard.mjs: the hook input was not JSON, so the call could not be checked.\n');
    process.exit(2);
  }
  const problem = check(event);
  if (!problem) process.exit(0);
  process.stderr.write(`Blocked by scripts/hooks/guard.mjs: ${problem}\n`);
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
