// The voice tool, for a developer's Mac only (scripts/voice/README.md). CI and the image never run it.
//   voice.mjs generate             make the missing clips, remove unused ones, rewrite the manifest
//   voice.mjs words [language]     list every word with its sounds, for a person to scan
//   voice.mjs fix <language> <word> <ipa>   add a pronunciation fix, then generate
import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { LANGUAGES } from '../../packages/core/src/index.ts';
import { inTurn } from '../lib/in-turn.mjs';
import { clipsDir, contentPlan, fixesPath, MANIFEST, mp3sIn, readFixes } from './clips.mjs';
import { VOICE_HOME, VOICES } from './config.mjs';
import { addFix, chunksIn, fixFor, joinParts, markStress, spokenText, splitLine, staleClips, uniqueWords } from './lib.mjs';
import { readStoryFiles, voiceLines } from './lines.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const PYTHON = join(VOICE_HOME, 'venv', 'bin', 'python');
const modelPath = (language) => join(VOICE_HOME, 'models', `${VOICES[language].model}.onnx`);
// One folder per run, so two runs at once can't clear each other's files.
const WORK = join(VOICE_HOME, 'work', String(process.pid));
const FFMPEG_AT_ONCE = 6;

const run = promisify(execFile);

function fail(message) {
  console.error(`\nvoice: ${message}`);
  process.exit(1);
}

function python(script, input) {
  if (!existsSync(PYTHON) || !LANGUAGES.every((language) => existsSync(modelPath(language)))) fail('not set up yet. Run: npm run voice:setup');
  const result = spawnSync(PYTHON, [join(HERE, script)], {
    input: JSON.stringify(input),
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'inherit'],
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.status !== 0) fail(`${script} failed`);
  return result.stdout;
}

/** Returns a function from one language's text to IPA, covering every given text. */
function phonemizer(language, texts, fixes) {
  const chunks = [...new Set(texts.flatMap((text) => chunksIn(splitLine(text, fixes))))];
  const ipa = chunks.length > 0 ? JSON.parse(python('phonemize.py', { voice: VOICES[language].espeak, chunks })) : [];
  const known = new Map(chunks.map((chunk, index) => [chunk, ipa[index]]));
  return (text) => joinParts(splitLine(text, fixes), (chunk) => known.get(chunk));
}

async function toMp3(wav, { filter, mp3Args }, target) {
  // Written beside the target and moved in whole, so a stopped run can't leave half a clip that passes for a finished one.
  const partial = `${target}.partial`;
  await run('ffmpeg', ['-v', 'error', '-y', '-i', wav, '-af', filter, ...mp3Args, '-f', 'mp3', partial]);
  renameSync(partial, target);
}

async function makeClips(language, jobs) {
  if (jobs.length === 0) return;
  const fixes = readFixes(language);
  const toIpa = phonemizer(language, jobs.map(({ text }) => spokenText(text)), fixes);
  const items = jobs.map(({ text, settings, file }) => ({ ipa: toIpa(spokenText(text)), length_scale: settings.lengthScale, wav: join(WORK, `${file}.wav`) }));
  console.log(`${language}: speaking ${jobs.length} new clip(s)`);
  python('synth.py', { model: modelPath(language), items });

  const lanes = Array.from({ length: FFMPEG_AT_ONCE }, (_, lane) => jobs.filter((_job, index) => index % FFMPEG_AT_ONCE === lane));
  await Promise.all(lanes.map((lane) => inTurn(lane, (job) => toMp3(join(WORK, `${job.file}.wav`), job.settings, join(clipsDir(language), job.file)))));
}

const kilobytes = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

async function generate() {
  const { clips, skipped, manifest } = contentPlan();
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(WORK, { recursive: true });
  await inTurn(LANGUAGES, (language) => {
    mkdirSync(clipsDir(language), { recursive: true });
    const own = clips.filter((clip) => clip.language === language);
    return makeClips(language, own.filter(({ file }) => !existsSync(join(clipsDir(language), file))));
  });
  rmSync(WORK, { recursive: true, force: true });
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);

  for (const language of LANGUAGES) {
    const own = clips.filter((clip) => clip.language === language);
    const stale = staleClips(mp3sIn(clipsDir(language)), own);
    for (const file of stale) rmSync(join(clipsDir(language), file));
    const bytes = own.reduce((sum, { file }) => sum + statSync(join(clipsDir(language), file)).size, 0);
    console.log(`${language}: ${own.length} clip(s), ${kilobytes(bytes)}, ${stale.length} removed`);
  }
  if (skipped.length) {
    console.log(`\nNot voiced, because they have a {placeholder}:`);
    for (const { language, from, text } of skipped) console.log(`  ${language} ${from}: ${text}`);
  }
}

function words(language) {
  if (language !== undefined && !LANGUAGES.includes(language)) fail(`no language ${language}. Languages: ${LANGUAGES.join(', ')}`);
  const { lines } = voiceLines(readStoryFiles());
  for (const chosen of language ? [language] : LANGUAGES) {
    const fixes = readFixes(chosen);
    const all = uniqueWords(lines.filter((line) => line.language === chosen).map(({ text }) => spokenText(text)));
    const toIpa = phonemizer(chosen, all, fixes);
    const width = Math.max(0, ...all.map((word) => word.length)) + 2;
    console.log(`\n${chosen}:`);
    for (const word of all) {
      const ipa = toIpa(word);
      const note = fixFor(word, fixes) === undefined ? '' : '  (fixed)';
      const shown = chosen === 'sl' ? markStress(word, ipa) : word;
      console.log(`${shown.padEnd(width)}${ipa}${note}`);
    }
  }
}

async function fix(language, word, ipa) {
  if (!LANGUAGES.includes(language) || !word || !ipa) fail(`usage: npm run voice:fix -- <${LANGUAGES.join('|')}> <word> <ipa>`);
  writeFileSync(fixesPath(language), `${JSON.stringify(addFix(readFixes(language), word, ipa), null, 2)}\n`);
  await generate();
}

const [command, ...args] = process.argv.slice(2);
const commands = { generate, words, fix };
if (!Object.hasOwn(commands, command)) fail(`unknown command: ${command}. Commands: ${Object.keys(commands).join(', ')}`);
await commands[command](...args);
