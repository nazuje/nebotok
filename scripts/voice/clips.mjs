// The clips the game should have, worked out from content without the voice tool, and how what is
// committed differs from that. content:validate fails on any difference; `npm run voice` fixes it.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANGUAGES } from '../../packages/core/src/index.ts';
import { buildManifest, clipFile, fixesUsed, spokenText, voiceKey, voiceSettings } from './lib.mjs';
import { readStoryFiles, voiceLines } from './lines.mjs';

/** Vite copies public/ into the build, so the game serves each clip from its own origin as /voice/<language>/<file>. */
export const CLIPS_DIR = fileURLToPath(new URL('../../apps/game/public/voice/', import.meta.url));
/** In src/ so the game bundles it and knows every clip before the first line, with nothing to fetch. */
export const MANIFEST = fileURLToPath(new URL('../../apps/game/src/voice-clips.json', import.meta.url));
export const FIXES_DIR = fileURLToPath(new URL('./pronunciation/', import.meta.url));

export const fixesPath = (language) => join(FIXES_DIR, `${language}.json`);
export const readFixes = (language) => JSON.parse(readFileSync(fixesPath(language), 'utf8'));
export const clipsDir = (language) => join(CLIPS_DIR, language);

/** One clip per language, voice and line: { language, voice, voiceKey, text, from, settings, file }. */
export function plannedClips(lines, fixesByLanguage) {
  const clips = new Map();
  for (const { language, voice, text, from } of lines) {
    const key = voiceKey(voice);
    const id = JSON.stringify([language, key, text]);
    if (clips.has(id)) continue;
    const settings = { language, text, fixes: fixesUsed(spokenText(text), fixesByLanguage[language]), ...voiceSettings(language, voice) };
    clips.set(id, { language, voice, voiceKey: key, text, from, settings, file: clipFile(settings) });
  }
  return [...clips.values()];
}

/** The plan for the content in content/: { clips, skipped, manifest }. */
export function contentPlan(storyFiles = readStoryFiles()) {
  const { lines, skipped } = voiceLines(storyFiles);
  const clips = plannedClips(lines, Object.fromEntries(LANGUAGES.map((language) => [language, readFixes(language)])));
  return { clips, skipped, manifest: buildManifest(clips, LANGUAGES) };
}

export const mp3sIn = (dir) => (existsSync(dir) ? readdirSync(dir).filter((name) => name.endsWith('.mp3')).toSorted() : []);
const SHOWN = 5;
const listed = (items) => [...items.slice(0, SHOWN), ...(items.length > SHOWN ? [`... and ${items.length - SHOWN} more`] : [])];

/** Every way the committed clips and manifest differ from the plan, as sentences. */
export function clipProblems({ clips, manifest }, committed, onDisk) {
  const problems = [];
  if (JSON.stringify(committed) !== JSON.stringify(manifest)) problems.push('apps/game/src/voice-clips.json is out of date with content/ or the voice settings');
  const missing = clips.filter(({ language, file }) => !onDisk[language]?.includes(file));
  if (missing.length) problems.push(`${missing.length} line(s) have no clip:`, ...listed(missing.map(({ language, from, text }) => `  ${language} ${from}: ${text}`)));
  for (const language of LANGUAGES) {
    const wanted = new Set(clips.filter((clip) => clip.language === language).map(({ file }) => file));
    const stale = (onDisk[language] ?? []).filter((file) => !wanted.has(file));
    if (stale.length) problems.push(`${stale.length} clip(s) in apps/game/public/voice/${language}/ that no line uses:`, ...listed(stale.map((file) => `  ${file}`)));
  }
  if (problems.length) problems.push('Make the clips on a Mac with `npm run voice` (once per machine: `npm run voice:setup`), then commit them with the manifest.');
  return problems;
}

/** content:validate's check: { problems, clips, skipped } for the given content, against what is committed. */
export function checkClips(storyFiles) {
  const plan = contentPlan(storyFiles);
  const committed = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
  const onDisk = Object.fromEntries(LANGUAGES.map((language) => [language, mp3sIn(clipsDir(language))]));
  return { problems: clipProblems(plan, committed, onDisk), clips: plan.clips, skipped: plan.skipped };
}
