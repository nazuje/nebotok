// Level 0 check of the agent setup: every .claude/skills entry is a symlink into .agents/skills that
// resolves to a skill whose frontmatter name matches its folder, every skill has that link, and every
// subagent wrapper points to a shared prompt in docs/agents/ that exists (and every prompt has a
// wrapper for each tool). The three hook configs must all run scripts/hooks/guard.mjs.
import { existsSync, lstatSync, readFileSync, readdirSync, readlinkSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SKILLS = join(ROOT, '.agents/skills');
const LINKS = join(ROOT, '.claude/skills');
const PROMPTS = join(ROOT, 'docs/agents');
const WRAPPERS = [
  { dir: '.claude/agents', ext: '.md' },
  { dir: '.factory/droids', ext: '.md' },
  { dir: '.codex/agents', ext: '.toml' },
];
const HOOK_CONFIGS = ['.claude/settings.json', '.factory/hooks.json', '.codex/hooks.json'];

const problems = [];
const list = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => !name.startsWith('.')).toSorted() : []);

const skills = list(SKILLS).filter((name) => statSync(join(SKILLS, name)).isDirectory());
for (const name of skills) {
  const skillFile = join(SKILLS, name, 'SKILL.md');
  if (!existsSync(skillFile)) {
    problems.push(`.agents/skills/${name} has no SKILL.md`);
    continue;
  }
  const declared = /^---\n[\s\S]*?^name:\s*["']?([\w-]+)["']?\s*$/m.exec(readFileSync(skillFile, 'utf8'))?.[1];
  if (declared !== name) problems.push(`.agents/skills/${name}/SKILL.md declares name "${declared}"; it must match the folder`);
  if (!existsSync(join(LINKS, name))) problems.push(`.claude/skills/${name} is missing: ln -s ../../.agents/skills/${name} .claude/skills/${name}`);
}

for (const name of list(LINKS)) {
  const link = join(LINKS, name);
  if (!lstatSync(link).isSymbolicLink()) {
    problems.push(`.claude/skills/${name} is not a symlink; skills live in .agents/skills and are linked from here`);
    continue;
  }
  const target = readlinkSync(link);
  if (target.startsWith('/')) problems.push(`.claude/skills/${name} links to an absolute path; use ../../.agents/skills/${name}`);
  if (resolve(LINKS, target) !== join(SKILLS, name)) problems.push(`.claude/skills/${name} points to ${target}, not ../../.agents/skills/${name}`);
  else if (!existsSync(join(link, 'SKILL.md'))) problems.push(`.claude/skills/${name} does not resolve to a SKILL.md`);
}

const prompts = list(PROMPTS).filter((name) => name.endsWith('.md'));
for (const { dir, ext } of WRAPPERS) {
  const wrappers = list(join(ROOT, dir)).filter((name) => name.endsWith(ext));
  for (const file of wrappers) {
    const pointers = [...readFileSync(join(ROOT, dir, file), 'utf8').matchAll(/docs\/agents\/[\w-]+\.md/g)].map(([path]) => path);
    if (pointers.length === 0) problems.push(`${dir}/${file} does not point to a shared prompt in docs/agents/`);
    for (const path of pointers) if (!existsSync(join(ROOT, path))) problems.push(`${dir}/${file} points to ${path}, which does not exist`);
  }
  for (const prompt of prompts) {
    const stem = prompt.slice(0, -3);
    const wanted = ext === '.toml' ? stem.replaceAll('-', '_') : stem;
    if (!wrappers.some((file) => file === `${stem}${ext}` || file === `${wanted}${ext}`)) problems.push(`docs/agents/${prompt} has no wrapper in ${dir}/`);
  }
}

for (const config of HOOK_CONFIGS) {
  const path = join(ROOT, config);
  if (!existsSync(path)) {
    problems.push(`${config} is missing`);
    continue;
  }
  try {
    JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    problems.push(`${config} is not valid JSON: ${error.message}`);
    continue;
  }
  if (!readFileSync(path, 'utf8').includes('scripts/hooks/guard.mjs')) problems.push(`${config} does not run scripts/hooks/guard.mjs`);
}

if (problems.length) {
  console.error('agent-setup: problems found');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`agent-setup: ${skills.length} skill(s) linked, ${prompts.length} shared prompt(s) wrapped for ${WRAPPERS.length} tools, ${HOOK_CONFIGS.length} hook configs run the guard`);
